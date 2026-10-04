import test from "node:test";
import assert from "node:assert/strict";
import { AutosaveLane } from "../lib/autosave";
test("conflict pause retains subsequent local input without another PATCH until a new explicit base", async () => {
  let calls = 0;
  const conflict = new Error("conflict");
  const states: string[] = [];
  const lane = new AutosaveLane(
    "base",
    7,
    async () => {
      calls++;
      throw conflict;
    },
    (state) => states.push(state),
  );
  lane.edit("local first");
  await assert.rejects(lane.flush(), /conflict/);
  lane.pause(conflict);
  lane.edit("local second");
  lane.edit("local final");
  await assert.rejects(lane.flush(), /conflict/);
  await assert.rejects(lane.flush(), /conflict/);
  assert.equal(calls, 1);
  assert.equal(lane.currentVersion, 3);
  assert.equal(lane.currentRevision, 7);
  assert.equal(lane.dirty, true);
  assert.deepEqual(states.slice(-2), ["paused", "paused"]);
  const saved: string[] = [];
  const reloaded = new AutosaveLane(
    "server",
    8,
    async (value) => {
      saved.push(value);
      return { revision: 9 };
    },
    () => {},
  );
  reloaded.edit("new edit after resolution");
  assert.equal(await reloaded.flush(), 9);
  assert.deepEqual(saved, ["new edit after resolution"]);
});
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

test("a late validation failure identifies its captured input generation", async () => {
  const save = deferred<{ revision: number }>();
  let failedVersion: number | undefined;
  const lane = new AutosaveLane(
    { name: "Original" },
    3,
    () => save.promise,
    (state, _revision, _error, version) => {
      if (state === "error") failedVersion = version;
    },
  );
  lane.edit({ name: "Invalid submitted value" });
  const flushing = lane.flush();
  lane.edit({ name: "Corrected while saving" });
  save.reject(new Error("validation"));
  await assert.rejects(flushing, /validation/);
  assert.equal(failedVersion, 1);
  assert.equal(lane.currentVersion, 2);
  assert.notEqual(failedVersion, lane.currentVersion);
  assert.equal(lane.currentRevision, 3);
  assert.equal(lane.dirty, true);
});

test("malformed or unchanged acknowledgements never mark local input saved", async () => {
  for (const revision of [undefined, NaN, 0, 3, 3.5]) {
    const states: string[] = [];
    const lane = new AutosaveLane(
      "original",
      3,
      async () => ({ revision: revision as number }),
      (state) => states.push(state),
    );
    lane.edit("must retain");
    await assert.rejects(lane.flush(), /Сервер не подтвердил новую редакцию/);
    assert.equal(lane.dirty, true);
    assert.equal(lane.currentRevision, 3);
    assert.equal(states.includes("saved"), false);
    assert.equal(states.at(-1), "error");
  }
});

test("synchronous persistence failure releases the lane for retry", async () => {
  let calls = 0;
  const lane = new AutosaveLane(
    "original",
    3,
    () => {
      calls += 1;
      if (calls === 1) throw new Error("adapter failed synchronously");
      return Promise.resolve({ revision: 4 });
    },
    () => {},
  );
  lane.edit("retained");
  await assert.rejects(lane.flush(), /adapter failed synchronously/);
  assert.equal(await lane.flush(), 4);
  assert.equal(calls, 2);
  assert.equal(lane.dirty, false);
});
