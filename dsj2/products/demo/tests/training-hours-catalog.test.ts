import assert from "node:assert/strict";
import test from "node:test";
import {
  commonFieldsSchema,
  isPreviousBiotHoursProgram,
  trainingHoursPrograms,
  trainingHoursRule,
} from "../packages/contracts/src";

test("previous occupational safety programs use an explicit employer size and competency track", () => {
  const itr = trainingHoursPrograms("biot-itr-certificate");
  assert.equal(itr.length, 6);
  assert.ok(itr.every((entry) => isPreviousBiotHoursProgram(entry.id)));
  assert.ok(!isPreviousBiotHoursProgram("PTM_DIRECTOR"));
  const common = { hoursProgram: "BIOT_PREVIOUS_SPECIAL_SMALL" } as const;
  assert.equal(
    trainingHoursRule("biot-itr-protocol", "ITR", common).minimumHours,
    16,
  );
  assert.equal(
    trainingHoursRule("biot-itr-protocol", "ITR", {
      hoursProgram: "BIOT_PREVIOUS_GENERAL_LARGE",
    }).hours,
    "72",
  );
  const worker = trainingHoursRule("biot-worker-card", "WORKER", {
    hoursProgram: "BIOT_PREVIOUS_WORKER",
  });
  assert.equal(worker.hours, undefined);
  assert.equal(worker.productionHours, undefined);
  assert.equal(worker.minimumHours, undefined);
  assert.ok(
    trainingHoursPrograms("biot-protocol").every(
      (option) => option.id === "BIOT_PREVIOUS_WORKER",
    ),
  );
});

test("ordinary industrial safety training and statutory retraining use different rules for engineers", () => {
  const regular = trainingHoursRule("pb-card", "ITR", {});
  assert.equal(regular.hours, "40");
  assert.equal(regular.minimumHours, 40);
  assert.equal(trainingHoursRule("pb-protocol", "WORKER", {}).minimumHours, 10);
  assert.equal(trainingHoursRule("pb-card", undefined, {}).hours, undefined);
  for (const category of ["WORKER", "ITR"] as const) {
    const retraining = trainingHoursRule("pb-protocol", category, {
      hoursProgram: "PB_RETRAINING",
    });
    assert.equal(retraining.hours, "10");
    assert.equal(retraining.productionHours, undefined);
  }
});

test("a fire-training credential requires an identified training-centre program to supply hours", () => {
  const options = trainingHoursPrograms("ptm-card");
  assert.equal(options.length, 6);
  assert.deepEqual(options, trainingHoursPrograms("ptm-protocol"));
  assert.equal(trainingHoursRule("ptm-card", "ITR", {}).hours, undefined);
  assert.equal(
    trainingHoursRule("ptm-card", "ITR", { hoursProgram: "PB_RETRAINING" })
      .hours,
    undefined,
  );
  for (const { id } of options) {
    const rule = trainingHoursRule("ptm-card", "WORKER", { hoursProgram: id });
    assert.equal(rule.hours, id === "PTM_DIRECTOR" ? "8" : "12");
    assert.equal(rule.productionHours, undefined);
    assert.equal(rule.minimumHours, undefined);
    assert.ok(commonFieldsSchema.safeParse({ hoursProgram: id }).success);
  }
  assert.ok(
    !commonFieldsSchema.safeParse({ hoursProgram: "PTM_ELECTRICIAN" }).success,
  );
});

test("a profession's duration comes from its own curriculum and safety presets do not leak into other courses", () => {
  const ps = trainingHoursRule("ps-witness", "WORKER", {
    hoursProgram: "PTM_DIRECTOR",
    biotCategory: "WORKER",
  });
  assert.equal(ps.hours, undefined);
  assert.equal(ps.productionHours, undefined);
  assert.equal(ps.minimumHours, undefined);
  assert.deepEqual(trainingHoursPrograms("ps-card"), []);
  assert.equal(
    trainingHoursRule("lms-certificate", "ITR", {}).hours,
    undefined,
  );
  assert.equal(
    trainingHoursRule("biot-worker-card", "WORKER", {}).productionHours,
    "16",
  );
  assert.equal(
    trainingHoursRule("biot-itr-certificate", "ITR", {}).minimumHours,
    undefined,
  );
});
