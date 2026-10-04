import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  draftSchema,
  selectAssignmentScope,
} from "../../packages/contracts/src";
import { db, json, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import { submitApproval, workingRequest } from "../../apps/api/src/approvals";
import {
  createEmployerMembership,
  createServiceOrder,
  employerArtifactAccess,
  employerPortal,
  submitEmployerProposal,
  createServiceRule,
  resolveEmployerProposal,
} from "../../apps/api/src/operator-value";
import { portalEvidence } from "../../apps/api/src/portal-evidence";
import { provision } from "../../scripts/setup";
import { newAssignment, newRecipient } from "../../apps/web/lib/types";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";

test("external portal excludes waiting scope and working changes; prior issued batch remains visible and access uses its immutable employer", async (t) => {
  assertTestDatabase();
  const suffix = randomUUID();
  const who = await provision({
    email: `published-scope-${suffix}@example.test`,
    password: "Synthetic-published-scope!",
    name: "Синтетический центр опубликованной области",
    sample: true,
  });
  const admin: Context = {
    ...who,
    role: "ADMIN",
    csrfHash: "test",
    sessionId: "test",
    correlationId: suffix,
  };
  const approvals = await createApprovalFixture(admin);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const customer = await db.customerOrganization.create({
    data: { tenantId: who.tenantId, nameRu: "Исходный работодатель партии" },
  });
  const otherCustomer = await db.customerOrganization.create({
    data: {
      tenantId: who.tenantId,
      nameRu: "Поздний несогласованный работодатель",
    },
  });
  const users = await Promise.all(
    [0, 1].map((index) =>
      db.user.create({
        data: {
          tenantId: who.tenantId,
          email: `published-member-${index}-${suffix}@example.test`,
          displayName: "Синтетический представитель",
          role: "EMPLOYER",
          passwordHash: "unused-test-only",
        },
      }),
    ),
  );
  const members = users.map((user) => ({
    ...admin,
    userId: user.id,
    role: "EMPLOYER",
  }));
  for (const [index, organization] of [customer, otherCustomer].entries())
    await createEmployerMembership(admin, {
      customerId: organization.id,
      userId: users[index].id,
      permissions: ["READ", "DOWNLOAD", "PROPOSE"],
    });
  const pbEventId = randomUUID();
  const ptmEventId = randomUUID();
  const rules = await Promise.all(
    ["pb", "ptm"].map((direction) =>
      createServiceRule(admin, {
        serviceKey: `${direction}-${suffix}`,
        title: `${direction} синтетическая программа`,
        status: "APPROVED",
        source: "Синтетический проверенный источник",
        applicability: "Проверка публикации выбранного курса",
        checkedOn: "2026-10-01",
        definition: {
          programVersion: "1",
          category: "",
          compatibleTemplateIds: [`${direction}-card`, `${direction}-protocol`],
          requirements: [],
        },
      }),
    ),
  );
  const recipients = await Promise.all(
    ["Первая согласованная партия", "НЕПУБЛИКОВАТЬ_ОЖИДАЮЩЕГО_ЧЕЛОВЕКА"].map(
      (fullNameRu) =>
        db.recipient.create({
          data: { tenantId: who.tenantId, data: { fullNameRu } },
        }),
    ),
  );
  const first = {
    ...newRecipient(),
    fullNameRu: "Первая согласованная партия",
    positionRu: "Исходная должность",
    workplaceRu: customer.nameRu,
    employerId: customer.id,
    recipientId: recipients[0].id,
    assignments: [
      {
        ...newAssignment("pb-card"),
        eventId: pbEventId,
        protocolMode: "GROUP",
        documentDate: "2026-10-01",
        protocolDate: "2026-09-30",
        validUntil: "2029-10-01",
        hours: "40",
        outcome: {
          status: "PASSED",
          source: "Синтетическая фактическая ведомость первой партии",
        },
      },
      {
        ...newAssignment("ptm-card"),
        eventId: ptmEventId,
        protocolMode: "GROUP",
        trainingSubject: "НЕПУБЛИКОВАТЬ_ОЖИДАЮЩИЙ_КУРС",
        fieldOrigins: { trainingSubject: "MANUAL" },
        outcome: { status: "UNKNOWN", source: "" },
      },
    ],
  };
  const second = {
    ...newRecipient(),
    fullNameRu: "НЕПУБЛИКОВАТЬ_ОЖИДАЮЩЕГО_ЧЕЛОВЕКА",
    positionRu: "Оператор",
    workplaceRu: customer.nameRu,
    employerId: customer.id,
    recipientId: recipients[1].id,
    assignments: [
      {
        ...newAssignment("pb-card"),
        eventId: pbEventId,
        protocolMode: "GROUP",
        outcome: { status: "UNKNOWN", source: "" },
      },
    ],
  };
  const input = draftSchema.parse({
    kind: "COMPANY",
    customerId: customer.id,
    schemaVersion: 2,
    title: "Проверка области первого выпуска",
    events: [
      {
        id: pbEventId,
        title: "ПБ",
        protocolTemplateId: "pb-protocol",
        protocolMode: "GROUP",
        serviceRuleVersionId: rules[0].id,
        commonFields: {
          trainingSubject: "Согласованная программа ПБ",
          documentDate: "2026-10-01",
          protocolDate: "2026-09-30",
          hours: "40",
        },
      },
      {
        id: ptmEventId,
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        serviceRuleVersionId: rules[1].id,
        protocolMode: "GROUP",
        commonFields: {},
      },
    ],
    items: [
      first,
      second,
      {
        ...first,
        id: randomUUID(),
        fullNameRu: "Согласованный сотрудник другого работодателя",
        employerId: otherCustomer.id,
        workplaceRu: otherCustomer.nameRu,
        recipientId: undefined,
        assignments: [{ ...first.assignments[0], id: randomUUID() }],
      },
    ],
  });
  const request = await createRequest(admin, input);
  const firstSelection = [
    { rowId: first.id, assignmentId: first.assignments[0].id },
    {
      rowId: input.items[2].id,
      assignmentId: input.items[2].assignments[0].id,
    },
  ];
  await submitApproval(admin, request.id, {
    expectedRevision: request.revision,
    assignments: firstSelection,
  });
  await approvals.approve(request.id);
  const order = await createServiceOrder(admin, {
    title: "Публикуемый заказ",
    customerId: customer.id,
    employerId: customer.id,
    requestIds: [request.id],
  });
  const initialPortal = await employerPortal(members[0]);
  assert.equal(initialPortal.orders[0].requests[0].rows.length, 1);
  assert.ok(!JSON.stringify(initialPortal).includes("НЕПУБЛИКОВАТЬ"));
  const publishedEvidence = await portalEvidence(members[0], customer.id);
  assert.deepEqual(
    publishedEvidence.programs.map((program) => program.id),
    [rules[0].id],
  );
  assert.ok(!JSON.stringify(publishedEvidence).includes("НЕПУБЛИКОВАТЬ"));
  const approved = await requestDetail(admin, request.id);
  await assert.rejects(
    submitEmployerProposal(members[0], order.id, {
      requestId: request.id,
      requestRevision: approved.revision,
      kind: "UPDATE_LIST",
      changes: [
        {
          rowId: second.id,
          fullNameRu: "Недопустимая правка ожидающего участника",
        },
      ],
    }),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "ROW_DENIED",
  );
  const frozen = selectAssignmentScope(
    draftSchema.parse(approved.draft),
    firstSelection,
  );
  const profile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: who.tenantId },
    orderBy: { version: "desc" },
  });
  // Persisted synthetic issuance metadata tests publication/access boundaries;
  // actual DOCX/PDF bytes are verified by the independent renderer acceptance.
  const issuance = await db.issuance.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      sourceRevision: approved.revision,
      snapshot: json({ draft: frozen.draft }),
      inputHash: suffix,
      profileVersionId: profile.id,
      createdBy: admin.userId,
    },
  });
  await db.issuanceAssignment.createMany({
    data: frozen.assignments.map((identity) => ({
      ...identity,
      tenantId: who.tenantId,
      requestId: request.id,
      issuanceId: issuance.id,
    })),
  });
  const renderSnapshot = await db.renderInputSnapshot.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      revision: approved.revision,
      issuanceId: issuance.id,
      profileVersionId: profile.id,
      input: json({ syntheticMetadataOnly: true }),
      inputHash: suffix,
    },
  });
  const template = await db.templateVersion.findFirstOrThrow({
    where: { tenantId: who.tenantId, templateId: "pb-card", approved: true },
    orderBy: { version: "desc" },
  });
  const document = await db.issuedDocument.create({
    data: {
      tenantId: who.tenantId,
      issuanceId: issuance.id,
      requestId: request.id,
      rowId: first.id,
      assignmentId: first.assignments[0].id,
      templateVersionId: template.id,
      templateId: "pb-card",
      namespace: "PB:CARD",
      number: "SYNTHETIC-FIRST-CARD",
      documentDate: "2026-10-01",
    },
  });
  const job = await db.generationJob.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      issuanceId: issuance.id,
      documentId: document.id,
      snapshotId: renderSnapshot.id,
      status: "SUCCEEDED",
      kind: "PDF",
      logicalKey: randomUUID(),
    },
  });
  const artifact = await db.artifact.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      issuanceId: issuance.id,
      documentId: document.id,
      jobId: job.id,
      format: "PDF",
      storageKey: `fixture/published-scope/${suffix}`,
      sha256: "0".repeat(64),
      size: 0,
      mimeType: "application/pdf",
      fileName: "Synthetic-metadata-only.pdf",
      rendererVersion: "metadata-only",
      inputHash: suffix,
    },
  });
  const waitingEdit = draftSchema.parse(approved.draft);
  waitingEdit.title = "Частная рабочая подпись";
  waitingEdit.items[1].positionRu = "НЕПУБЛИКОВАТЬ_ПРАВКУ_ОЖИДАЮЩЕГО";
  const waitingChanged = await patchRequest(admin, request.id, {
    expectedRevision: approved.revision,
    draft: waitingEdit,
  });
  const repeatCommand = {
    requestId: request.id,
    requestRevision: initialPortal.orders[0].requests[0].revision,
    kind: "REPEAT_REQUEST",
    message: "Повторить только опубликованную историю своего работодателя",
  };
  const staleRepeat = await submitEmployerProposal(
    members[0],
    order.id,
    repeatCommand,
  );
  assert.equal(staleRepeat.requestRevision, waitingChanged.revision);
  const anotherWaitingEdit = draftSchema.parse(waitingChanged.draft);
  anotherWaitingEdit.items[1].positionRu = "НЕПУБЛИКОВАТЬ_ЕЩЁ_ОДНУ_ПРАВКУ";
  await patchRequest(admin, request.id, {
    expectedRevision: waitingChanged.revision,
    draft: anotherWaitingEdit,
  });
  await assert.rejects(
    resolveEmployerProposal(admin, order.id, staleRepeat.id, {
      status: "ACCEPTED",
      resolution: "Устаревшую рабочую редакцию принимать нельзя",
    }),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "REVISION_CONFLICT",
  );
  await resolveEmployerProposal(admin, order.id, staleRepeat.id, {
    status: "REJECTED",
    resolution: "Рабочая редакция изменилась после отправки",
  });
  // Synthetic legacy pending proposal: earlier submissions kept only their
  // working revision, with no frozen public payload in the audit metadata.
  const repeatMembership = await db.employerMembership.findFirstOrThrow({
    where: {
      tenantId: admin.tenantId,
      customerId: customer.id,
      userId: members[0].userId,
    },
  });
  const repeat = await db.portalProposal.create({
    data: {
      ...repeatCommand,
      requestRevision: (await workingRequest(admin, request.id)).revision,
      changes: [],
      tenantId: admin.tenantId,
      orderId: order.id,
      membershipId: repeatMembership.id,
    },
  });
  await db.auditEvent.create({
    data: {
      tenantId: admin.tenantId,
      actorId: members[0].userId,
      action: "EMPLOYER_PROPOSAL_SUBMITTED",
      entityId: order.id,
      correlationId: suffix,
      metadata: {
        proposalId: repeat.id,
        requestId: request.id,
        revision: repeat.requestRevision,
      },
    },
  });
  const resolvedRepeat = await resolveEmployerProposal(
    admin,
    order.id,
    repeat.id,
    {
      status: "ACCEPTED",
      resolution: "Проверена опубликованная история выбранного работодателя",
    },
  );
  assert.ok(resolvedRepeat.newRequestId);
  const recovered = await db.auditEvent.findFirstOrThrow({
    where: {
      tenantId: admin.tenantId,
      action: "EMPLOYER_PROPOSAL_SOURCE_RECOVERED",
      entityId: order.id,
      metadata: { path: ["proposalId"], equals: repeat.id },
    },
  });
  assert.deepEqual(
    (recovered.metadata as { issuanceIds: string[] }).issuanceIds,
    [issuance.id],
  );
  const repeated = draftSchema.parse(
    (await workingRequest(admin, resolvedRepeat.newRequestId!)).draft,
  );
  assert.deepEqual(
    repeated.items.map((row) => row.fullNameRu),
    [first.fullNameRu],
  );
  assert.ok(!JSON.stringify(repeated).includes("НЕПУБЛИКОВАТЬ"));
  assert.ok(!JSON.stringify(repeated).includes(input.items[2].fullNameRu));
  assert.deepEqual(
    repeated.items[0].assignments.map((entry) => entry.templateId),
    ["pb-card", "pb-protocol"],
  );
  assert.ok(
    repeated.items[0].assignments.every(
      (entry) => !entry.result && !entry.documentDate,
    ),
  );
  const beforePrivateEdit = await requestDetail(admin, request.id);
  const changedInput = draftSchema.parse(beforePrivateEdit.draft);
  changedInput.items[0].fullNameRu = "НЕПУБЛИКОВАТЬ_ПОЗДНЮЮ_ПРАВКУ";
  changedInput.items[0].positionRu = "НЕПУБЛИКОВАТЬ_ПОЗДНЮЮ_ДОЛЖНОСТЬ";
  changedInput.items[0].employerId = otherCustomer.id;
  const changed = await patchRequest(admin, request.id, {
    expectedRevision: beforePrivateEdit.revision,
    draft: changedInput,
  });
  let portal = await employerPortal(members[0]);
  assert.equal(
    portal.orders.find((entry) => entry.id === order.id)!.requests[0].rows[0]
      .fullNameRu,
    first.fullNameRu,
  );
  assert.ok(!JSON.stringify(portal).includes("НЕПУБЛИКОВАТЬ"));
  await assert.rejects(
    submitEmployerProposal(members[0], order.id, {
      requestId: request.id,
      requestRevision: portal.orders.find((entry) => entry.id === order.id)!
        .requests[0].revision,
      kind: "UPDATE_LIST",
      changes: [{ rowId: first.id, fullNameRu: "Не затирать частную правку" }],
    }),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "REVISION_CONFLICT",
  );
  assert.equal(
    (await employerArtifactAccess(members[0], artifact.id)).id,
    artifact.id,
  );
  await assert.rejects(
    employerArtifactAccess(members[1], artifact.id),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "FULL_ROSTER_DENIED",
  );
  const secondInput = draftSchema.parse(changed.draft);
  secondInput.items[1].fullNameRu = "Вторая согласованная партия";
  secondInput.items[1].positionRu = "Вторая согласованная должность";
  Object.assign(secondInput.items[1].assignments[0], {
    documentDate: "2026-10-01",
    protocolDate: "2026-09-30",
    validUntil: "2029-10-01",
    hours: "40",
    outcome: {
      status: "PASSED",
      source: "Синтетическая фактическая ведомость второй партии",
    },
  });
  secondInput.items.push({
    ...newRecipient(),
    employerId: customer.id,
    fullNameRu: "НЕПУБЛИКОВАТЬ_ТРЕТЬЕГО_ОЖИДАЮЩЕГО",
    assignments: [
      {
        ...newAssignment("pb-card"),
        eventId: pbEventId,
        protocolMode: "GROUP",
        outcome: { status: "UNKNOWN", source: "" },
      },
    ],
  });
  const saved = await patchRequest(admin, request.id, {
    expectedRevision: changed.revision,
    draft: secondInput,
  });
  await submitApproval(admin, request.id, {
    expectedRevision: saved.revision,
    assignments: [{ rowId: second.id, assignmentId: second.assignments[0].id }],
  });
  await approvals.approve(request.id);
  portal = await employerPortal(members[0]);
  const rows = portal.orders.find((entry) => entry.id === order.id)!.requests[0]
    .rows;
  assert.deepEqual(
    rows.map((row) => row.fullNameRu),
    [first.fullNameRu, "Вторая согласованная партия"],
  );
  assert.ok(!JSON.stringify(portal).includes("НЕПУБЛИКОВАТЬ"));
  assert.deepEqual(
    (await db.issuance.findUniqueOrThrow({ where: { id: issuance.id } }))
      .snapshot,
    issuance.snapshot,
  );
  assert.equal(
    (await employerArtifactAccess(members[0], artifact.id)).id,
    artifact.id,
  );
});
