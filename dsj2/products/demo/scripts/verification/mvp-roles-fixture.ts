import {randomBytes} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {db} from "../../apps/api/src/core";
import {passwordHash} from "../../apps/api/src/auth";
import {provision} from "../setup";
const url = new URL(process.env.DATABASE_URL || "");
if(url.hostname !== "127.0.0.1" || url.port !== "55489" || url.pathname !== "/demo_test_mvp_roles_20261019_run01_browser") throw new Error("OWN_MVP_BROWSER_DATABASE_REQUIRED");
const output = path.resolve(process.env.DEMO_MVP_FIXTURE || ".runtime/mvp-all-roles-20261019/run-01/browser-fixture.json");
async function main() {
  try {const existing = JSON.parse(await readFile(output, "utf8")); if (await db.tenant.findUnique({where: {id: existing.tenantId}})) {console.log(JSON.stringify({existing: true, fixture: output})); return;}} catch { /* Initial fixture. */ }
  const password = `Mvp-${randomBytes(18).toString("base64url")}!`;
  const a = await provision({email: "mvp-director-a@example.test", password, name: "Синтетический центр А", sample: true});
  const b = await provision({email: "mvp-director-b@example.test", password, name: "Синтетический центр Б", sample: true});
  await db.user.updateMany({where: {id: {in: [a.userId,b.userId]}}, data: {passwordHash: await passwordHash(password)}});
  await db.tenant.updateMany({where: {id: {in: [a.tenantId,b.tenantId]}}, data: {timezone: "Asia/Qyzylorda"}});
  const users: Record<string, {id: string; email: string; password: string; role: string; recipientId?: string}> = {
    director: {id: a.userId, email: a.email, password, role: "DIRECTOR"},
    bootstrap: {id: b.userId, email: b.email, password, role: "DIRECTOR"},
  };
  for(const [key, role] of Object.entries({superAdmin: "SUPER_ADMIN",admin: "ADMIN",operator: "OPERATOR",viewer: "VIEWER",methodist: "METHODIST",teacher: "TEACHER",expert: "EXPERT",learner: "LEARNER",employer: "EMPLOYER",readOnlyEmployer: "EMPLOYER",assignOnlyEmployer: "EMPLOYER",downloadOnlyEmployer: "EMPLOYER",expiredEmployer: "EMPLOYER",combined: "OPERATOR"})) {
    const email = `mvp-${key.toLowerCase()}@example.test`;
    const passwordDigest = await passwordHash(password);
    const user = await db.user.upsert({where: {email}, create: {tenantId: a.tenantId, email, passwordHash: passwordDigest, displayName: `Синтетический ${role} ${key}`, role},update: {passwordHash: passwordDigest}});
    users[key] = {id: user.id, email: user.email, role, password};
    if(key === "learner" || key === "combined") {
      const existing = await db.learnerProfile.findUnique({where: {tenantId_userId: {tenantId: a.tenantId, userId: user.id}}});
      if(existing) users[key].recipientId = existing.recipientId;
      else {
        const recipient = await db.recipient.create({data: {tenantId: a.tenantId, data: {fullNameRu: `Синтетический ${key}`, fullNameKz: `Синтетикалық ${key}`, positionRu: "Работник", positionKz: "Қызметкер"}}});
        await db.learnerProfile.create({data: {tenantId: a.tenantId, userId: user.id, recipientId: recipient.id, consentVersion: "lms-personal-data-2026-10-15-v1", consentAt: new Date()}});
        users[key].recipientId = recipient.id;
      }
    }
  }
  const organizations: Record<string,string> = {};
  for(const [key, tenantId, bin] of [["a1", a.tenantId,"999001000001"],["a2",a.tenantId,"999001000002"],["b1",b.tenantId,"999001000003"]]) {
    const customer = await db.customerOrganization.create({data: {tenantId, nameRu: `ТОО «Синтетическая организация ${key}»`, nameKz: `«Синтетикалық ұйым ${key}» ЖШС`, bin, addressRu: "Синтетический адрес", addressKz: "Синтетикалық мекенжай"}});
    organizations[key] = customer.id;
  }
  for(const [key, permissions] of Object.entries({employer:["READ","DOWNLOAD","ASSIGN_TRAINING"],readOnlyEmployer:["READ"],assignOnlyEmployer:["READ","ASSIGN_TRAINING"],downloadOnlyEmployer:["DOWNLOAD"],expiredEmployer:["READ","DOWNLOAD","ASSIGN_TRAINING"]})) {
    await db.employerMembership.create({data: {tenantId: a.tenantId, customerId: organizations.a1,userId: users[key].id, permissions, createdBy: users.superAdmin.id, ...(key === "expiredEmployer" ? {expiresAt: new Date("2020-01-01")} : {})}});
  }
  for(const key of ["learner","combined"]) await db.recipientEmployment.create({data: {tenantId: a.tenantId, recipientId: users[key].recipientId!, employerId: organizations.a1, createdBy: users.superAdmin.id}});
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output, JSON.stringify({owner: "mvp-all-roles-20261019-run01", tenantId: a.tenantId, otherTenantId: b.tenantId, organizations, users},null,2));
  console.log(JSON.stringify({fixture: output, tenants: 2, organizations: 3, roles: Object.keys(users)}));
}
void main().finally(() => db.$disconnect());
