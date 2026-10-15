import { PrismaClient } from "@demo/database";

async function main() {
  const target = new URL(process.env.DATABASE_URL || "");
  if (
    process.env.DEMO_LMS_TEST_RUNTIME !== "1" ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    !target.pathname.startsWith("/demo_test")
  )
    throw new Error("ISOLATED_LOCAL_TEST_DATABASE_REQUIRED");
  const resultId = process.argv[2];
  if (!/^[a-f0-9-]{36}$/.test(resultId || ""))
    throw new Error("EXACT_RESULT_ID_REQUIRED");
  const db = new PrismaClient();
  try {
    const result = await db.verifiedExamResult.findUniqueOrThrow({
      where: { id: resultId },
      select: {
        id: true,
        tenantId: true,
        enrollmentId: true,
        snapshotHash: true,
      },
    });
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: result.tenantId },
      select: { demoOnly: true },
    });
    if (!tenant.demoOnly) throw new Error("SYNTHETIC_TENANT_REQUIRED");
    const where = { tenantId: result.tenantId, resultId };
    const [outbox, journal, items, deliveries] = await Promise.all([
      db.regulatoryOutbox.findMany({ where }),
      db.sanitaryJournalEntry.findMany({
        where,
        select: {
          id: true,
          resultId: true,
          snapshotHash: true,
          signatureState: true,
        },
      }),
      db.regulatoryBatchItem.findMany({
        where,
        select: {
          id: true,
          batchId: true,
          resultId: true,
          journalEntryId: true,
          snapshotHash: true,
        },
      }),
      db.integrationDelivery.findMany({
        where,
        select: {
          id: true,
          resultId: true,
          batchItemId: true,
          state: true,
          lmkState: true,
          payloadHash: true,
        },
      }),
    ]);
    process.stdout.write(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        result,
        outbox,
        journal,
        items,
        deliveries,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "READBACK_FAILED");
  process.exitCode = 1;
});
