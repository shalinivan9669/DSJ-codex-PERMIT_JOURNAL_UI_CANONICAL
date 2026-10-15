import { readFile, writeFile } from "node:fs/promises";
import { db } from "../../apps/api/src/core";
import { createVerificationLink } from "../../apps/api/src/public-verification";
async function main() {
  const fixture = JSON.parse(
    await readFile(".runtime/lms-one-run/operator-fixture.json", "utf8"),
  );
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: fixture.tenantId },
  });
  if (!tenant.demoOnly) throw new Error("SYNTHETIC_ONLY");
  const user = await db.user.findUniqueOrThrow({
    where: { email: fixture.director },
  });
  const links = await db.lmsDocumentLink.findMany({
    where: { tenantId: tenant.id, resultId: fixture.resultId },
  });
  const context = {
    tenantId: tenant.id,
    userId: user.id,
    role: user.role,
    sessionId: "",
    csrfHash: "",
    correlationId: "lms-public-browser",
  };
  const data = [];
  for (const link of links) {
    const types = {
      PROTOCOL: "lms-protocol",
      CERTIFICATE: "lms-certificate",
      CREDENTIAL: "lms-credential",
    };
    const labels = {
      PROTOCOL: { ru: "Протокол", kz: "Хаттама" },
      CERTIFICATE: { ru: "Сертификат", kz: "Сертификат" },
      CREDENTIAL: { ru: "Удостоверение", kz: "Куәлік" },
    };
    const doc = await db.issuedDocument.findFirstOrThrow({
      where: {
        tenantId: tenant.id,
        issuanceId: link.issuanceId!,
        templateId: types[link.documentType as keyof typeof types],
      },
    });
    const published = await createVerificationLink(context, {
      documentId: doc.id,
      publicationConfirmed: true,
    });
    data.push({
      type: doc.templateId,
      number: doc.number,
      path: published.path,
      labels: labels[link.documentType as keyof typeof labels],
    });
  }
  await writeFile(
    ".runtime/lms-one-run/public-links.json",
    JSON.stringify(data),
  );
  console.log("PUBLIC_FIXTURE_READY " + data.length);
}
main().finally(() => db.$disconnect());
