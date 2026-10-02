import { draftSchema, today, type Draft } from "@demo/contracts";
import {
  evidenceMatrixSchema,
  evidenceState,
  renewalScanSchema,
} from "../../../packages/contracts/src/operator-value";
import { audit, db, fail, parse, type Context } from "./core";
import { createRenewalNeed, identifyRenewalNeed } from "./operator-value";
import { ruleApplicabilityIssues } from "./service-rule-applicability";

function staff(c: Context, admin = false) {
  if (
    !(admin
      ? c.role === "ADMIN"
      : ["ADMIN", "DIRECTOR", "OPERATOR", "VIEWER"].includes(c.role))
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав сотрудника центра");
}
function snapshotDraft(snapshot: unknown): Draft | null {
  const parsed = draftSchema.safeParse(
    (snapshot as { draft?: unknown } | null)?.draft,
  );
  return parsed.success ? parsed.data : null;
}
function before(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function normalized(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ru");
}
async function approvedRules(c: Context, ids: string[]) {
  const unique = [...new Set(ids)];
  const rules = await db.serviceRuleVersion.findMany({
    where: { tenantId: c.tenantId, id: { in: unique } },
  });
  if (rules.length !== unique.length)
    fail(404, "SERVICE_RULE_NOT_FOUND", "Версия паспорта услуги не найдена");
  if (rules.some((rule) => rule.status !== "APPROVED" || !rule.checkedOn))
    fail(
      409,
      "SERVICE_RULE_NOT_APPROVED",
      "Требуется утверждённый и проверенный паспорт услуги",
    );
  return unique.map((id) => rules.find((rule) => rule.id === id)!);
}

// An explicit administrator action; saved validity and knowledge dates stay separate.
// Missing validity, identity or a pinned policy produces an exclusion, never a guessed date.
export async function scanRenewals(c: Context, input: unknown) {
  staff(c, true);
  const data = parse(renewalScanSchema, input);
  const [rule] = await approvedRules(c, [data.ruleVersionId]);
  const requests = await db.printRequest.findMany({
    where: {
      tenantId: c.tenantId,
      status: "FINALIZED",
      ...(data.afterRequestId ? { id: { gt: data.afterRequestId } } : {}),
    },
    orderBy: { id: "asc" },
    take: 501,
  });
  const page = requests.slice(0, 500);
  const issuances = await db.issuance.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: { in: page.map((value) => value.id) },
    },
    orderBy: { createdAt: "desc" },
  });
  const events = await db.issuanceEvent.findMany({
    where: {
      tenantId: c.tenantId,
      issuanceId: { in: issuances.map((value) => value.id) },
    },
  });
  const documents = await db.issuedDocument.findMany({
    where: {
      tenantId: c.tenantId,
      issuanceId: { in: issuances.map((value) => value.id) },
    },
  });
  const members = await db.groupDocumentMember.findMany({
    where: {
      tenantId: c.tenantId,
      documentId: {
        in: documents
          .filter((value) => value.ownerKind === "GROUP")
          .map((value) => value.id),
      },
    },
  });
  let created = 0;
  const items: Awaited<ReturnType<typeof createRenewalNeed>>[] = [];
  const exclusions: Record<string, number> = {};
  const exclude = (reason: string) => {
    exclusions[reason] = (exclusions[reason] || 0) + 1;
  };
  for (const request of page) {
    const issuance = issuances.find((value) => value.requestId === request.id);
    if (!issuance) {
      exclude("NO_ISSUED_HISTORY");
      continue;
    }
    if (
      events.some(
        (event) =>
          event.issuanceId === issuance.id &&
          ["CANCELLED", "REPLACED", "SUPERSEDED"].includes(event.kind),
      )
    ) {
      exclude("SUPERSEDED_HISTORY");
      continue;
    }
    const draft = snapshotDraft(issuance.snapshot);
    if (!draft) {
      exclude("UNREADABLE_HISTORY");
      continue;
    }
    for (const row of draft.items)
      for (const assignment of row.assignments) {
        const event = draft.events?.find(
          (value) => value.id === assignment.eventId,
        );
        if (event?.serviceRuleVersionId !== rule.id) continue;
        if (!row.recipientId) {
          exclude("UNCONFIRMED_IDENTITY");
          continue;
        }
        const basisDate = assignment.protocolDate || assignment.trainingEnd;
        if (!basisDate || !assignment.validUntil) {
          exclude("MISSING_ACTUAL_DATES");
          continue;
        }
        if (assignment.outcome?.status !== "PASSED") {
          exclude("NO_CONFIRMED_RESULT");
          continue;
        }
        if (
          ruleApplicabilityIssues(rule, {
            templateIds: [assignment.templateId],
            category: assignment.biotCategory,
            basisDate,
          }).length
        ) {
          exclude("POLICY_NOT_APPLICABLE");
          continue;
        }
        if (
          !documents.some(
            (value) =>
              value.issuanceId === issuance.id &&
              ((value.rowId === row.id &&
                value.assignmentId === assignment.id) ||
                members.some(
                  (member) =>
                    member.documentId === value.id &&
                    member.rowId === row.id &&
                    member.assignmentId === assignment.id &&
                    member.recipientId === row.recipientId,
                )),
          )
        ) {
          exclude("NO_ISSUED_DOCUMENT");
          continue;
        }
        const identified = await identifyRenewalNeed(c, {
          customerId: row.employerId || request.customerId,
          recipientId: row.recipientId,
          sourceRequestId: request.id,
          sourceRowId: row.id,
          assignmentId: assignment.id,
          policySource: rule.source,
          policyVersion: rule.id,
          basisDate,
          documentValidUntil: assignment.validUntil,
          nextCheckDate: null,
          contactAfter: before(assignment.validUntil, data.contactLeadDays),
          confirmed: false,
        });
        if (!items.some((item) => item.id === identified.value.id)) {
          items.push(identified.value);
          if (identified.created) created++;
        }
      }
  }
  const result = {
    scanned: page.length,
    created,
    existing: items.length - created,
    excluded: Object.values(exclusions).reduce((sum, count) => sum + count, 0),
    exclusions,
    items,
    nextCursor: requests.length > 500 ? page[page.length - 1].id : null,
  };
  await audit(db, c, "RENEWAL_POLICY_SCAN", rule.id, {
    scanned: result.scanned,
    created: result.created,
    existing: result.existing,
    exclusions,
    contactLeadDays: data.contactLeadDays,
    nextCursor: result.nextCursor,
  });
  return result;
}

type MatrixEvidence = {
  source: "OWN" | "EXTERNAL";
  sourceReference: string;
  documentId: string | null;
  originalNumber: string;
  issuer: string;
  documentDate: string;
  validUntil: string | null;
  status: string;
};

export async function evidenceMatrix(c: Context, input: unknown) {
  staff(c);
  const data = parse(evidenceMatrixSchema, input);
  return buildCustomerEvidenceMatrix(c, data);
}
// Both callers establish staff permission or an exact active employer membership.
export async function buildCustomerEvidenceMatrix(
  c: Context,
  data: { customerId: string; ruleVersionIds: string[] },
  permittedRecipientIds?: string[],
) {
  const customer = await db.customerOrganization.findFirst({
    where: { tenantId: c.tenantId, id: data.customerId },
  });
  if (!customer) fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
  const rules = await approvedRules(c, data.ruleVersionIds);
  const [tenant, employments, external, issuances] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    db.recipientEmployment.findMany({
      where: { tenantId: c.tenantId, employerId: customer.id },
    }),
    db.externalEvidence.findMany({
      where: { tenantId: c.tenantId, customerId: customer.id },
    }),
    db.issuance.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { createdAt: "desc" },
      take: 2001,
    }),
  ]);
  if (issuances.length > 2000)
    fail(
      413,
      "MATRIX_HISTORY_LIMIT",
      "История превышает предел интерактивной матрицы; требуется выборка архивного периода",
    );
  const [documents, events, members] = await Promise.all([
    db.issuedDocument.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: { in: issuances.map((value) => value.id) },
      },
    }),
    db.issuanceEvent.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: { in: issuances.map((value) => value.id) },
      },
    }),
    db.groupDocumentMember.findMany({
      where: { tenantId: c.tenantId, employerId: customer.id },
    }),
  ]);
  const candidates = new Map<string, Map<string, MatrixEvidence[]>>();
  const recipientIds = new Set([
    ...employments.map((value) => value.recipientId),
    ...external.map((value) => value.recipientId),
    ...(permittedRecipientIds || []),
  ]);
  const append = (
    recipientId: string,
    ruleId: string,
    evidence: MatrixEvidence,
  ) => {
    recipientIds.add(recipientId);
    if (!candidates.has(recipientId)) candidates.set(recipientId, new Map());
    const person = candidates.get(recipientId)!;
    person.set(ruleId, [...(person.get(ruleId) || []), evidence]);
  };
  for (const issuance of issuances) {
    const draft = snapshotDraft(issuance.snapshot);
    if (!draft) continue;
    for (const row of draft.items) {
      if (
        !row.recipientId ||
        (row.employerId || draft.customerId) !== customer.id
      )
        continue;
      recipientIds.add(row.recipientId);
      for (const assignment of row.assignments) {
        const event = draft.events?.find(
          (value) => value.id === assignment.eventId,
        );
        const rule = rules.find(
          (value) => value.id === event?.serviceRuleVersionId,
        );
        if (!rule) continue;
        const document = documents.find(
          (value) =>
            value.issuanceId === issuance.id &&
            ((value.rowId === row.id && value.assignmentId === assignment.id) ||
              (value.ownerKind === "GROUP" &&
                value.groupEventId === event!.id &&
                members.some(
                  (member) =>
                    member.documentId === value.id &&
                    member.recipientId === row.recipientId &&
                    member.rowId === row.id &&
                    member.assignmentId === assignment.id,
                ))),
        );
        if (!document) continue;
        const superseded =
          events.some(
            (value) =>
              value.issuanceId === issuance.id &&
              ["CANCELLED", "REPLACED", "SUPERSEDED"].includes(value.kind),
          ) ||
          documents.some((value) => value.replacesDocumentId === document.id);
        append(row.recipientId, rule.id, {
          source: "OWN",
          sourceReference: `Реестр центра; неизменяемый выпуск ${issuance.id}`,
          documentId: document.id,
          originalNumber: document.number,
          issuer: tenant.name,
          documentDate: document.documentDate,
          validUntil: assignment.validUntil || null,
          status: superseded
            ? "SUPERSEDED"
            : assignment.outcome?.status === "PASSED"
              ? "VERIFIED"
              : "UNVERIFIED",
        });
      }
    }
  }
  for (const evidence of external)
    for (const rule of rules) {
      if (
        ![rule.serviceKey, rule.title].some(
          (value) => normalized(value) === normalized(evidence.program),
        )
      )
        continue;
      append(evidence.recipientId, rule.id, {
        source: "EXTERNAL",
        sourceReference: evidence.source,
        documentId: evidence.id,
        originalNumber: evidence.originalNumber,
        issuer: evidence.issuer,
        documentDate: evidence.documentDate,
        validUntil: evidence.validUntil,
        status: evidence.status,
      });
    }
  if (recipientIds.size > 2000)
    fail(
      413,
      "MATRIX_RECIPIENT_LIMIT",
      "Матрица ограничена 2000 подтверждёнными идентификаторами получателей",
    );
  const people = await db.recipient.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: [...recipientIds].filter(
          (id) => !permittedRecipientIds || permittedRecipientIds.includes(id),
        ),
      },
    },
  });
  const asOf = today(tenant.timezone);
  const rank = (entry: MatrixEvidence) =>
    entry.status === "SUPERSEDED"
      ? 0
      : entry.status !== "VERIFIED"
        ? 1
        : entry.validUntil && entry.validUntil < asOf
          ? 2
          : 3;
  return {
    customerId: customer.id,
    asOf,
    columns: rules.map((rule) => ({
      id: rule.id,
      serviceKey: rule.serviceKey,
      title: rule.title,
      version: rule.version,
    })),
    rows: people.map((person) => ({
      recipientId: person.id,
      fullNameRu: String(
        (person.data as Record<string, unknown>).fullNameRu || "",
      ),
      currentness: employments.some((value) => value.recipientId === person.id)
        ? "CONFIRMED_RELATION"
        : "REQUIRES_CONFIRMATION",
      cells: rules.map((rule) => {
        const evidence = [
          ...(candidates.get(person.id)?.get(rule.id) || []),
        ].sort(
          (a, b) =>
            rank(b) - rank(a) ||
            b.documentDate.localeCompare(a.documentDate) ||
            (a.status !== "VERIFIED" && b.status !== "VERIFIED"
              ? Number(b.source === "EXTERNAL") -
                Number(a.source === "EXTERNAL")
              : 0),
        );
        const selected = evidence[0] || null;
        const state = evidenceState(selected, asOf);
        return {
          ruleId: rule.id,
          state,
          source: selected?.source || null,
          sourceReference: selected?.sourceReference || null,
          documentId: selected?.documentId || null,
          originalNumber: selected?.originalNumber || null,
          issuer: selected?.issuer || null,
          documentDate: selected?.documentDate || null,
          validUntil: selected?.validUntil || null,
          nextAction:
            state === "UNKNOWN"
              ? "Запросить исходные сведения"
              : state === "UNVERIFIED"
                ? selected?.source === "OWN"
                  ? "Нет подтверждённого положительного результата; уточнить исход попытки или согласовать пересдачу"
                  : "Проверить внешний документ и источник"
                : state === "REVIEW_DATE_PASSED" || state === "APPROACHING"
                  ? "Подтвердить актуальность сотрудника и потребность"
                  : state === "SUPERSEDED"
                    ? "Запросить действующий источник"
                    : state === "VERIFIED_NO_EXPIRY"
                      ? "Уточнить применимость и срок по источнику"
                      : "Сведения сохранены; проверять применимость по паспорту",
          evidence,
        };
      }),
    })),
    limitation:
      "Матрица сопоставляет выбранные согласованные услуги с сохранёнными источниками. Связь с работодателем не подтверждает текущее трудоустройство. Срок документа не равен дате следующей проверки знаний и не устанавливает допуск к работе. Внешний документ сопоставляется по точному коду или названию паспорта.",
  };
}
