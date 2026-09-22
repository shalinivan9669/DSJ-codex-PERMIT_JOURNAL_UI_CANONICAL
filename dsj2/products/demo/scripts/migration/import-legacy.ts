import { createHash, randomUUID } from "node:crypto";
import { readFile, open, stat } from "node:fs/promises";
import { PrismaClient, Prisma } from "../../packages/database/src";
import { draftSchema, type Draft } from "../../packages/contracts/src";

export type LegacyEnvelope = {
  version: number;
  sourceSystem: string;
  sourceCompanyId: string;
  requests: any[];
  audit: any[];
  counts: { requests: number; items: number; audit: number };
  originalFiles: string;
  coverage: string;
  checksum: string;
};
export type ImportConfig = {
  tenantId: string;
  actorId: string;
  profileVersionId: string;
  sourceCompanyId: string;
  sourceLabel: string;
  requestKinds: Record<string, "PERSON" | "COMPANY">;
  numbers: Record<string, number>;
};
export const canonical = (v: any): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : "{" +
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
          .join(",") +
        "}";
export const checksum = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function id(...parts: string[]) {
  const h = checksum(parts);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function seal(
  envelope: Omit<LegacyEnvelope, "checksum">,
): LegacyEnvelope {
  return { ...envelope, checksum: checksum(envelope) };
}
export function verifyEnvelope(envelope: LegacyEnvelope) {
  const { checksum: expected, ...content } = envelope;
  if (
    envelope.version !== 1 ||
    envelope.sourceSystem !== "DSJ" ||
    checksum(content) !== expected
  )
    throw new Error("LEGACY_EXPORT_CHECKSUM_MISMATCH");
  if (
    !Array.isArray(envelope.requests) ||
    !Array.isArray(envelope.audit) ||
    !envelope.counts ||
    envelope.requests.some(
      (r) => !r || typeof r.id !== "string" || !r.id || !Array.isArray(r.items),
    ) ||
    envelope.audit.some((r) => !r || typeof r.id !== "string" || !r.id) ||
    envelope.requests.length !== envelope.counts.requests ||
    envelope.requests.reduce((n, r) => n + r.items.length, 0) !==
      envelope.counts.items ||
    envelope.audit.length !== envelope.counts.audit
  )
    throw new Error("LEGACY_EXPORT_COUNTS_MISMATCH");
  if (
    new Set(envelope.requests.map((r) => r.id)).size !==
      envelope.requests.length ||
    new Set(envelope.audit.map((r) => r.id)).size !== envelope.audit.length ||
    new Set(envelope.requests.flatMap((r) => r.items.map((i: any) => i.id)))
      .size !== envelope.counts.items
  )
    throw new Error("LEGACY_DUPLICATE_SOURCE_ID");
}
function sourceKey(config: ImportConfig) {
  return `DSJ:${config.sourceLabel}:${config.sourceCompanyId}`;
}
function documents(request: any) {
  const family = String(request.certificateType).toLowerCase();
  if (!["biot", "ptm", "pb", "ps"].includes(family))
    throw new Error("UNSUPPORTED_LEGACY_FORM");
  const result: Array<{
    rowId: string;
    assignmentId: string;
    templateId: string;
    namespace: string;
    number: string;
    registrationNumber?: string;
    documentDate: string;
  }> = [];
  for (const item of request.items) {
    const add = (suffix: string, number: unknown, field: string) => {
      if (typeof number !== "string" || !number.trim())
        throw new Error(`MISSING_LEGACY_NUMBER:${item.id}:${field}`);
      const templateId = `${family}-${suffix}`;
      result.push({
        rowId: item.id,
        assignmentId: `legacy-${field}`,
        templateId,
        namespace: `${family.toUpperCase()}:${suffix.endsWith("certificate") ? "CERTIFICATE" : suffix.endsWith("card") ? "CARD" : suffix.toUpperCase()}`,
        number,
        documentDate: String(request.issueDate).slice(0, 10),
        ...(suffix === "witness" && item.witnessRegistrationNumber
          ? { registrationNumber: String(item.witnessRegistrationNumber) }
          : {}),
      });
    };
    if (request.includeCard !== false)
      add(
        family === "biot"
          ? request.biotDocumentKind === "ITR_CERTIFICATE"
            ? "itr-certificate"
            : "worker-card"
          : "card",
        item.certificateNumber,
        "certificateNumber",
      );
    if (request.includeProtocol !== false)
      add("protocol", item.protocolNumber, "protocolNumber");
    if (request.includeWitness)
      add("witness", item.witnessCertificateNumber, "witnessCertificateNumber");
  }
  return result;
}
export async function migrateLegacy(
  db: PrismaClient,
  envelope: LegacyEnvelope,
  config: ImportConfig,
  apply = false,
) {
  verifyEnvelope(envelope);
  if (
    config.sourceCompanyId !== envelope.sourceCompanyId ||
    !config.sourceLabel ||
    !config.requestKinds ||
    !config.numbers
  )
    throw new Error("EXPLICIT_SOURCE_TENANT_AND_NUMBER_MAPPING_REQUIRED");
  const tenant = await db.tenant.findUnique({ where: { id: config.tenantId } });
  const actor = await db.user.findFirst({
    where: {
      id: config.actorId,
      tenantId: config.tenantId,
      role: "ADMIN",
      active: true,
    },
  });
  const profile = await db.issuerProfileVersion.findFirst({
    where: { id: config.profileVersionId, tenantId: config.tenantId },
  });
  if (!tenant?.active || !actor || !profile)
    throw new Error("IMPORT_ADMIN_TENANT_PROFILE_REQUIRED");
  const conflicts: Array<{ sourceId: string; code: string; detail?: string }> =
    [];
  const prepared: Array<{
    raw: any;
    sourceId: string;
    recordHash: string;
    requestId: string;
    issuanceId: string;
    customerId: string | null;
    draft: Draft;
    docs: ReturnType<typeof documents>;
    reservations: Array<{
      namespace: string;
      number: string;
      sequence: number;
      documentId: string;
    }>;
  }> = [];
  let unchanged = 0;
  const seenNumbers = new Map<string, string>();
  const seenSequences = new Map<string, string>();
  const requestIds = new Set(envelope.requests.map((r) => r.id));
  for (const audit of envelope.audit) {
    if (
      audit.companyId !== config.sourceCompanyId ||
      !String(audit.action).startsWith("biot_card.")
    ) {
      conflicts.push({
        sourceId: audit.id,
        code: "SOURCE_AUDIT_SCOPE_MISMATCH",
      });
      continue;
    }
    const priorAudit = await db.legacyMapping.findUnique({
      where: {
        tenantId_sourceSystem_sourceId: {
          tenantId: config.tenantId,
          sourceSystem: sourceKey(config),
          sourceId: `audit:${audit.id}`,
        },
      },
    });
    if (priorAudit && priorAudit.checksum !== checksum(audit))
      conflicts.push({
        sourceId: audit.id,
        code: "SOURCE_AUDIT_CHANGED_AFTER_IMPORT",
      });
    if (
      audit.action === "biot_card.generated" &&
      !requestIds.has(audit.metadata?.requestId)
    )
      conflicts.push({
        sourceId: audit.id,
        code: "ORPHAN_GENERATION_AUDIT",
        detail:
          "Missing source request. Reconcile its occupied numbers before migration; never discard or renumber.",
      });
  }
  for (const raw of envelope.requests) {
    const sourceId = String(raw.id);
    const recordHash = checksum(raw);
    if (raw.companyId !== config.sourceCompanyId) {
      conflicts.push({ sourceId, code: "SOURCE_COMPANY_MISMATCH" });
      continue;
    }
    const mapping = await db.legacyMapping.findUnique({
      where: {
        tenantId_sourceSystem_sourceId: {
          tenantId: config.tenantId,
          sourceSystem: sourceKey(config),
          sourceId,
        },
      },
    });
    if (mapping) {
      if (mapping.checksum === recordHash) unchanged++;
      else conflicts.push({ sourceId, code: "SOURCE_CHANGED_AFTER_IMPORT" });
      continue;
    }
    if (!config.requestKinds[sourceId]) {
      conflicts.push({ sourceId, code: "EXPLICIT_REQUEST_KIND_REQUIRED" });
      continue;
    }
    if (
      raw.items.length > 100 ||
      new Set(raw.items.map((i: any) => i.id)).size !== raw.items.length
    ) {
      conflicts.push({ sourceId, code: "ROW_COUNT_OR_ID_CONFLICT" });
      continue;
    }
    try {
      const docs = documents(raw);
      const requestId = id(
        config.tenantId,
        sourceKey(config),
        "request",
        sourceId,
      );
      const issuanceId = id(requestId, "issuance");
      const customerId =
        config.requestKinds[sourceId] === "COMPANY"
          ? id(requestId, "customer")
          : null;
      if (customerId && !raw.requestCompanyRu)
        throw new Error("CUSTOMER_RU_MISSING");
      const draft = draftSchema.parse({
        kind: config.requestKinds[sourceId],
        title: raw.title,
        customerId,
        items: raw.items.map((item: any) => ({
          id: item.id,
          fullNameRu: item.fullName,
          fullNameKz: item.fullNameKz || "",
          positionRu: item.positionRu || "",
          positionKz: item.positionKz || "",
          workplaceRu: item.workplaceRu || "",
          workplaceKz: item.workplaceKz || "",
          assignments: docs
            .filter((d) => d.rowId === item.id)
            .map((d) => ({
              id: d.assignmentId,
              templateId: d.templateId,
              documentDate: d.documentDate,
              trainingSubject: raw.trainingSubject || "",
              result: "",
            })),
        })),
      });
      const reservations: Array<{
        namespace: string;
        number: string;
        sequence: number;
        documentId: string;
      }> = [];
      for (const doc of docs) {
        for (const entry of [
          { namespace: doc.namespace, number: doc.number },
          ...(doc.registrationNumber
            ? [{ namespace: "PS:REGISTRATION", number: doc.registrationNumber }]
            : []),
        ]) {
          const key = `${entry.namespace}|${entry.number}`;
          const sequence = config.numbers[key];
          if (
            !Number.isInteger(sequence) ||
            sequence < 1 ||
            sequence > 2147483647
          ) {
            conflicts.push({
              sourceId,
              code: "EXPLICIT_SEQUENCE_REQUIRED",
              detail: key,
            });
            continue;
          }
          const seqKey = `${entry.namespace}|${sequence}`;
          if (seenNumbers.has(key) || seenSequences.has(seqKey)) {
            conflicts.push({
              sourceId,
              code: "DUPLICATE_LEGACY_NUMBER_OR_SEQUENCE",
              detail: key,
            });
            continue;
          }
          seenNumbers.set(key, sourceId);
          seenSequences.set(seqKey, sourceId);
          const occupied = await db.numberReservation.findFirst({
            where: {
              tenantId: config.tenantId,
              namespace: entry.namespace,
              OR: [{ formattedNumber: entry.number }, { sequence }],
            },
          });
          if (occupied) {
            conflicts.push({
              sourceId,
              code: "NUMBER_ALREADY_RESERVED",
              detail: key,
            });
            continue;
          }
          reservations.push({
            ...entry,
            sequence,
            documentId: id(issuanceId, doc.rowId, doc.assignmentId),
          });
        }
      }
      prepared.push({
        raw,
        sourceId,
        recordHash,
        requestId,
        issuanceId,
        customerId,
        draft,
        docs,
        reservations,
      });
    } catch (error) {
      conflicts.push({
        sourceId,
        code: "SOURCE_VALIDATION_FAILED",
        detail:
          error instanceof Error ? error.message : "Unknown validation failure",
      });
    }
  }
  const report = {
    dryRun: !apply,
    sourceChecksum: envelope.checksum,
    sourceCounts: envelope.counts,
    create: prepared.length,
    unchanged,
    conflicts,
    applied: 0,
    originalArtifactsImported: 0,
    missingOriginalDocuments: prepared.reduce((n, p) => n + p.docs.length, 0),
    peopleMerged: 0,
    renumbered: 0,
    requests: envelope.requests.map((request) => ({
      sourceId: request.id,
      sourceRows: request.items.length,
      status: conflicts.some((conflict) => conflict.sourceId === request.id)
        ? "CONFLICT"
        : prepared.some((entry) => entry.sourceId === request.id)
          ? "PROPOSED"
          : "UNCHANGED",
    })),
  };
  if (!apply || conflicts.length) return report;
  await db.$transaction(
    async (tx) => {
      for (const p of prepared) {
        if (p.customerId)
          await tx.customerOrganization.create({
            data: {
              id: p.customerId,
              tenantId: config.tenantId,
              nameRu: p.raw.requestCompanyRu,
              nameKz: p.raw.requestCompanyKz || "",
            },
          });
        await tx.printRequest.create({
          data: {
            id: p.requestId,
            tenantId: config.tenantId,
            kind: p.draft.kind,
            title: p.draft.title,
            customerId: p.customerId,
            status: "FINALIZED",
            revision: 0,
            draft: json(p.draft),
            itemCount: p.draft.items.length,
            searchText: p.draft.items
              .map((i) => `${i.fullNameRu} ${i.fullNameKz}`)
              .join(" "),
            createdBy: config.actorId,
            createdAt: new Date(p.raw.createdAt),
            legacySourceId: `${sourceKey(config)}:${p.sourceId}`,
          },
        });
        for (const [position, item] of p.draft.items.entries())
          await tx.requestItem.create({
            data: {
              tenantId: config.tenantId,
              requestId: p.requestId,
              rowId: item.id,
              position,
              payload: json(item),
            },
          });
        await tx.issuance.create({
          data: {
            id: p.issuanceId,
            tenantId: config.tenantId,
            requestId: p.requestId,
            sourceRevision: 0,
            profileVersionId: config.profileVersionId,
            createdBy: config.actorId,
            createdAt: new Date(p.raw.createdAt),
            inputHash: p.recordHash,
            legacySourceId: `${sourceKey(config)}:${p.sourceId}`,
            snapshot: json({
              provenance: "LEGACY_RECORD_WITHOUT_ORIGINAL",
              sourceSystem: sourceKey(config),
              sourceChecksum: p.recordHash,
              legacy: p.raw,
              draft: p.draft,
              originalArtifacts: "MISSING",
              profileApplicability:
                "IMPORT_CONTAINER_ONLY_NOT_PROOF_OF_LEGACY_ISSUER",
              rendererVersion: null,
            }),
          },
        });
        for (const doc of p.docs) {
          const templateVersionId = id(
            config.tenantId,
            sourceKey(config),
            "unknown-template",
            doc.templateId,
          );
          await tx.templateVersion.upsert({
            where: { id: templateVersionId },
            create: {
              id: templateVersionId,
              tenantId: config.tenantId,
              templateId: doc.templateId,
              version: `legacy-unknown-${checksum(sourceKey(config)).slice(0, 8)}`,
              checksum: checksum({
                source: sourceKey(config),
                template: doc.templateId,
              }),
              storageKey: `missing/legacy/${templateVersionId}.docx`,
              contract: {
                provenance: "LEGACY_TEMPLATE_UNKNOWN",
                fileAvailable: false,
                checksumScope: "SOURCE_IDENTITY_ONLY",
              },
              approved: false,
            },
            update: {},
          });
          await tx.issuedDocument.create({
            data: {
              id: id(p.issuanceId, doc.rowId, doc.assignmentId),
              tenantId: config.tenantId,
              issuanceId: p.issuanceId,
              requestId: p.requestId,
              templateVersionId,
              ...doc,
            },
          });
        }
        for (const reservation of p.reservations) {
          await tx.numberSequence.upsert({
            where: {
              tenantId_namespace: {
                tenantId: config.tenantId,
                namespace: reservation.namespace,
              },
            },
            create: {
              tenantId: config.tenantId,
              namespace: reservation.namespace,
              value: reservation.sequence,
            },
            update: {},
          });
          await tx.numberSequence.updateMany({
            where: {
              tenantId: config.tenantId,
              namespace: reservation.namespace,
              value: { lt: reservation.sequence },
            },
            data: { value: reservation.sequence },
          });
          await tx.numberReservation.create({
            data: {
              tenantId: config.tenantId,
              namespace: reservation.namespace,
              sequence: reservation.sequence,
              formattedNumber: reservation.number,
              documentId: reservation.documentId,
            },
          });
        }
        await tx.legacyMapping.create({
          data: {
            tenantId: config.tenantId,
            sourceSystem: sourceKey(config),
            sourceId: p.sourceId,
            checksum: p.recordHash,
            entityId: p.requestId,
            provenance: "LEGACY_RECORD_WITHOUT_ORIGINAL",
          },
        });
        await tx.issuanceEvent.create({
          data: {
            tenantId: config.tenantId,
            issuanceId: p.issuanceId,
            kind: "LEGACY_IMPORTED",
            reason:
              "Original bytes were not preserved in source; record imported without reconstructing a file",
            actorId: config.actorId,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId: config.tenantId,
            actorId: config.actorId,
            action: "LEGACY_REQUEST_IMPORTED",
            entityId: p.requestId,
            correlationId: randomUUID(),
            metadata: json({
              sourceId: p.sourceId,
              sourceSystem: sourceKey(config),
              checksum: p.recordHash,
              originalArtifacts: "MISSING",
            }),
          },
        });
      }
      for (const entry of envelope.audit) {
        const sourceId = `audit:${entry.id}`;
        const prior = await tx.legacyMapping.findUnique({
          where: {
            tenantId_sourceSystem_sourceId: {
              tenantId: config.tenantId,
              sourceSystem: sourceKey(config),
              sourceId,
            },
          },
        });
        if (prior) {
          if (prior.checksum !== checksum(entry))
            throw new Error("LEGACY_AUDIT_SOURCE_CHANGED");
          continue;
        }
        const event = await tx.auditEvent.create({
          data: {
            tenantId: config.tenantId,
            actorId: config.actorId,
            action: "LEGACY_AUDIT_IMPORTED",
            entityId: String(entry.entityId),
            correlationId: randomUUID(),
            metadata: json({
              sourceSystem: sourceKey(config),
              source: entry,
              checksum: checksum(entry),
            }),
            createdAt: new Date(entry.createdAt),
          },
        });
        await tx.legacyMapping.create({
          data: {
            tenantId: config.tenantId,
            sourceSystem: sourceKey(config),
            sourceId,
            checksum: checksum(entry),
            entityId: event.id,
            provenance: "LEGACY_AUDIT_SNAPSHOT",
          },
        });
      }
    },
    { isolationLevel: "Serializable", timeout: 120000, maxWait: 10000 },
  );
  report.applied = prepared.length;
  for (const request of report.requests)
    if (request.status === "PROPOSED") request.status = "APPLIED";
  return report;
}
async function main() {
  const [inputFile, configFile, reportFile, flag] = process.argv.slice(2);
  if (!inputFile || !configFile || !reportFile || (flag && flag !== "--apply"))
    throw new Error(
      "Usage: pnpm exec tsx scripts/migration/import-legacy.ts EXPORT.json MAPPING.json REPORT.json [--apply]; default is dry-run",
    );
  if ((await stat(inputFile)).size > 512 * 1024 * 1024)
    throw new Error("EXPORT_TOO_LARGE_SPLIT_BY_SOURCE_COMPANY");
  const db = new PrismaClient();
  // Reserve the report before any mutation: an existing report must never cause a committed import with no report.
  const report = await open(reportFile, "wx", 0o600);
  try {
    const result = await migrateLegacy(
      db,
      JSON.parse(await readFile(inputFile, "utf8")),
      JSON.parse(await readFile(configFile, "utf8")),
      flag === "--apply",
    );
    await report.writeFile(JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        dryRun: result.dryRun,
        create: result.create,
        unchanged: result.unchanged,
        conflicts: result.conflicts.length,
        applied: result.applied,
        missingOriginalDocuments: result.missingOriginalDocuments,
      }),
    );
    if (result.conflicts.length) process.exitCode = 2;
  } finally {
    await report.close();
    await db.$disconnect();
  }
}

if (require.main === module)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  });
