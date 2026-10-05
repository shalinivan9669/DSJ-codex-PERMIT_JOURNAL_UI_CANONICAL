import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  resolveDraft,
  positiveAssignmentDefaults,
} from "@demo/contracts";
import { approvalReviewSummary } from "../lib/approval-review";
import { trainingDisplayTitle } from "../lib/training-display";

test("director display translates accumulated generated BIOT titles without changing saved or custom names", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    events: [
      {
        id: "legacy-course",
        title: "BIOT — Рабочие — ИТР",
        protocolTemplateId: "biot-itr-protocol",
        commonFields: {},
      },
    ],
    items: [
      {
        id: "person",
        assignments: [
          {
            id: "certificate",
            templateId: "biot-itr-certificate",
            eventId: "legacy-course",
          },
        ],
      },
    ],
  });
  const before = JSON.stringify(draft);
  const summary = approvalReviewSummary({ draft, provenance: {}, issues: [] });
  assert.equal(
    trainingDisplayTitle(summary.courses[0].title),
    "БиОТ — Рабочие — ИТР",
  );
  assert.equal(JSON.stringify(draft), before);
  for (const suffix of ["", " — Рабочие", " — ИТР", " — ИТР — Рабочие — ИТР"])
    assert.equal(trainingDisplayTitle("BIOT" + suffix), "БиОТ" + suffix);
  for (const title of [
    "BIOT — Авторская программа",
    "BIOT — Рабочие — подрядчик",
    "Курс BIOT — ИТР",
    "БиОТ — ИТР",
    "Проверка — Рабочие — ИТР",
  ])
    assert.equal(trainingDisplayTitle(title), title);
});

test("common manually entered hours and one shared employer are not personal exceptions", () => {
  const submitted = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: [
      {
        id: "course",
        title: "PTM",
        protocolTemplateId: "ptm-protocol",
        commonFields: { hours: "16", fieldOrigins: { hours: "MANUAL" } },
      },
    ],
    items: ["first", "second"].map((id) => ({
      id,
      fullNameRu: "Синтетический " + id,
      employerId: "shared-employer",
      assignments: [
        {
          id: "card",
          eventId: "course",
          templateId: "ptm-card",
          ...positiveAssignmentDefaults("ptm-card"),
        },
      ],
    })),
  });
  const review = resolveDraft(submitted);
  assert.equal(review.draft.items[0].assignments[0].hours, "16");
  assert.equal(approvalReviewSummary(review, submitted).exceptions, 0);
  submitted.items[1].assignments[0].hours = "";
  submitted.items[1].assignments[0].fieldOrigins!.hours = "CLEARED";
  assert.equal(
    approvalReviewSummary(resolveDraft(submitted), submitted).exceptions,
    1,
  );
  delete submitted.items[1].assignments[0].fieldOrigins!.hours;
  submitted.items[1].assignments[0].fieldOrigins!.validUntil = "MANUAL";
  assert.equal(
    approvalReviewSummary(resolveDraft(submitted), submitted).exceptions,
    1,
  );
});

test("director summary uses inherited effective dates, one training for related forms and explicit source", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: {
      documentDate: "2026-10-04",
      protocolDate: "2026-10-04",
      trainingStart: "2026-10-01",
      trainingEnd: "2026-10-03",
    },
    items: [
      {
        id: "person",
        fullNameRu: "Синтетический Участник",
        assignments: ["ptm-card", "ptm-protocol"].map((templateId) => ({
          id: templateId,
          templateId,
          result: "Сдал",
          outcome: {
            status: "PASSED",
            source: "Стандартное положительное значение",
          },
        })),
      },
    ],
  });
  const review = resolveDraft(draft);
  const summary = approvalReviewSummary(review);
  assert.equal(summary.people, 1);
  assert.equal(summary.courses.length, 1);
  assert.deepEqual([...summary.courses[0].documentDates], ["2026-10-04"]);
  assert.deepEqual([...summary.courses[0].protocolDates], ["2026-10-04"]);
  assert.ok(summary.courses[0].sources.has("Общие данные заявки"));
  assert.ok(
    summary.courses[0].sources.has("Стандартное положительное значение"),
  );
  assert.equal(draft.items[0].assignments[0].documentDate, "");
});

test("director summary preserves repeat course events and counts distinct people with explicit exceptions", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: ["first", "repeat"].map((id) => ({
      id,
      title: id,
      protocolTemplateId: "pb-protocol",
      commonFields: {},
    })),
    items: [
      {
        id: "person",
        fullNameRu: "Синтетический Участник",
        assignments: ["first", "repeat"].map((eventId) => ({
          id: eventId,
          eventId,
          templateId: "pb-card",
          outcome: {
            status: eventId === "first" ? "PASSED" : "FAILED",
            source: "Фактический результат",
          },
          fieldOrigins: { result: "MANUAL" },
        })),
      },
    ],
  });
  const summary = approvalReviewSummary({ draft, provenance: {}, issues: [] });
  assert.equal(summary.courses.length, 2);
  assert.equal(summary.exceptions, 1);
  assert.deepEqual([...summary.courses[1].results], ["Не сдал"]);
});
