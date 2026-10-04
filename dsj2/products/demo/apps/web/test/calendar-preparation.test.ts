import test from "node:test";
import assert from "node:assert/strict";
import { trainingDateRuleSchema } from "@demo/contracts";
import {
  calendarCandidate,
  calendarCandidateErrors,
  calendarCandidateRule,
  validCalendarCandidate,
} from "../lib/calendar-preparation";
import {
  parsePreparation,
  preparationKey,
  writePreparation,
  type PreparationIdentity,
} from "../lib/preparation-storage";
test("calendar candidates keep intermediate empty/zero/25/text and errors identify the actual numeric cause", () => {
  for (const hoursPerDay of ["", "0", "25", "8 ч", "1."]) {
    const candidate = { ...calendarCandidate(), hoursPerDay };
    assert.equal(candidate.hoursPerDay, hoursPerDay);
    assert.equal(validCalendarCandidate(candidate), true);
    assert.match(
      calendarCandidateErrors(candidate).hoursPerDay!,
      /больше 0.*24/,
    );
    assert.equal(
      trainingDateRuleSchema.safeParse(calendarCandidateRule(candidate))
        .success,
      false,
    );
  }
  for (const hoursPerDay of ["8", "24", "0.01", "7,5", "7.5"]) {
    const candidate = { ...calendarCandidate(), hoursPerDay };
    assert.deepEqual(calendarCandidateErrors(candidate), {});
    assert.equal(
      trainingDateRuleSchema.safeParse(calendarCandidateRule(candidate))
        .success,
      true,
    );
  }
  const separate = {
    ...calendarCandidate(),
    hoursPerDay: "8",
    hoursSource: "SEPARATE_BLOCKS" as const,
    productionHoursPerDay: "25",
  };
  assert.match(calendarCandidateErrors(separate).productionHoursPerDay!, /24/);
  assert.equal(
    calendarCandidateErrors({
      ...calendarCandidate(),
      hoursPerDay: "8",
      source: "  ",
    }).source?.includes("3 до 500"),
    true,
  );
});
test("equal applied rules have separate durable candidates and cancel does not remove the applied rule", () => {
  const applied = trainingDateRuleSchema.parse(
    calendarCandidateRule({ ...calendarCandidate(), hoursPerDay: "4" }),
  );
  const original = structuredClone(applied);
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const base: PreparationIdentity = {
    tenantId: "tenant",
    userId: "operator",
    requestId: "request",
    targetId: "biot",
    kind: "calendar",
  };
  const other = { ...base, targetId: "ptm" };
  const saved = writePreparation(
    storage,
    preparationKey(base),
    {
      version: 1,
      identity: base,
      title: "БиОТ",
      requestRevision: 1,
      context: "ctx",
      savedAt: "now",
      value: {
        ...calendarCandidate(applied),
        hoursPerDay: "8",
        source: "БиОТ schedule",
      },
    },
    null,
  );
  writePreparation(
    storage,
    preparationKey(other),
    {
      version: 1,
      identity: other,
      title: "ПТМ",
      requestRevision: 1,
      context: "ctx",
      savedAt: "now",
      value: {
        ...calendarCandidate(applied),
        hoursPerDay: "6",
        source: "ПТМ schedule",
      },
    },
    null,
  );
  assert.equal(
    parsePreparation(
      storage.getItem(preparationKey(base)),
      base,
      validCalendarCandidate,
    )?.value.hoursPerDay,
    "8",
  );
  assert.equal(
    parsePreparation(
      storage.getItem(preparationKey(other)),
      other,
      validCalendarCandidate,
    )?.value.hoursPerDay,
    "6",
  );
  writePreparation(storage, preparationKey(base), null, saved);
  assert.deepEqual(applied, original);
  assert.equal(
    parsePreparation(
      storage.getItem(preparationKey(other)),
      other,
      validCalendarCandidate,
    )?.value.hoursPerDay,
    "6",
  );
});
