import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { z as old } from "zod/v3";
import { ncalayerCertificateMetadataSchema, egovMobileQrCallbackSchema, auditLogSchema } from "@dsj/types";
import { ZodValidationPipe } from "./zod-validation.pipe";

test("signature timestamps retain v3 acceptance for valid and invalid formats", () => {
  const original = old.string().datetime({ offset: true });
  const base = {signerName:"Тест",signerIin:"000000000000",certificateSerial:"123",certificateThumbprint:"abc",certificateSubject:"Test",certificateIssuer:"Test"};
  const days = ["2024-01-01", "2024-02-29", "2023-02-29", "2024-02-31", "2024-12-31", "0000-01-01"];
  const times = ["00:00", "12:00", "23:59:59", "12:00:00.123456", "24:00", "12:60:00", ""];
  const offsets = ["Z", "+0600", "+06:00", "-0000", "-00:00", "+06", "", "+99:99"];
  for (const day of days) for (const time of times) for (const offset of offsets) {
    const value = `${day}T${time}${offset}`;
    const expected = original.safeParse(value).success;
    const cert = ncalayerCertificateMetadataSchema.safeParse({...base,certificateValidFrom:value,certificateValidTo:value}).success;
    const callback = egovMobileQrCallbackSchema.safeParse({signedAt:value}).success;
    assert.equal(cert, expected, `certificate timestamp: ${value}`);
    assert.equal(callback, expected, `callback timestamp: ${value}`);
  }
});

test("audit metadata is a string-keyed record and preserves nested values", () => {
  const base = {id:"1",action:"x",entityType:"x",entityId:"1",actorName:null,createdAt:"now"};
  const metadata = {count:1,other:{nested:true},list:["x"]};
  assert.deepEqual(auditLogSchema.parse({...base,metadata}).metadata, metadata);
  assert.equal(auditLogSchema.safeParse({...base,metadata:null}).success, true);
  assert.equal(auditLogSchema.safeParse({...base,metadata:[]}).success, false);
});

test("validation errors retain Russian messages without exposing submitted input", () => {
  const secret = "PRIVATE-USER-VALUE";
  const schema = z.object({title:z.string().min(3).max(5),email:z.string().email(),kind:z.enum(["a","b"])});
  const pipe = new ZodValidationPipe(schema);
  let response: any;
  try { pipe.transform({title:"x",email:secret,kind:"wrong"}); assert.fail("expected validation failure"); }
  catch (error: any) { response=error.getResponse(); }
  assert.ok(response.message.includes("title: Минимум 3 символа."));
  assert.ok(response.message.includes("email: Некорректный email."));
  assert.ok(response.message.includes("kind: Недопустимое значение."));
  assert.doesNotMatch(JSON.stringify(response), new RegExp(secret));
  try { pipe.transform({email:"a@example.com",kind:"a"}); assert.fail("expected validation failure"); }
  catch (error: any) { assert.ok(error.getResponse().message.includes("title: Поле обязательно.")); }
});
