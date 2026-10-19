import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Prisma } from "@demo/database";
import { audit, db, fail, json, transaction, type Context } from "../core";
import { isLmsStaff } from "./scope";
import { runAssignmentChunk } from "./assignment-operations";
import { EMPLOYER_IMPORT_CHUNK } from "./employer-import-rules";
import {
  evaluateImport,
  importCourse,
  importInputSchema,
  importMembership,
} from "./employer-import";

/** A lease owns preparation; existing assignment row locking owns enrollment effects. */
export async function runEmployerImportTick() {
  const token = randomUUID();
  const claimed = await db.$queryRaw<{ id: string; tenantId: string }[]>(
    Prisma.sql`WITH candidate AS (SELECT id FROM "LmsEmployerImport" WHERE state IN ('QUEUED','PROCESSING','ASSIGNING') AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE "LmsEmployerImport" d SET "leaseToken"=${token},"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes',"updatedAt"=CURRENT_TIMESTAMP FROM candidate WHERE d.id=candidate.id RETURNING d.id,d."tenantId"`,
  );
  if (!claimed[0]) return false;
  const target = claimed[0];
  try {
    const next = await transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "LmsEmployerImport" WHERE id=${target.id} FOR UPDATE`;
      const draft = await tx.lmsEmployerImport.findFirstOrThrow({
        where: { id: target.id, tenantId: target.tenantId },
      });
      if (draft.leaseToken !== token || draft.state === "CANCELLED")
        return null;
      await tx.$executeRaw`SELECT id FROM "User" WHERE id=${draft.confirmedBy || draft.actorId} AND "tenantId"=${draft.tenantId} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: {
          tenantId: draft.tenantId,
          id: draft.confirmedBy || draft.actorId,
          active: true,
        },
      });
      if (!user)
        fail(
          403,
          "IMPORT_AUTHORITY_REVOKED",
          "Полномочия подтверждавшего пользователя отозваны",
        );
      const c: Context = {
        tenantId: draft.tenantId,
        userId: user.id,
        role: user.role,
        sessionId: "",
        csrfHash: "",
        correlationId: `import:${draft.id}`,
        source: "LMS_IMPORT_WORKER",
      };
      if (!isLmsStaff(c) && c.role !== "EMPLOYER")
        fail(
          403,
          "IMPORT_AUTHORITY_REVOKED",
          "Полномочия подтверждавшего пользователя отозваны",
        );
      await importMembership(c, draft.customerId, true, tx);
      await importCourse(c, draft.courseVersionId, tx);
      const input = importInputSchema.parse(draft.input);
      if (draft.cursor < input.rows.length) {
        const rows = input.rows.slice(
          draft.cursor,
          draft.cursor + EMPLOYER_IMPORT_CHUNK,
        );
        // The tenant lock prevents simultaneous imports from creating the same strong identifier.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${draft.tenantId + ":employer-recipient-import"},0))`;
        const evaluated = await evaluateImport(
          c,
          { ...draft, input: json({ ...input, rows }) },
          tx,
        );
        const customer = await tx.customerOrganization.findFirst({
          where: {
            tenantId: draft.tenantId,
            id: draft.customerId,
            archived: false,
          },
        });
        if (!customer)
          fail(409, "EMPLOYER_IMPORT_DENIED", "Организация недоступна");
        for (const entry of evaluated) {
          if (
            await tx.lmsEmployerImportRow.findUnique({
              where: {
                tenantId_importId_sourceRow: {
                  tenantId: c.tenantId,
                  importId: draft.id,
                  sourceRow: entry.row.sourceRow,
                },
              },
            })
          )
            continue;
          let recipientId = entry.recipientId;
          if (!entry.errors.length && entry.outcome === "REUSED" && recipientId && isLmsStaff(c)) {
            const employment = await tx.recipientEmployment.findFirst({ where: { tenantId: c.tenantId, recipientId, employerId: customer.id } });
            if (!employment) {
              await tx.recipientEmployment.create({ data: { tenantId: c.tenantId, recipientId, employerId: customer.id, positionRu: entry.row.positionRu, createdBy: c.userId } });
              await audit(tx, c, "LMS_IMPORT_EMPLOYMENT_CONFIRMED", recipientId, { customerId: customer.id, importId: draft.id, sourceRow: entry.row.sourceRow });
            }
          }
          if (!entry.errors.length && entry.outcome === "NEW") {
            const recipient = await tx.recipient.create({
              data: {
                tenantId: c.tenantId,
                data: json({
                  id: randomUUID(),
                  fullNameRu: entry.row.fullNameRu,
                  fullNameKz: "",
                  iin: entry.row.iin,
                  phone: entry.row.phone,
                  email: entry.row.email,
                  positionRu: entry.row.positionRu,
                  positionKz: "",
                  workplaceRu: customer.nameRu,
                  workplaceKz: customer.nameKz || "",
                  employerId: customer.id,
                  assignments: [],
                }),
              },
            });
            recipientId = recipient.id;
            await tx.recipientEmployment.create({
              data: {
                tenantId: c.tenantId,
                recipientId,
                employerId: customer.id,
                positionRu: entry.row.positionRu,
                createdBy: c.userId,
              },
            });
          }
          await tx.lmsEmployerImportRow.create({
            data: {
              tenantId: c.tenantId,
              importId: draft.id,
              sourceRow: entry.row.sourceRow,
              recipientId,
              outcome: entry.errors.length ? "ERROR" : entry.outcome,
              errorCode: entry.errors[0] || null,
            },
          });
        }
        const cursor = draft.cursor + rows.length;
        await tx.lmsEmployerImport.update({
          where: { id: draft.id },
          data: {
            cursor,
            state: cursor >= input.rows.length ? "ASSIGNING" : "PROCESSING",
          },
        });
        await audit(tx, c, "LMS_EMPLOYER_IMPORT_CHUNK", draft.id, {
          before: { cursor: draft.cursor },
          after: { cursor },
          rows: rows.length,
        });
        return null;
      }
      const recipients = await tx.lmsEmployerImportRow.findMany({
        where: {
          tenantId: c.tenantId,
          importId: draft.id,
          outcome: { in: ["NEW", "REUSED"] },
          recipientId: { not: null },
        },
        select: { recipientId: true },
        orderBy: { sourceRow: "asc" },
      });
      if (!recipients.length) {
        await tx.lmsEmployerImport.update({
          where: { id: draft.id },
          data: { state: "COMPLETED" },
        });
        return null;
      }
      if (draft.state !== "ASSIGNING")
        await tx.lmsEmployerImport.update({
          where: { id: draft.id },
          data: { state: "ASSIGNING" },
        });
      return {
        c,
        input: {
          courseVersionId: draft.courseVersionId,
          recipientIds: recipients.map((row) => row.recipientId!),
          customerId: draft.customerId,
          sourceOrderId: draft.sourceOrderId,
          sourceRequestId: draft.sourceRequestId,
          groupId: draft.groupId || undefined,
          groupName: draft.groupName,
          dueAt: draft.dueAt?.toISOString(),
          operationId: draft.operationId!,
          repeatTraining: input.repeatTraining,
        },
      };
    });
    if (next) {
      // Ownership check and assignment commit share an advisory lock with cancellation.
      const latest = await db.lmsEmployerImport.findFirst({
        where: {
          id: target.id,
          tenantId: target.tenantId,
          leaseToken: token,
          state: "ASSIGNING",
        },
      });
      if (latest) {
        const report = await runAssignmentChunk(next.c, next.input, {
          importLease: { id: target.id, token },
        });
        await db.lmsEmployerImport.updateMany({
          where: {
            id: target.id,
            tenantId: target.tenantId,
            leaseToken: token,
            state: "ASSIGNING",
          },
          data: {
            state:
              report.state === "COMPLETED"
                ? "COMPLETED"
                : report.state === "PAUSED"
                  ? "PAUSED"
                  : "ASSIGNING",
            errorCode: report.pauseError?.code || null,
          },
        });
      }
    }
  } catch (error) {
    const code =
      error instanceof HttpException
        ? String(
            (error.getResponse() as { code?: string }).code || "IMPORT_FAILED",
          )
        : "IMPORT_RETRY_REQUIRED";
    await db.lmsEmployerImport.updateMany({
      where: {
        id: target.id,
        tenantId: target.tenantId,
        leaseToken: token,
        state: { not: "CANCELLED" },
      },
      data: {
        state: error instanceof HttpException ? "PAUSED" : "FAILED",
        errorCode: code,
      },
    });
  } finally {
    await db.lmsEmployerImport.updateMany({
      where: { id: target.id, tenantId: target.tenantId, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
  return true;
}
