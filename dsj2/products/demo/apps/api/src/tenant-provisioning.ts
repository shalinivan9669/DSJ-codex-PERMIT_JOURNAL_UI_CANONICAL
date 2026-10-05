import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Response } from "express";
import {
  customerSchema,
  profileSchema,
  registrationSchema,
  templateIds,
  type RegistrationInput,
} from "@demo/contracts";
import { ArtifactStore, PRODUCT_ROOT, templateManifest } from "@demo/printing";
import { db, audit, fail, hash, json, parse, type DemoRequest } from "./core";
import { passwordHash, rateLimit, sessionCookies } from "./auth";

export type PreparedRegistrationTemplate = {
  templateId: string;
  version: string;
  checksum: string;
  storageKey: string;
  contract: Record<string, unknown>;
};

export async function prepareRegistrationTemplates(): Promise<
  PreparedRegistrationTemplate[]
> {
  const manifest = (await templateManifest()) as Awaited<
    ReturnType<typeof templateManifest>
  > & { groupTemplates?: Array<Record<string, unknown>> };
  const groups = manifest.groupTemplates || [];
  const templates = [
    ...manifest.templates,
    ...groups,
    ...(manifest.specialTemplates || []),
  ];
  const individualIds = manifest.templates.map((template) => template.id);
  const protocolIds = templateIds.filter((id) => id.endsWith("-protocol"));
  if (
    individualIds.length !== templateIds.length ||
    templateIds.some((id) => !individualIds.includes(id)) ||
    groups.length !== protocolIds.length ||
    protocolIds.some(
      (id) =>
        !groups.some((entry) => entry.id === id && entry.ownerKind === "GROUP"),
    )
  )
    throw new Error("REGISTRATION_TEMPLATE_MANIFEST_INCOMPLETE");
  const validated = await Promise.all(
    templates.map(async (template) => {
      if (
        typeof template.id !== "string" ||
        typeof template.file !== "string" ||
        !/^[a-z0-9][a-z0-9.-]*\.docx$/.test(template.file) ||
        !template.version
      )
        throw new Error("REGISTRATION_TEMPLATE_MANIFEST_INVALID");
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", template.file),
      );
      if (createHash("sha256").update(bytes).digest("hex") !== template.sha256)
        throw new Error("REGISTRATION_TEMPLATE_CHECKSUM_MISMATCH");
      return { template, bytes };
    }),
  );
  const store = new ArtifactStore();
  const prepared: PreparedRegistrationTemplate[] = [];
  for (const { template, bytes } of validated) {
    const stored = await store.put(bytes, "docx");
    prepared.push({
      templateId: String(template.id),
      version: String(template.version),
      checksum: stored.sha256,
      storageKey: stored.storageKey,
      contract: template,
    });
  }
  return prepared;
}

/** All tenant-owned records commit together. Prepared immutable file bytes are not public. */
export async function provisionRegisteredCenter(
  data: RegistrationInput,
  digest: string,
  templates: PreparedRegistrationTemplate[],
  session: { token: string; csrf: string; correlationId: string },
) {
  const names = customerSchema.parse({
    legalForm: data.legalForm,
    ownNameRu: data.ownNameRu,
    ownNameKz: data.ownNameKz,
  });
  const profile = profileSchema.parse({
    nameRu: names.nameRu,
    nameKz: names.nameKz,
    legalForm: names.legalForm,
    ownNameRu: names.ownNameRu,
    ownNameKz: names.ownNameKz,
    addressRu: "",
    addressKz: "",
    cityRu: "",
    cityKz: "",
    approvalBasis: "",
    commission: [],
    approved: false,
  });
  return db.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: names.nameRu, demoOnly: false },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: data.email,
          displayName: data.displayName,
          passwordHash: digest,
          role: "DIRECTOR",
        },
      });
      const c = {
        tenantId: tenant.id,
        userId: user.id,
        role: "DIRECTOR",
        sessionId: hash(session.token),
        csrfHash: hash(session.csrf),
        correlationId: session.correlationId,
      };
      await tx.issuerProfileVersion.create({
        data: {
          tenantId: tenant.id,
          version: 1,
          profile: json(profile),
          createdBy: user.id,
        },
      });
      for (const template of templates)
        await tx.templateVersion.create({
          data: {
            tenantId: tenant.id,
            ...template,
            contract: json(template.contract),
            approved: false,
          },
        });
      const namespaces = [
        ...new Set(
          templateIds.map(
            (id) =>
              `${id.split("-")[0].toUpperCase()}:${id.endsWith("protocol") ? "PROTOCOL" : id.endsWith("witness") ? "WITNESS" : id.endsWith("certificate") ? "CERTIFICATE" : "CARD"}`,
          ),
        ),
        "PS:REGISTRATION",
      ];
      for (const namespace of namespaces)
        await tx.numberSequence.create({
          data: {
            tenantId: tenant.id,
            namespace,
            prefix: namespace.replace(":", "-") + "-",
          },
        });
      await tx.session.create({
        data: {
          id: c.sessionId,
          tenantId: tenant.id,
          userId: user.id,
          csrfHash: c.csrfHash,
          sessionVersion: user.sessionVersion,
          expiresAt: new Date(Date.now() + 8 * 3600_000),
        },
      });
      await audit(tx, c, "CENTER_REGISTERED", tenant.id);
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
        },
        tenant: { id: tenant.id, name: tenant.name, timezone: tenant.timezone },
        csrfToken: session.csrf,
      };
    },
    { maxWait: 20000, timeout: 30000 },
  );
}

let activeRegistrations = 0;
export async function registerCenter(
  req: DemoRequest,
  res: Response,
  input: unknown,
) {
  // The API sees the local proxy address. Do not trust caller-supplied forwarding headers.
  rateLimit("register:global", 30);
  const data = parse(registrationSchema, input);
  rateLimit(`register:email:${hash(data.email)}`, 4, 10 * 60_000);
  if (activeRegistrations >= 2)
    fail(
      429,
      "REGISTRATION_BUSY",
      "Регистрация занята. Повторите через минуту.",
    );
  activeRegistrations++;
  try {
    if (
      await db.user.findUnique({
        where: { email: data.email },
        select: { id: true },
      })
    )
      fail(
        409,
        "REGISTRATION_EXISTS",
        "Этот адрес уже используется. Войдите в существующий центр.",
      );
    const digest = await passwordHash(data.password);
    const templates = await prepareRegistrationTemplates();
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    const result = await provisionRegisteredCenter(data, digest, templates, {
      token,
      csrf,
      correlationId: req.correlationId,
    });
    sessionCookies(res, token, csrf);
    return result;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      fail(
        409,
        "REGISTRATION_EXISTS",
        "Этот адрес уже используется. Войдите в существующий центр.",
      );
    throw error;
  } finally {
    activeRegistrations--;
  }
}
