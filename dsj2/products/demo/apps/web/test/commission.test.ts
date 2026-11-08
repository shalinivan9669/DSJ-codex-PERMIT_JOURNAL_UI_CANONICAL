import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commissionMissingNames,
  prepareCommissionForSave,
  requestReturnPath,
} from "../lib/commission";

test("unused display slots are not sent as invalid empty members", () => {
  assert.deepEqual(
    prepareCommissionForSave([
      { name: "Председатель", position: "" },
      { name: "Первый член", position: "" },
      { name: "Второй член", position: "" },
      { name: "  ", position: "" },
    ]).map((person) => person.name),
    ["Председатель", "Первый член", "Второй член"],
  );
  assert.deepEqual(
    prepareCommissionForSave(
      Array.from({ length: 3 }, () => ({ name: "", position: "" })),
    ),
    [],
  );
});

test("a missing chair is retained and flagged rather than silently promoting a member", () => {
  const rows = [
    { name: "", position: "" },
    { name: "Первый член", position: "" },
    { name: "Второй член", position: "" },
  ];
  assert.equal(prepareCommissionForSave(rows)[0].name, "");
  assert.deepEqual(commissionMissingNames(rows), [0]);
});

test("repair requires three names and preserves bilingual data", () => {
  assert.deepEqual(
    commissionMissingNames([{ name: "\u200B\u2060", position: "" }]),
    [0, 1, 2],
  );
  const rows = [
    {
      name: " Председатель ",
      position: " Директор ",
      nameEn: "Chair",
      positionEn: "Director",
    },
  ];
  assert.deepEqual(commissionMissingNames(rows), [1, 2]);
  assert.deepEqual(prepareCommissionForSave(rows)[0], {
    name: "Председатель",
    position: "Директор",
    nameEn: "Chair",
    positionEn: "Director",
  });
  assert.deepEqual(commissionMissingNames([], 0), []);
  assert.deepEqual(
    commissionMissingNames([{ name: "   ", position: "Директор" }], 0),
    [0],
  );
});

test("settings return keeps the request repair context only", () => {
  assert.equal(
    requestReturnPath(
      "/requests/request_123?commission=1&commissionEvent=event-2",
    ),
    "/requests/request_123?commission=1&commissionEvent=event-2",
  );
  assert.equal(
    requestReturnPath("/requests/request_123"),
    "/requests/request_123",
  );
  for (const path of [
    "https://evil.test/requests/id",
    "//evil.test/requests/id",
    "/requests/../settings",
    "/requests/id?redirect=https://evil.test",
    "/requests/id#other",
    "/requests/id?commission=0",
    "/requests/id?commissionEvent=../other",
  ]) {
    assert.equal(requestReturnPath(path), undefined, path);
  }
});
