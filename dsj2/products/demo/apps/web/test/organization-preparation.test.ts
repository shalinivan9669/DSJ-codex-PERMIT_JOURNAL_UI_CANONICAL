import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOrganizationPreparationCurrent,
  OrganizationPreparationConflictError,
  writeOrganizationPreparation,
  type OrganizationPreparation,
} from "../lib/organization-preparation";

function storage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    removeItem: (key: string) => {
      records.delete(key);
    },
  };
}
function candidate(
  name: string,
  operationKey: string,
): OrganizationPreparation {
  return { version: 1, operationKey, names: { nameRu: name, nameKz: name } };
}

test("a late company creation response and stale cleanup preserve the newer other-tab candidate", () => {
  const store = storage();
  const a = candidate("Первая компания", "first-operation-key");
  const rawA = writeOrganizationPreparation(store, "scoped", a, null);
  const b = candidate("Новый ввод другой вкладки", "second-operation-key");
  const rawB = writeOrganizationPreparation(store, "scoped", b, rawA);
  const lateA = {
    ...a,
    customer: {
      id: "saved-company",
      nameRu: a.names.nameRu,
      nameKz: a.names.nameKz,
      bin: "",
      addressRu: "",
      addressKz: "",
      archived: false,
    },
  };
  assert.throws(
    () => writeOrganizationPreparation(store, "scoped", lateA, rawA),
    OrganizationPreparationConflictError,
  );
  assert.throws(
    () => writeOrganizationPreparation(store, "scoped", null, rawA),
    OrganizationPreparationConflictError,
  );
  assert.throws(
    () => assertOrganizationPreparationCurrent(store, "scoped", rawA),
    OrganizationPreparationConflictError,
  );
  assert.equal(store.getItem("scoped"), rawB);
  assert.equal(
    JSON.parse(store.getItem("scoped")!).operationKey,
    b.operationKey,
  );
  assert.equal(writeOrganizationPreparation(store, "scoped", null, rawB), null);
});

test("a retry retains the accepted company operation and failed storage does not declare success", () => {
  const store = storage();
  const original = candidate("Сохранённый ввод", "stable-operation-key");
  const raw = writeOrganizationPreparation(store, "scoped", original, null);
  assert.equal(
    writeOrganizationPreparation(store, "scoped", original, raw),
    raw,
  );
  assert.throws(
    () =>
      writeOrganizationPreparation(
        { ...store, setItem: () => {} },
        "scoped",
        candidate("Новый", "other-operation-key"),
        raw,
      ),
    /не сохранил/,
  );
  assert.equal(store.getItem("scoped"), raw);
});
