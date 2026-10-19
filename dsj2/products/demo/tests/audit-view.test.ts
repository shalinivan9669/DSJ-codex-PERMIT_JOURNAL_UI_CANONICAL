import test from "node:test";
import assert from "node:assert/strict";
import {auditDetails} from "../apps/api/src/audit-view";
test("audit projection exposes trusted IP and safe state transitions without metadata or secrets", () => {
  const result = auditDetails({trustedIp:"127.0.0.1",previous:{role:"OPERATOR",passwordHash:"secret",email:"private@example.test",sessionVersion:1},current:{role:"TEACHER",active:true,sessionVersion:2},token:"secret",answers:["correct"],source:{raw:"private"}});
  assert.deepEqual(result,{ip:"127.0.0.1",before:{role:"OPERATOR",sessionVersion:1},after:{role:"TEACHER",active:true,sessionVersion:2},details:null});
  assert.ok(!JSON.stringify(result).includes("secret"));
});
test("audit projection handles scalar transitions and rejects spoofed IP and arbitrary nested data", () => {
  assert.deepEqual(auditDetails({trustedIp:"127.0.0.1, 8.8.8.8",before:false,after:true,password:"secret"}),{ip:null,before:{value:false},after:{value:true},details:null});
  const result=auditDetails({previousRole:"DIRECTOR",currentRole:"SUPER_ADMIN",sessionsRevoked:true,metadata:{password:"secret"}});
  assert.deepEqual(result.before,{role:"DIRECTOR"}); assert.deepEqual(result.after,{role:"SUPER_ADMIN"});
  assert.deepEqual(auditDetails({before:"private name",after:{unknown:"private",role:{password:"secret"}}}),{ip:null,before:null,after:null,details:null});
});
