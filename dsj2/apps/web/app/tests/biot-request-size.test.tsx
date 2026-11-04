import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BIOT_REQUEST_BYTES, serializeBiotRequest } from "../../lib/biot-request-size";

test("accepts a JSON request exactly at the API's byte limit and rejects one byte over", () => {
  const overhead = Buffer.byteLength(JSON.stringify({ text: "" }));
  const atLimit = { text: "x".repeat(MAX_BIOT_REQUEST_BYTES - overhead) };
  assert.equal(Buffer.byteLength(serializeBiotRequest(atLimit)), MAX_BIOT_REQUEST_BYTES);
  assert.throws(() => serializeBiotRequest({ text: atLimit.text + "x" }), /несколько заявок/);
});

test("measures actual UTF-8 JSON, including non-ASCII text and escapes", () => {
  const overhead = Buffer.byteLength(JSON.stringify({ text: "" }));
  const text = "я".repeat(Math.floor((MAX_BIOT_REQUEST_BYTES - overhead) / 2));
  assert.doesNotThrow(() => serializeBiotRequest({ text }));
  assert.throws(() => serializeBiotRequest({ text: text + "я" }), /фотографий/);
  assert.equal(serializeBiotRequest({ text: "ФИО\n\\\"" }), JSON.stringify({ text: "ФИО\n\\\"" }));
});
