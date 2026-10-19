import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db, type Context } from "../../apps/api/src/core";
import { lmsTenant, lmsCourse, lmsLearner } from "./lms-fixture";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  createEmployerImport,
  confirmEmployerImport,
  employerImportDetail,
  updateEmployerImport,
  importAction,
  listEmployerImports,
  assignmentSelection,
  parseEmployerImportFile,
} from "../../apps/api/src/lms/employer-import";
import { runEmployerImportTick } from "../../apps/api/src/lms/employer-import-worker";
import {
  ownLmsProfile,
  saveOwnLmsProfile,
  lmsWorkplace,
} from "../../apps/api/src/lms/workplace";
import { runAssignmentChunk } from "../../apps/api/src/lms/assignment-operations";

test("N03/N04 employer import persists, automatically assigns, survives lease/revocation and safe identity branches", async (t) => {
  t.after(() => db.$disconnect());
  for (let i = 0; i < 100 && (await runEmployerImportTick()); i++) {
    /* settle only this disposable test database's prior interrupted fixtures */
  }
  const center = await lmsTenant("pass02 employer"),
    foreign = await lmsTenant("pass02 foreign");
  const customer = await db.customerOrganization.create({
    data: { tenantId: center.tenant.id, nameRu: "Synthetic employer import" },
  });
  const other = await db.customerOrganization.create({
    data: { tenantId: center.tenant.id, nameRu: "Synthetic other employer" },
  });
  const user = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic employer",
      role: "EMPLOYER",
      passwordHash: "unused",
    },
  });
  const membership = await db.employerMembership.create({
    data: {
      tenantId: center.tenant.id,
      userId: user.id,
      customerId: customer.id,
      permissions: ["READ", "ASSIGN_TRAINING"],
      createdBy: center.user.id,
    },
  });
  const c: Context = { ...center.context, userId: user.id, role: "EMPLOYER" };
  const created = await createCourse(
    center.context,
    lmsCourse({ questions: 1, required: false }),
  );
  const version = await publishVersion(center.context, created.version.id, {
    revision: 0,
  });
  const rows = Array.from({ length: 260 }, (_, i) => ({
    sourceRow: i + 1,
    fullNameRu: `Synthetic import ${i}`,
    iin: String(i + 1).padStart(12, "0"),
    positionRu: "Synthetic worker",
  }));
  const input = {
    id: randomUUID(),
    customerId: customer.id,
    courseVersionId: version.id,
    rows,
  };
  let draft = await createEmployerImport(c, input);
  assert.equal(draft.total, 260);
  assert.equal(draft.rows.length, 50);
  assert.equal(draft.errors, 0);
  assert.equal((await createEmployerImport(c, input)).id, draft.id);
  await assert.rejects(
    createEmployerImport(c, {
      ...input,
      rows: [...rows, { sourceRow: 261, fullNameRu: "Different" }],
    }),
  );
  await assert.rejects(employerImportDetail(foreign.context, draft.id, {}));
  await assert.rejects(
    createEmployerImport(c, {
      ...input,
      id: randomUUID(),
      customerId: other.id,
    }),
  );
  await Promise.all([
    confirmEmployerImport(c, draft.id, { revision: draft.revision }),
    confirmEmployerImport(c, draft.id, { revision: draft.revision }),
  ]);
  await runEmployerImportTick();
  assert.equal((await employerImportDetail(c, draft.id, {})).cursor, 50);
  await db.lmsEmployerImport.update({
    where: { id: draft.id },
    data: {
      leaseToken: "synthetic-dead-worker",
      leaseUntil: new Date(Date.now() - 1),
    },
  });
  for (let i = 0; i < 5; i++) await runEmployerImportTick();
  assert.equal((await employerImportDetail(c, draft.id, {})).cursor, 260);
  await runEmployerImportTick();
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    100,
  );
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { permissions: ["READ"] },
  });
  await runEmployerImportTick();
  draft = await employerImportDetail(c, draft.id, {});
  assert.equal(draft.state, "PAUSED");
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    100,
  );
  await assert.rejects(importAction(c, draft.id, { action: "RESUME" }));
  await importAction(center.context, draft.id, { action: "RESUME" });
  await Promise.all([runEmployerImportTick(), runEmployerImportTick()]);
  for (let i = 0; i < 5; i++) await runEmployerImportTick();
  draft = await employerImportDetail(c, draft.id, {});
  assert.equal(draft.state, "COMPLETED");
  assert.equal(draft.assignment?.cursor, 260);
  assert.equal(
    (
      await db.lmsAssignmentOperation.findFirstOrThrow({
        where: { id: draft.operationId! },
      })
    ).actorId,
    center.user.id,
  );
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { permissions: ["READ", "ASSIGN_TRAINING"] },
  });
  assert.equal(
    await db.recipient.count({ where: { tenantId: center.tenant.id } }),
    260,
  );
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    260,
  );
  const selection = await assignmentSelection(c, {
    search: "Synthetic import",
  });
  assert.equal(selection.total, 260);
  assert.equal(new Set(selection.recipientIds).size, 260);
  assert.equal((await assignmentSelection(c, { search: "%" })).total, 0);
  const xlsx = await readFile("apps/web/e2e/fixtures/import-formula.xlsx");
  const firstSheet = await parseEmployerImportFile(c, {
    originalname: "import-formula.xlsx",
    size: xlsx.length,
    buffer: xlsx,
  } as Express.Multer.File);
  const parsedFile = await parseEmployerImportFile(
    c,
    {
      originalname: "import-formula.xlsx",
      size: xlsx.length,
      buffer: xlsx,
    } as Express.Multer.File,
    firstSheet.sheets[1],
  );
  assert.ok(
    parsedFile.rawRows.some((row) =>
      row.errors?.includes("FORMULA_NOT_ALLOWED"),
    ),
    "Excel formula remains an explicit source-row error",
  );
  assert.equal(
    (await employerImportDetail(c, draft.id, { page: 6 })).rows.length,
    10,
  );
  const known = await db.recipient.findFirstOrThrow({
    where: {
      tenantId: center.tenant.id,
      data: { path: ["iin"], equals: "000000000001" },
    },
  });
  let ambiguous = await createEmployerImport(c, {
    ...input,
    id: randomUUID(),
    rows: [{ sourceRow: 1, fullNameRu: "Synthetic import 0" }],
  });
  assert.equal(ambiguous.errors, 1);
  assert.equal(ambiguous.rows[0].preview?.candidates[0].id, known.id);
  await assert.rejects(confirmEmployerImport(c, ambiguous.id, { revision: 0 }));
  await updateEmployerImport(c, ambiguous.id, {
    revision: 0,
    rows: [
      {
        sourceRow: 1,
        fullNameRu: "Synthetic import 0",
        recipientId: known.id,
        resolution: "REUSE",
      },
    ],
  });
  await assert.rejects(
    updateEmployerImport(c, ambiguous.id, {
      revision: 0,
      rows: [{ sourceRow: 1, fullNameRu: "Stale" }],
    }),
  );
  ambiguous = await employerImportDetail(c, ambiguous.id, {});
  assert.equal(ambiguous.errors, 0);
  await confirmEmployerImport(c, ambiguous.id, {
    revision: ambiguous.revision,
  });
  for (let i = 0; i < 3; i++) await runEmployerImportTick();
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    260,
    "known repeat upload reuses original enrollment",
  );
  const repeated = await runAssignmentChunk(c, {
    operationId: randomUUID(),
    courseVersionId: version.id,
    recipientIds: [known.id],
    customerId: customer.id,
    repeatTraining: true,
  });
  assert.equal(repeated.created, 1);
  assert.equal(
    await db.enrollment.count({
      where: { tenantId: center.tenant.id, recipientId: known.id },
    }),
    2,
  );
  const protectedRecipient = await db.recipient.create({
    data: {
      tenantId: center.tenant.id,
      data: { fullNameRu: "Synthetic protected", iin: "999999999999" },
    },
  });
  await db.recipientEmployment.create({
    data: {
      tenantId: center.tenant.id,
      recipientId: protectedRecipient.id,
      employerId: other.id,
      createdBy: center.user.id,
    },
  });
  const collision = await createEmployerImport(c, {
    ...input,
    id: randomUUID(),
    rows: [
      { sourceRow: 1, fullNameRu: "Synthetic hidden", iin: "999999999999" },
    ],
  });
  assert.equal(collision.errors, 1);
  assert.deepEqual(collision.rows[0].preview?.candidates, []);
  assert.ok(
    collision.rows[0].preview?.errors.includes("CENTER_IDENTITY_REVIEW"),
  );
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { permissions: ["READ"] },
  });
  const readOnlyInput = {
    ...input,
    id: randomUUID(),
    rows: [{ sourceRow: 1, fullNameRu: "Synthetic submit only" }],
  };
  await assert.rejects(
    createEmployerImport(c, readOnlyInput),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 403,
  );
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { permissions: ["READ", "ASSIGN_TRAINING"] },
  });
  const readOnly = await createEmployerImport(c, readOnlyInput);
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { permissions: ["READ"] },
  });
  await assert.rejects(
    confirmEmployerImport(c, readOnly.id, { revision: 0 }),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 403,
  );
  assert.equal((await employerImportDetail(c, readOnly.id, {})).canEdit, false);
  assert.equal((await employerImportDetail(c, readOnly.id, {})).state, "DRAFT");
  const pending = await employerImportDetail(center.context, readOnly.id, {});
  assert.equal(pending.canEdit, true);
  await assert.rejects(
    updateEmployerImport(c, readOnly.id, {
      revision: pending.revision,
      rows: [{ sourceRow: 1, fullNameRu: "Forbidden change" }],
    }),
  );
  await updateEmployerImport(center.context, readOnly.id, {
    revision: pending.revision,
    rows: [{ sourceRow: 1, fullNameRu: "Synthetic submit reviewed" }],
  });
  await confirmEmployerImport(center.context, readOnly.id, {
    revision: pending.revision + 1,
  });
  for (let i = 0; i < 3; i++) await runEmployerImportTick();
  assert.equal(
    (await employerImportDetail(c, readOnly.id, {})).state,
    "COMPLETED",
  );
  const cancel = await createEmployerImport(center.context, {
    ...input,
    id: randomUUID(),
    rows: [{ sourceRow: 1, fullNameRu: "Synthetic cancel" }],
  });
  await confirmEmployerImport(center.context, cancel.id, { revision: 0 });
  await importAction(center.context, cancel.id, { action: "CANCEL" });
  await runEmployerImportTick();
  assert.equal(
    await db.recipient.count({
      where: {
        tenantId: center.tenant.id,
        data: { path: ["fullNameRu"], equals: "Synthetic cancel" },
      },
    }),
    0,
  );
  const learner = await lmsLearner(center.tenant.id, "profile");
  const profile = await ownLmsProfile(learner.context);
  const saved = await saveOwnLmsProfile(learner.context, {
    revision: profile.revision,
    displayName: "Synthetic display only",
    preferences: { language: "kz", showUnreadBadge: false },
  });
  assert.equal(saved.fullNameRu, profile.fullNameRu);
  await assert.rejects(
    saveOwnLmsProfile(learner.context, {
      revision: saved.revision,
      displayName: "Other",
      preferences: {},
      recipientId: known.id,
    }),
  );
  assert.equal((await lmsWorkplace(c)).enrollments.total, 262);
  const racing = await createEmployerImport(center.context, {
    ...input,
    id: randomUUID(),
    rows: [
      {
        sourceRow: 1,
        fullNameRu: "Synthetic raced identity",
        iin: "777777777777",
      },
      { sourceRow: 2, fullNameRu: "Synthetic successful sibling" },
    ],
  });
  await confirmEmployerImport(center.context, racing.id, { revision: 0 });
  const conflictPerson = await db.recipient.create({
    data: {
      tenantId: center.tenant.id,
      data: { fullNameRu: "Synthetic hidden race", iin: "777777777777" },
    },
  });
  await db.recipientEmployment.create({
    data: {
      tenantId: center.tenant.id,
      recipientId: conflictPerson.id,
      employerId: other.id,
      createdBy: center.user.id,
    },
  });
  for (let i = 0; i < 4; i++) await runEmployerImportTick();
  const partly = await employerImportDetail(center.context, racing.id, {});
  assert.equal(partly.state, "COMPLETED");
  assert.equal(partly.failedRows, 1);
  assert.equal(partly.assignment?.created, 1);
  const repair = await importAction(center.context, racing.id, {
    action: "REPAIR",
  });
  assert.equal(repair.total, 1);
  assert.equal(repair.rows[0].sourceRow, 1);
  assert.equal(
    (await importAction(center.context, racing.id, { action: "REPAIR" })).id,
    repair.id,
  );
  await updateEmployerImport(center.context, repair.id, {
    revision: repair.revision,
    rows: [
      {
        sourceRow: 1,
        fullNameRu: "Synthetic corrected identity",
        iin: "777777777778",
      },
    ],
  });
  await confirmEmployerImport(center.context, repair.id, {
    revision: repair.revision + 1,
  });
  for (let i = 0; i < 4; i++) await runEmployerImportTick();
  assert.equal(
    (await employerImportDetail(center.context, repair.id, {})).assignment
      ?.created,
    1,
  );
  assert.equal(
    await db.enrollment.count({ where: { tenantId: center.tenant.id } }),
    264,
    "repair did not repeat successful sibling",
  );
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { recipientIds: [known.id] },
  });
  await assert.rejects(employerImportDetail(c, draft.id, {}));
  assert.ok(!(await listEmployerImports(c)).some((row) => row.id === draft.id));
  await db.employerMembership.update({
    where: { id: membership.id },
    data: { active: false },
  });
  assert.deepEqual(await listEmployerImports(c), []);
  await assert.rejects(employerImportDetail(c, draft.id, {}));
});
