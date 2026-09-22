import test from "node:test";
import assert from "node:assert/strict";
import { AutosaveLane } from "../lib/autosave";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("typing during save is serialized; flush includes last characters and newest revision", async () => {
  const first = deferred<{ revision: number }>();
  const second = deferred<{ revision: number }>();
  const calls: { value: { ru: string; kz: string }; revision: number }[] = [];
  const lane = new AutosaveLane(
    { ru: "", kz: "" },
    8,
    (value, revision) => {
      calls.push({ value, revision });
      return calls.length === 1 ? first.promise : second.promise;
    },
    () => {},
  );
  lane.edit({ ru: "Иван", kz: "Қасым" });
  const flush = lane.flush();
  lane.edit({ ru: "Иванов", kz: "Қасымұлы" });
  const simultaneousFlush = lane.flush();
  assert.equal(calls.length, 1);
  first.resolve({ revision: 9 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls[1], {
    value: { ru: "Иванов", kz: "Қасымұлы" },
    revision: 9,
  });
  second.resolve({ revision: 10 });
  assert.deepEqual(await Promise.all([flush, simultaneousFlush]), [10, 10]);
  assert.equal(lane.dirty, false);
  assert.equal(calls.length, 2);
});
test("network failure retains local edits and expected revision until explicit retry", async () => {
  let fail = true;
  const states: string[] = [];
  const calls: unknown[] = [];
  const lane = new AutosaveLane(
    { ru: "", kz: "" },
    4,
    async (value, revision) => {
      calls.push({ value, revision });
      if (fail) throw new Error("offline");
      return { revision: 5 };
    },
    (state) => states.push(state),
  );
  lane.edit({ ru: "01", kz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І" });
  await assert.rejects(lane.flush(), /offline/);
  assert.equal(lane.dirty, true);
  assert.equal(lane.currentRevision, 4);
  fail = false;
  assert.equal(await lane.flush(), 5);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(states, ["dirty", "saving", "error", "saving", "saved"]);
});
test("no-op flush performs no PATCH and never consumes revision", async () => {
  let calls = 0;
  const lane = new AutosaveLane(
    "same",
    24,
    async () => {
      calls++;
      return { revision: 25 };
    },
    () => {},
  );
  assert.equal(await lane.flush(), 24);
  assert.equal(calls, 0);
});
test("conflicting revision keeps unsaved input intact", async () => {
  const lane = new AutosaveLane(
    { title: "original" },
    1,
    async () => {
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
    () => {},
  );
  lane.edit({ title: "local" });
  await assert.rejects(lane.flush(), /conflict/);
  assert.equal(lane.dirty, true);
  assert.equal(lane.currentRevision, 1);
});
