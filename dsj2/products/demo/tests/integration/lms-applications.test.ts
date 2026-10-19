import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type DemoRequest, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  actOnApplication,
  coursePublicity,
  listApplications,
  publicCatalogue,
  submitApplication,
} from "../../apps/api/src/lms/applications";
import {
  applicationOrderSummary,
  closeApplicationOrder,
  recordApplicationStage,
} from "../../apps/api/src/lms/application-workflow";
import { lmsCourse, lmsLearner, lmsTenant } from "./lms-fixture";
import {
  recordFinancialDocument,
  recordPayment,
  saveCommercial,
} from "../../apps/api/src/operator-value";

const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { getStatus(): number }).getStatus(), expected);
  return true;
};
const req = () =>
  ({
    ip: `127.0.0.${Math.floor(Math.random() * 200) + 20}`,
    correlationId: randomUUID(),
  }) as DemoRequest;
test("N01/N02 PostgreSQL: public projection, scoped applications, atomic acceptance and evidence stages", async (t) => {
  const first = await lmsTenant("pass02 applications"),
    foreign = await lmsTenant("pass02 foreign");
  const learner = await lmsLearner(first.tenant.id, "application"),
    other = await lmsLearner(first.tenant.id, "other");
  const course = await createCourse(first.context, lmsCourse());
  const priorTenant = process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
  process.env.DEMO_LMS_REGISTRATION_TENANT_ID = first.tenant.id;
  try {
    await t.test(
      "publication is not public consent; private projection is absent",
      async () => {
        await publishVersion(first.context, course.version.id, { revision: 0 });
        assert.equal((await publicCatalogue({})).total, 0);
        await coursePublicity(first.context, course.course.id, {
          enabled: true,
          summaryRu: "Проверенная программа",
          summaryKz: "Тексерілген бағдарлама",
        });
        const view = await publicCatalogue({});
        assert.equal(view.total, 1);
        assert.equal(view.items[0].courseVersionId, course.version.id);
        assert.equal(
          (
            await publicCatalogue(
              { versionId: course.version.id },
              first.context,
            )
          ).items[0].courseVersionId,
          course.version.id,
        );
        await assert.rejects(
          publicCatalogue({ versionId: course.version.id }, foreign.context),
          status(409),
        );
        assert.equal(JSON.stringify(view).includes("correctOptionIds"), false);
        assert.equal(JSON.stringify(view).includes("modules"), false);
        assert.equal(
          JSON.stringify(view).includes("regulatoryProfileVersionId"),
          false,
        );
      },
    );
    let applicationId = "";
    await t.test(
      "known B2C profile, idempotent replay, conflict and own-only history",
      async () => {
        const input = {
          kind: "B2C",
          courseVersionId: course.version.id,
          idempotencyKey: randomUUID(),
        };
        const requests = await Promise.all([
          submitApplication(req(), input, learner.context),
          submitApplication(req(), input, learner.context),
        ]);
        assert.equal(requests[0].id, requests[1].id);
        applicationId = requests[0].id;
        await assert.rejects(
          submitApplication(
            req(),
            { ...input, comment: "different" },
            learner.context,
          ),
          status(409),
        );
        const own = await listApplications(learner.context, {});
        assert.equal(own.total, 1);
        assert.equal(
          own.items[0].contact &&
            (own.items[0].contact as { email: string }).email,
          learner.user.email,
        );
        assert.equal((await listApplications(other.context, {})).total, 0);
        assert.equal((await listApplications(foreign.context, {})).total, 0);
        await assert.rejects(
          actOnApplication(other.context, applicationId, {
            action: "CANCEL",
            revision: 0,
          }),
          status(404),
        );
        await assert.rejects(
          actOnApplication(learner.context, applicationId, {
            action: "ACCEPT",
            revision: 0,
          }),
          status(403),
        );
      },
    );
    await t.test(
      "return/reason/resubmit and parallel acceptance create one order and enrollment",
      async () => {
        await assert.rejects(
          actOnApplication(first.context, applicationId, {
            action: "RETURN",
            revision: 0,
          }),
          status(400),
        );
        await actOnApplication(first.context, applicationId, {
          action: "RETURN",
          revision: 0,
          reason: "Уточните срок",
        });
        await assert.rejects(
          actOnApplication(learner.context, applicationId, {
            action: "RESUBMIT",
            revision: 0,
            comment: "Октябрь",
          }),
          status(409),
        );
        await actOnApplication(learner.context, applicationId, {
          action: "RESUBMIT",
          revision: 1,
          comment: "Октябрь",
        });
        const accepted = await Promise.all([
          actOnApplication(first.context, applicationId, {
            action: "ACCEPT",
            revision: 2,
          }),
          actOnApplication(first.context, applicationId, {
            action: "ACCEPT",
            revision: 2,
          }),
        ]);
        assert.equal(accepted[0].orderId, accepted[1].orderId);
        assert.equal(accepted[0].enrollmentId, accepted[1].enrollmentId);
        assert.equal(
          await db.serviceOrder.count({ where: { tenantId: first.tenant.id } }),
          1,
        );
        assert.equal(
          await db.enrollment.count({
            where: {
              tenantId: first.tenant.id,
              recipientId: learner.recipient.id,
            },
          }),
          1,
        );
        const enrollment = await db.enrollment.findUniqueOrThrow({
          where: { id: accepted[0].enrollmentId! },
        });
        assert.equal(enrollment.sourceOrderId, accepted[0].orderId);
        assert.equal(enrollment.learnerUserId, learner.user.id);
        assert.equal(enrollment.sourceRequestId, null);
        const messages = await db.lmsNotificationEvent.findMany({
          where: { enrollmentId: enrollment.id, userId: learner.user.id },
        });
        assert.equal(messages.length, 1);
        assert.equal(messages[0].kind, "ENROLLED");
        assert.equal(messages[0].deliveryKey, `ASSIGNMENT:${enrollment.id}`);
        await assert.rejects(
          actOnApplication(learner.context, applicationId, {
            action: "CANCEL",
            revision: 3,
          }),
          status(409),
        );
      },
    );
    await t.test(
      "order facts: unknown payment does not issue; evidenced stages are versioned",
      async () => {
        const before = await applicationOrderSummary(
          first.context,
          applicationId,
        );
        assert.equal(before.payment?.state, "UNKNOWN");
        assert.equal(before.documentsReady, 0);
        assert.equal(before.assigned, 1);
        assert.equal(
          before.stages?.every((s) => s.record === null),
          true,
        );
        await assert.rejects(
          recordApplicationStage(first.context, applicationId, {
            stage: "OFFER",
            status: "DONE",
            revision: 0,
          }),
          status(400),
        );
        await recordApplicationStage(first.context, applicationId, {
          stage: "CONTACT",
          status: "DONE",
          revision: 0,
          evidence: "Synthetic local phone note",
          occurredAt: new Date().toISOString(),
        });
        await assert.rejects(
          recordApplicationStage(first.context, applicationId, {
            stage: "OFFER",
            status: "WAIVED",
            revision: 0,
            reason: "Not applicable",
          }),
          status(409),
        );
        await recordApplicationStage(first.context, applicationId, {
          stage: "OFFER",
          status: "WAIVED",
          revision: 1,
          reason: "Synthetic local noncommercial enrollment",
        });
        await assert.rejects(
          recordApplicationStage(first.context, applicationId, {
            stage: "CONTRACT",
            status: "DONE",
            revision: 2,
            evidence: "not a contract",
            occurredAt: new Date().toISOString(),
          }),
          status(400),
        );
        await assert.rejects(
          recordApplicationStage(first.context, applicationId, {
            stage: "SETTLEMENT",
            status: "DONE",
            revision: 2,
            evidence: "paid",
            occurredAt: new Date().toISOString(),
          }),
          status(400),
        );
        await assert.rejects(
          closeApplicationOrder(first.context, applicationId, {
            revision: 2,
            reason: "not completed",
          }),
          status(409),
        );
        await assert.rejects(
          applicationOrderSummary(foreign.context, applicationId),
          status(404),
        );
        await assert.rejects(
          recordApplicationStage(learner.context, applicationId, {
            stage: "CONTACT",
            status: "WAIVED",
            revision: 2,
            reason: "no",
          }),
          status(403),
        );
        await saveCommercial(first.context, before.order!.id, {
          expectedRevision: 2,
          taxBasis: "Synthetic local fixture only",
          taxRateBasisPoints: 0,
          lines: [
            {
              label: "Synthetic training fact",
              unit: "PERSON_SERVICE",
              quantity: 1,
              unitPriceMinor: "1000",
            },
          ],
        });
        const document = await recordFinancialDocument(
          first.context,
          before.order!.id,
          {
            type: "CONTRACT",
            number: `SYNTHETIC-${randomUUID()}`,
            documentDate: "2026-10-17",
            source:
              "Synthetic existing document reference; no external signing",
          },
        );
        await recordApplicationStage(first.context, applicationId, {
          stage: "CONTRACT",
          status: "DONE",
          revision: 3,
          evidence: "Synthetic manually confirmed local reference",
          occurredAt: new Date().toISOString(),
          financialDocumentId: document.id,
        });
        assert.equal(
          (
            await applicationOrderSummary(first.context, applicationId)
          ).stages?.find((stage) => stage.stage === "CONTRACT")?.record?.status,
          "DONE",
        );
        await recordPayment(first.context, before.order!.id, {
          amountMinor: "400",
          occurredOn: "2026-10-17",
          source: "Synthetic local payment fact; no transaction",
        });
        assert.equal(
          (await applicationOrderSummary(first.context, applicationId)).payment
            ?.state,
          "PARTIAL",
        );
        await recordPayment(first.context, before.order!.id, {
          amountMinor: "600",
          occurredOn: "2026-10-17",
          source: "Synthetic local payment fact; no transaction",
        });
        assert.equal(
          (await applicationOrderSummary(first.context, applicationId)).payment
            ?.state,
          "PAID",
        );
        await recordPayment(first.context, before.order!.id, {
          amountMinor: "-100",
          occurredOn: "2026-10-17",
          source: "Synthetic local refund fact; no transaction",
        });
        assert.equal(
          (await applicationOrderSummary(first.context, applicationId)).payment
            ?.state,
          "PARTIAL",
        );
        await assert.rejects(
          closeApplicationOrder(first.context, applicationId, {
            revision: 4,
            reason: "Not learned or issued",
          }),
          status(409),
        );
      },
    );
    await t.test(
      "anonymous B2B receipt, explicit organization verification, no auto-membership",
      async () => {
        const input = {
          kind: "B2B",
          courseVersionId: course.version.id,
          idempotencyKey: randomUUID(),
          organization: "Синтетическая организация",
          bin: "000000000001",
          contactName: "Синтетический контакт",
          phone: "+70000000000",
          email: "synthetic@example.test",
          position: "",
          quantity: 3,
          comment: "Synthetic local request",
        };
        await assert.rejects(
          submitApplication(req(), { ...input, tenantId: foreign.tenant.id }),
          status(400),
        );
        const receipt = await submitApplication(req(), input);
        assert.deepEqual(Object.keys(receipt).sort(), [
          "centerName",
          "id",
          "saved",
          "state",
        ]);
        assert.equal((await submitApplication(req(), input)).id, receipt.id);
        await assert.rejects(
          actOnApplication(first.context, receipt.id, {
            action: "ACCEPT",
            revision: 0,
          }),
          status(400),
        );
        await actOnApplication(first.context, receipt.id, {
          action: "ACCEPT",
          revision: 0,
          createOrganization: true,
        });
        const stored = await db.lmsApplication.findUniqueOrThrow({
          where: { id: receipt.id },
        });
        assert.ok(stored.customerId);
        assert.ok(stored.orderId);
        assert.equal(stored.actorId, null);
        assert.equal(
          await db.employerMembership.count({
            where: {
              tenantId: first.tenant.id,
              customerId: stored.customerId!,
            },
          }),
          0,
        );
        assert.equal(
          (await applicationOrderSummary(first.context, receipt.id)).expected,
          3,
        );
      },
    );
    await t.test(
      "review: two distinct B2C applications serialize one acceptance; learner sees no finance DTO",
      async () => {
        const drafts = await Promise.all(
          [1, 2].map(() =>
            submitApplication(
              req(),
              {
                kind: "B2C",
                courseVersionId: course.version.id,
                idempotencyKey: randomUUID(),
              },
              other.context,
            ),
          ),
        );
        const decisions = await Promise.allSettled(
          drafts.map((row) =>
            actOnApplication(first.context, row.id, {
              action: "ACCEPT",
              revision: 0,
            }),
          ),
        );
        assert.equal(
          decisions.filter((row) => row.status === "fulfilled").length,
          1,
        );
        assert.equal(
          decisions.filter((row) => row.status === "rejected").length,
          1,
        );
        const accepted = drafts.find(
          (_, index) => decisions[index].status === "fulfilled",
        )!;
        const view = await applicationOrderSummary(other.context, accepted.id);
        assert.equal(view.assigned, 1);
        assert.equal(view.payment, undefined);
        assert.deepEqual(view.financialDocuments, []);
        assert.deepEqual(view.stages, []);
      },
    );
    await t.test(
      "review: unlinked B2B history does not grant organization or finance access; search preserves membership scope",
      async () => {
        const user = await db.user.create({
          data: {
            tenantId: first.tenant.id,
            displayName: "Synthetic applicant",
            email: `${randomUUID()}@example.test`,
            role: "EMPLOYER",
            passwordHash: "unused",
          },
        });
        const context: Context = {
          ...first.context,
          userId: user.id,
          role: "EMPLOYER",
        };
        const input = {
          kind: "B2B",
          courseVersionId: course.version.id,
          idempotencyKey: randomUUID(),
          organization: "Synthetic isolated applicant",
          bin: "000000000001",
          contactName: "ignored",
          email: "ignored@example.test",
          phone: "+70000000002",
          quantity: 1,
        };
        const draft = await submitApplication(req(), input, context);
        assert.equal(
          (await listApplications(context, { search: "Synthetic isolated" }))
            .total,
          1,
        );
        assert.equal(
          (
            await listApplications(context, {
              search: "Синтетическая организация",
            })
          ).total,
          0,
        );
        await assert.rejects(
          actOnApplication(first.context, draft.id, {
            action: "ACCEPT",
            revision: 0,
            createOrganization: true,
          }),
          status(409),
        );
        const organization = await db.customerOrganization.findFirstOrThrow({
          where: { tenantId: first.tenant.id, bin: input.bin },
        });
        await actOnApplication(first.context, draft.id, {
          action: "ACCEPT",
          revision: 0,
          customerId: organization.id,
        });
        assert.equal(
          (await listApplications(context, { search: "Synthetic isolated" }))
            .total,
          0,
          "accept does not silently add organization membership",
        );
        const member = await db.employerMembership.create({
          data: {
            tenantId: first.tenant.id,
            userId: user.id,
            customerId: organization.id,
            permissions: ["READ"],
            createdBy: first.user.id,
          },
        });
        await db.customerOrganization.update({
          where: { id: organization.id },
          data: { bin: "" },
        });
        const known = await submitApplication(
          req(),
          {
            ...input,
            idempotencyKey: randomUUID(),
            customerId: organization.id,
            organization: "do not replace known organization",
            bin: "",
          },
          context,
        );
        const knownRow = await db.lmsApplication.findUniqueOrThrow({
          where: { id: known.id },
        });
        assert.equal(knownRow.customerId, organization.id);
        assert.equal((knownRow.contact as { bin: string }).bin, "");
        assert.equal(
          (knownRow.contact as { organization: string }).organization,
          organization.nameRu,
        );
        assert.equal(
          (await applicationOrderSummary(context, draft.id)).financialDocuments
            ?.length,
          0,
        );
        await db.employerMembership.update({
          where: { id: member.id },
          data: { active: false },
        });
        await assert.rejects(
          applicationOrderSummary(context, draft.id),
          status(404),
        );
        const personalBusiness = await submitApplication(
          req(),
          { ...input, idempotencyKey: randomUUID(), bin: "000000000002" },
          learner.context,
        );
        assert.ok(
          (await listApplications(learner.context, {})).items.some(
            (row) => row.id === personalBusiness.id,
          ),
        );
        await actOnApplication(first.context, personalBusiness.id, {
          action: "ACCEPT",
          revision: 0,
          createOrganization: true,
        });
        assert.deepEqual(
          await applicationOrderSummary(learner.context, personalBusiness.id),
          { order: null },
        );
      },
    );
    await t.test(
      "completion fact does not require rewritten status and never implies document readiness",
      async () => {
        const accepted = await db.lmsApplication.findUniqueOrThrow({
          where: { id: applicationId },
        });
        const enrollment = await db.enrollment.findUniqueOrThrow({
          where: { id: accepted.enrollmentId! },
        });
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "ACTIVE", completedAt: new Date() },
        });
        const summary = await applicationOrderSummary(
          first.context,
          applicationId,
        );
        assert.equal(summary.completed, 1);
        assert.equal(summary.documentsReady, 0);
        await assert.rejects(
          closeApplicationOrder(first.context, applicationId, {
            revision: summary.order!.revision,
            reason: "Synthetic completed learning without issued documents",
          }),
          status(409),
        );
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "CANCELLED" },
        });
        assert.equal(
          (await applicationOrderSummary(first.context, applicationId))
            .completed,
          0,
        );
        await db.enrollment.update({
          where: { id: enrollment.id },
          data: {
            status: enrollment.status,
            completedAt: enrollment.completedAt,
          },
        });
      },
    );
    await t.test(
      "availability rechecked and unprocessed cancellation stays private",
      async () => {
        await db.course.update({
          where: { id: course.course.id },
          data: { assignmentPaused: true },
        });
        assert.equal((await publicCatalogue({})).total, 0);
        await assert.rejects(
          submitApplication(
            req(),
            {
              kind: "B2C",
              courseVersionId: course.version.id,
              idempotencyKey: randomUUID(),
            },
            other.context,
          ),
          status(409),
        );
        await db.course.update({
          where: { id: course.course.id },
          data: { assignmentPaused: false },
        });
        const value = await submitApplication(
          req(),
          {
            kind: "B2C",
            courseVersionId: course.version.id,
            idempotencyKey: randomUUID(),
          },
          other.context,
        );
        await actOnApplication(other.context, value.id, {
          action: "CANCEL",
          revision: 0,
        });
        assert.equal(
          (await listApplications(other.context, {})).items[0].state,
          "CANCELLED",
        );
      },
    );
  } finally {
    process.env.DEMO_LMS_REGISTRATION_TENANT_ID = priorTenant;
    await db.$disconnect();
  }
});
