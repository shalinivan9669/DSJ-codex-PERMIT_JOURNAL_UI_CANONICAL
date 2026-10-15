import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../lib/api";
import { lmsError } from "../components/lms/common";

test("F3 known access, row, material and document errors localize from code and unknown errors hide technical/server text", () => {
  const ru = (a: string, _b: string) => a;
  const kz = (_a: string, b: string) => b;
  for (const code of [
    "ACCESS_EXPIRED",
    "COURSE_ASSIGNMENT_PAUSED",
    "ORIGIN_RECIPIENT_MISMATCH",
    "INVITE_INVALID",
    "RECOVERY_INVALID",
    "MATERIAL_SIGNATURE",
    "UPLOAD_BUSY",
    "DOCUMENT_NOT_READY",
    "TEMPLATE_NOT_APPROVED",
  ]) {
    const row = {
      code,
      params: {},
      message: "Серверный русский текст",
      correlationId: "synthetic-correlation",
    };
    assert.notEqual(lmsError(row, ru), lmsError(row, kz), code);
    assert.ok(!lmsError(row, kz).includes(row.message));
    assert.ok(
      !lmsError(
        new ApiError(409, row.message, row, row.correlationId),
        kz,
      ).includes(row.correlationId),
    );
  }
  const unknown = new ApiError(
    500,
    "PRIVATE_DATABASE_DIAGNOSTIC",
    { code: "UNKNOWN_TECHNICAL_CODE" },
    "synthetic-correlation",
  );
  assert.match(lmsError(unknown, kz), /әрекет|Әрекет/);
  assert.ok(!lmsError(unknown, kz).includes("PRIVATE_DATABASE"));
  assert.ok(!lmsError(unknown, kz).includes("synthetic-correlation"));
});
