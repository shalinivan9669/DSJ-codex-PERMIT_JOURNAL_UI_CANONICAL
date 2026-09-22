import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, json } from "../apps/api/src/core";
import { passwordHash } from "../apps/api/src/auth";
import {
  ArtifactStore,
  templateManifest,
  PRODUCT_ROOT,
} from "../packages/printing/src";
import { templateIds } from "../packages/contracts/src";
export async function provision(input: {
  email: string;
  password: string;
  name: string;
  sample?: boolean;
}) {
  if (input.password.length < 12) throw new Error("ADMIN_PASSWORD_MIN_12");
  let user = await db.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });
  let tenant = user
    ? await db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } })
    : null;
  if (!user) {
    tenant = await db.tenant.create({
      data: { name: input.name, demoOnly: !!input.sample },
    });
    user = await db.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email.toLowerCase(),
        displayName: "Администратор",
        role: "ADMIN",
        passwordHash: await passwordHash(input.password),
      },
    });
  }
  if (input.sample && !tenant!.demoOnly)
    throw new Error("EXISTING_PRODUCTION_TENANT_CANNOT_BECOME_DEMO");
  const store = new ArtifactStore();
  const manifest = await templateManifest();
  for (const template of manifest.templates) {
    const bytes = await readFile(
      join(PRODUCT_ROOT, "assets/templates", String(template.file)),
    );
    const checksum = await import("node:crypto").then((m) =>
      m.createHash("sha256").update(bytes).digest("hex"),
    );
    if (checksum !== template.sha256)
      throw new Error(`TEMPLATE_CHECKSUM_MISMATCH:${template.id}`);
    const where = {
      tenantId_templateId_version: {
        tenantId: tenant!.id,
        templateId: String(template.id),
        version: String(template.version),
      },
    };
    const existing = await db.templateVersion.findUnique({ where });
    if (existing && existing.checksum !== checksum)
      throw new Error(`TEMPLATE_VERSION_ALREADY_IMMUTABLE:${template.id}`);
    if (!existing) {
      const asset = await store.put(bytes, "docx");
      await db.templateVersion.create({
        data: {
          tenantId: tenant!.id,
          templateId: String(template.id),
          version: String(template.version),
          checksum,
          storageKey: asset.storageKey,
          contract: json(template),
          approved: !!input.sample,
        },
      });
    }
  }
  for (const name of [
    ...new Set(
      templateIds.map(
        (id) =>
          id.split("-")[0].toUpperCase() +
          ":" +
          (id.endsWith("protocol")
            ? "PROTOCOL"
            : id.endsWith("witness")
              ? "WITNESS"
              : id.endsWith("certificate")
                ? "CERTIFICATE"
                : "CARD"),
      ),
    ),
    "PS:REGISTRATION",
  ])
    await db.numberSequence.upsert({
      where: { tenantId_namespace: { tenantId: tenant!.id, namespace: name } },
      create: {
        tenantId: tenant!.id,
        namespace: name,
        prefix: name.replace(":", "-") + "-",
      },
      update: {},
    });
  if (
    input.sample &&
    !(await db.issuerProfileVersion.findFirst({
      where: { tenantId: tenant!.id },
    }))
  ) {
    await db.issuerProfileVersion.create({
      data: {
        tenantId: tenant!.id,
        version: 1,
        createdBy: user.id,
        profile: {
          nameRu: "Синтетический учебный центр",
          nameKz: "Синтетикалық оқу орталығы",
          addressRu: "Демонстрационный адрес",
          addressKz: "Көрнекі мекенжай",
          cityRu: "Кызылорда",
          cityKz: "Қызылорда",
          approvalBasis: "Учебный набор — не является выданным документом",
          commission: [
            { name: "Тестовый Председатель", position: "Синтетические данные" },
          ],
          approved: true,
        },
      },
    });
  }
  return { tenantId: tenant!.id, userId: user.id, email: user.email };
}
if (require.main === module) {
  const email = process.env.DEMO_ADMIN_EMAIL;
  const password = process.env.DEMO_ADMIN_PASSWORD;
  const name = process.env.DEMO_TENANT_NAME;
  if (!email || !password || !name)
    throw new Error(
      "Set DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD (12+), DEMO_TENANT_NAME; no default credentials",
    );
  provision({
    email,
    password,
    name,
    sample: process.env.DEMO_SAMPLE_DATA === "1",
  })
    .then((result) =>
      console.log(
        JSON.stringify({
          setup: "complete",
          tenantId: result.tenantId,
          sample: process.env.DEMO_SAMPLE_DATA === "1",
        }),
      ),
    )
    .finally(() => db.$disconnect());
}
