import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Serializes exam transitions for one assignment before locking any attempt. */
export async function lockTrainingAssignment(transaction: Prisma.TransactionClient, assignmentId: string) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "TrainingAssignment" WHERE "id" = ${assignmentId} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new NotFoundException("Назначенное обучение не найдено.");
  }
}
