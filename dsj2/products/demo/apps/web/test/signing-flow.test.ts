import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attestedSignerName,
  paperSignerDefaults,
  type SigningPerson,
} from "../lib/signing-flow";

const signer = (kind: string, displayName: string): SigningPerson => ({
  kind,
  displayName,
  canSign: false,
  signed: false,
});

test("paper defaults retain a person's separate capacities and use the frozen role rather than row order", () => {
  assert.deepEqual(
    paperSignerDefaults([
      signer("TEACHER", "Иванов И.И."),
      signer("DIRECTOR", "Петров П.П."),
      signer("CHAIR", "Иванов И.И."),
      signer("MEMBER", "Другой человек"),
    ]),
    ["Петров П.П.", "Иванов И.И.", "Иванов И.И."],
  );
});

test("unresolved role placeholders must never be offered as a real paper signer's name", () => {
  assert.deepEqual(
    paperSignerDefaults([
      signer("DIRECTOR", "Руководитель учебного центра"),
      signer("CHAIR", "Председатель комиссии"),
      signer("TEACHER", "Преподаватель"),
    ]),
    ["", "", ""],
  );
  assert.deepEqual(paperSignerDefaults([signer("CHAIR", "  Есен Д.А.  ")]), [
    "",
    "Есен Д.А.",
    "",
  ]);
});

test("displayed paper names come from the attested original in the right role, including user corrections", () => {
  const actual = [
    "Директор по оригиналу",
    "Председатель по оригиналу",
    "Преподаватель по оригиналу",
  ];
  assert.equal(attestedSignerName("TEACHER", actual), actual[2]);
  assert.equal(attestedSignerName("CHAIR", actual), actual[1]);
  assert.equal(attestedSignerName("DIRECTOR", actual), actual[0]);
  assert.equal(attestedSignerName("MEMBER", actual), undefined);
  assert.equal(attestedSignerName("DIRECTOR", ["Неполный состав"]), undefined);
});
