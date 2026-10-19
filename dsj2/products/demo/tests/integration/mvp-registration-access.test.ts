import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {db, hash} from "../../apps/api/src/core";
import {bootstrap} from "../../apps/api/src/main";
import {passwordHash} from "../../apps/api/src/auth";
import {consentVersion} from "../../packages/contracts/src/lms";
import {lmsTenant, LMS_PASSWORD, lmsSession, lmsHttp, lmsJson} from "./lms-fixture";
import {saveRegistrationPolicy, availableRegistrationCenters} from "../../apps/api/src/lms/registration-policy";

test("registration opt-in, center isolation, audit projection, all role password changes and session revocation", async () => {
  const a=await lmsTenant("MVP registration A"), b=await lmsTenant("MVP registration B");
  const original={PORT:process.env.PORT,DEMO_ORIGIN:process.env.DEMO_ORIGIN,registration:process.env.DEMO_LMS_REGISTRATION_TENANT_ID};
  process.env.PORT="0"; process.env.DEMO_ORIGIN="http://127.0.0.1:3349"; delete process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
  const app=await bootstrap(); const address=app.getHttpServer().address(); const base=`http://127.0.0.1:${address.port}`;
  try {
    const staff=lmsHttp(base,await lmsSession(base,a.user.email));
    assert.ok(!(await availableRegistrationCenters()).centers.some(item=>item.key===a.tenant.id));
    await lmsJson(await staff("/lms/registration-policy","PATCH",{enabled:true}));
    const availability=await lmsJson(await fetch(base+"/learn/registration"));
    assert.ok(availability.centers.some((item:{key:string})=>item.key===a.tenant.id));
    assert.ok(!availability.centers.some((item:{key:string})=>item.key===b.tenant.id));
    const email=`${randomUUID()}@example.test`;
    const register=(extra:Record<string,unknown>)=>fetch(base+"/learn/register",{method:"POST",headers:{origin:process.env.DEMO_ORIGIN!,"content-type":"application/json"},body:JSON.stringify({email,password:LMS_PASSWORD,displayName:"Синтетическая регистрация",consentVersion,consent:true,...extra})});
    assert.equal((await register({centerKey:b.tenant.id})).status,409);
    assert.equal((await register({centerKey:a.tenant.id,tenantId:b.tenant.id})).status,400);
    assert.equal((await register({centerKey:a.tenant.id,consent:false})).status,400);
    const registered=await register({centerKey:a.tenant.id}); assert.equal(registered.status,201,await registered.clone().text());
    const user=await db.user.findUniqueOrThrow({where:{email}}); assert.equal(user.role,"LEARNER"); assert.equal(user.tenantId,a.tenant.id);
    const learner=lmsHttp(base,await lmsSession(base,email));
    assert.equal((await learner("/lms/registration-policy","PATCH",{enabled:false})).status,403);
    await saveRegistrationPolicy(a.context,{enabled:false});
    assert.equal((await register({email:`${randomUUID()}@example.test`,centerKey:a.tenant.id})).status,409);
    const audit=await lmsJson(await staff("/audit"));
    const entry=audit.items.find((item:{action:string})=>item.action==="LMS_REGISTRATION_POLICY_CHANGED");
    assert.ok(entry); assert.equal(entry.after.enabled,false); assert.ok(!("metadata" in entry));
    const bStaff=lmsHttp(base,await lmsSession(base,b.user.email));
    const bAudit=await lmsJson(await bStaff("/audit")); assert.ok(!bAudit.items.some((item:{id:string})=>item.id===entry.id));
    for(const role of ["LEARNER","EMPLOYER","TEACHER","METHODIST","EXPERT","ADMIN","SUPER_ADMIN","OPERATOR","DIRECTOR","VIEWER"]) {
      const account=await db.user.create({data:{tenantId:a.tenant.id,role,email:`${randomUUID()}@example.test`,displayName:"Synthetic password "+role,passwordHash:await passwordHash(LMS_PASSWORD)}});
      // Session is a test precondition; login itself is exercised above. Do not
      // disable the per-IP login throttle to test ten independent role sessions.
      const token=randomBytes(32).toString("hex"), csrf=randomBytes(32).toString("hex");
      await db.session.create({data:{id:hash(token),tenantId:a.tenant.id,userId:account.id,csrfHash:hash(csrf),sessionVersion:account.sessionVersion,expiresAt:new Date(Date.now()+3600_000)}});
      const request=lmsHttp(base,{origin:process.env.DEMO_ORIGIN!,cookie:`demo_session=${token}; demo_csrf=${csrf}`,"x-csrf-token":csrf});
      const profile=await lmsJson(await request("/lms/profile"));
      assert.equal(profile.displayName,account.displayName,role);
      assert.equal((await request("/lms/profile","PUT",{revision:profile.revision,displayName:account.displayName+" updated",preferences:{language:"kz"}})).status,200,role);
      const updated=await lmsJson(await request("/lms/profile"));
      assert.equal(updated.preferences.language,"kz",role);
      assert.equal((await request("/lms/profile","PUT",{revision:updated.revision,displayName:account.displayName,preferences:{},userId:a.user.id,role:"SUPER_ADMIN"})).status,400,role);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:account.id}})).role,role);
      assert.equal((await request("/auth/password","POST",{currentPassword:"wrong",newPassword:LMS_PASSWORD+"-new"})).status,400,role);
      assert.equal((await request("/auth/session")).status,200,role);
      assert.equal((await request("/auth/password","POST",{currentPassword:LMS_PASSWORD,newPassword:LMS_PASSWORD+"-new"})).status,201,role);
      assert.equal((await request("/auth/session")).status,401,role);
      assert.equal(await db.session.count({where:{userId:account.id}}),0,role);
    }
  } finally {
    await app.close();
    if(original.PORT===undefined) delete process.env.PORT; else process.env.PORT=original.PORT;
    if(original.DEMO_ORIGIN===undefined) delete process.env.DEMO_ORIGIN; else process.env.DEMO_ORIGIN=original.DEMO_ORIGIN;
    if(original.registration===undefined) delete process.env.DEMO_LMS_REGISTRATION_TENANT_ID; else process.env.DEMO_LMS_REGISTRATION_TENANT_ID=original.registration;
  }
});
test.after(()=>db.$disconnect());
