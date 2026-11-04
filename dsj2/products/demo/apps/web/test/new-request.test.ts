import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema } from "@demo/contracts";
import {
  newRequestStorageKey,
  prepareNewRequest,
  restoreNewRequest,
} from "../lib/new-request";
import type { AppContext } from "../lib/types";

const context = {
  tenant: { id: "test-center", timezone: "Asia/Almaty", demoOnly: true },
  user: { id: "operator" },
} as AppContext;

test("pending creation preserves the exact payload and command key across reload", () => {
  const attempt = prepareNewRequest(context, "COMPANY");
  const restored = restoreNewRequest(JSON.stringify(attempt));
  assert.deepEqual(restored, attempt);
  const draft = draftSchema.parse(JSON.parse(restored!.body));
  assert.equal(draft.kind, "COMPANY");
  assert.equal(draft.items.length, 1);
  assert.deepEqual(draft.items[0].assignments, []);
  assert.equal(draft.demoMode, true);
  assert.notEqual(prepareNewRequest(context, "COMPANY").key, attempt.key);
});

test("pending creation is scoped to both tenant and operator", () => {
  const key = newRequestStorageKey(context);
  assert.notEqual(
    key,
    newRequestStorageKey({
      ...context,
      tenant: { ...context.tenant, id: "other" },
    }),
  );
  assert.notEqual(
    key,
    newRequestStorageKey({
      ...context,
      user: { ...context.user, id: "other" },
    }),
  );
});

test("invalid recovery data cannot be used as a creation attempt", () => {
  const attempt = prepareNewRequest(context, "PERSON");
  assert.equal(restoreNewRequest(null), null);
  assert.throws(() => restoreNewRequest("{"));
  assert.throws(() =>
    restoreNewRequest(JSON.stringify({ ...attempt, key: "short" })),
  );
  assert.throws(() =>
    restoreNewRequest(JSON.stringify({ ...attempt, kind: "COMPANY" })),
  );
  assert.throws(() =>
    restoreNewRequest(JSON.stringify({ ...attempt, body: "{}" })),
  );
});
