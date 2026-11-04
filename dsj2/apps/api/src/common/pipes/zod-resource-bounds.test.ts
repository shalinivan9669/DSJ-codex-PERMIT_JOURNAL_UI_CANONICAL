import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { z } from "zod";
import {
  createCorrespondenceSchema,
  createExamSchema,
  examQuestionInputSchema,
  generateBiotCardBatchSchema,
} from "@dsj/types";

test("bounded arrays reject oversized invalid input before parsing elements", async () => {
  let parsed = 0;
  const value = z.preprocess((input) => {
    parsed += 1;
    return input;
  }, z.string());
  const schema = z.array(value).max(100, "limit");
  const oversized = Array(100_000).fill(0);

  for (const result of [schema.safeParse(oversized), await schema.safeParseAsync(oversized)]) {
    assert.equal(result.success, false);
    if (result.success) continue;
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
    assert.equal(result.error.issues[0].message, "limit");
  }
  assert.equal(parsed, 0);
  assert.deepEqual(schema.parse(["valid"]), ["valid"]);
  assert.equal(parsed, 1);
});

test("exact array and bounded set checks stop oversized inputs but retain short-array errors", () => {
  let parsed = 0;
  const value = z.preprocess((input) => {
    parsed += 1;
    return input;
  }, z.string());
  const exact = z.array(value).length(2).safeParse([0, 1, 2]);
  const oversizedSet = z.set(value).max(1).safeParse(new Set([0, 1]));
  assert.equal(exact.success, false);
  assert.equal(oversizedSet.success, false);
  if (!exact.success) assert.deepEqual(exact.error.issues.map((issue) => issue.code), ["too_big"]);
  if (!oversizedSet.success) assert.deepEqual(oversizedSet.error.issues.map((issue) => issue.code), ["too_big"]);
  assert.equal(parsed, 0);

  const short = z.array(z.string()).length(2).safeParse([0]);
  assert.equal(short.success, false);
  if (!short.success) assert.deepEqual(short.error.issues.map((issue) => issue.code).sort(), ["invalid_type", "too_small"]);
});

test("project bounded input schemas reject oversized invalid collections with one issue", () => {
  for (const schema of [
    createExamSchema.shape.questions,
    examQuestionInputSchema.shape.options,
    generateBiotCardBatchSchema.shape.items,
    createCorrespondenceSchema.shape.recipients,
  ]) {
    const result = schema.safeParse(Array(1_000).fill(null));
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues.map((issue) => issue.code), ["too_big"]);
  }
});

test("the ESM entry point uses the same early bounds checks", () => {
  const script = `
    import { z } from "zod";
    let parsed = 0;
    const item = z.preprocess((x) => { parsed++; return x; }, z.string());
    const schema = z.array(item).max(1);
    for (const result of [schema.safeParse([0, 1]), await schema.safeParseAsync([0, 1])]) {
      if (result.success || result.error.issues.length !== 1 || result.error.issues[0].code !== "too_big") process.exit(1);
    }
    if (parsed !== 0) process.exit(1);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
