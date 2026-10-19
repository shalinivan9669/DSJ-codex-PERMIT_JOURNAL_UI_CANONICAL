import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const product = path.resolve(__dirname, "../../..");
const runtime = path.join(product, ".runtime/mvp-all-roles-20261019/run-01");
const evidence = path.join(product, "docs/evidence/mvp-all-roles-20261019/run-01/entry/identity");
const base = JSON.parse(readFileSync(path.join(runtime, "browser-fixture.json"), "utf8"));
const cabinets = JSON.parse(readFileSync(path.join(runtime, "cabinet-fixture.json"), "utf8"));
const imports = JSON.parse(readFileSync(path.join(product, "docs/evidence/mvp-all-roles-20261019/run-01/imports/UX_IMPORTS.json"), "utf8"));
test.use({ trace: "off", screenshot: "off", video: "off" });
async function login(page: Page, user: {email: string; password: string}) {
  await page.goto("/login");
  await page.getByRole("button", {name:"RU",exact:true}).click();
  await page.getByLabel("Электронная почта", {exact:true}).fill(user.email);
  await page.getByLabel("Пароль", {exact:true}).fill(user.password);
  for(let attempt=0;attempt<3;attempt++) {
    const pending = page.waitForResponse(r=>r.url().endsWith("/api/auth/login")&&r.request().method()==="POST");
    await page.getByRole("button",{name:"Войти",exact:true}).click();
    const response = await pending;
    if(response.status()!==429){expect(response.ok(),`Login HTTP${response.status()}`).toBe(true);break;}
    await page.waitForTimeout(61000);
  }
  await expect(page).not.toHaveURL(/\/login/);
}

test("J02 fresh assigned learner invitation, consent, center recovery delivery and new-password login via UI",async({page,browser})=>{
  test.setTimeout(300000);
  await mkdir(evidence,{recursive:true});
  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  const recoveryContext = await browser.newContext();
  const recovery = await recoveryContext.newPage();
  const email = `mvp-identity-${Date.now()}@example.test`;
  const password = `Invite-${randomBytes(18).toString("base64url")}!`;
  const newPassword = `Recover-${randomBytes(18).toString("base64url")}!`;
  try {
    await login(page,cabinets.users.admin);
    const groupId = imports.actions.find((a:{count:number})=>a.count===250).groupId;
    const groupResponse = await page.request.get(`/api/lms/groups/${groupId}`);
    expect(groupResponse.status()).toBe(200);
    const group = await groupResponse.json();
    const person = group.items.find((item:{learnerUserId:string|null})=>!item.learnerUserId);
    expect(person, "Fresh synthetic import participant without account").toBeTruthy();
    await page.goto(`/lms/results?enrollmentId=${person.id}`);
    const access = page.locator(".lms-access");
    await expect(access.getByRole("heading",{name:"Доступ слушателей",exact:true})).toBeVisible();
    await access.getByLabel("Электронная почта",{exact:true}).fill(email);
    await access.getByRole("checkbox").check();
    await access.getByRole("button",{name:"Подготовить приглашения · 1",exact:true}).click();
    await expect(access.getByLabel("Личная ссылка активации",{exact:false})).toBeVisible();
    const inviteUrl = await access.getByLabel("Личная ссылка активации",{exact:false}).inputValue();
    await expect(access.getByText(/автоматической отправки нет/)).toBeVisible();
    await learner.goto(inviteUrl);
    await expect(learner.getByRole("heading",{name:"Принять приглашение",exact:true})).toBeVisible();
    await expect(learner.getByText(person.recipient.data.fullNameRu,{exact:true})).toBeVisible();
    await learner.getByLabel("Придумайте пароль",{exact:true}).fill(password);
    const consent = learner.getByRole("checkbox");
    await expect(consent).not.toBeChecked();
    await learner.getByRole("button",{name:"Принять приглашение",exact:true}).click();
    await expect(learner).toHaveURL(/\/learn\/invite/);
    await consent.check();
    await learner.getByRole("button",{name:"Принять приглашение",exact:true}).click();
    await expect(learner).toHaveURL(/\/learn$/);
    await expect(learner.getByRole("heading",{name:"Моё обучение",exact:true})).toBeVisible();
    const ownResponse = await learner.request.get("/api/learn/enrollments");
    expect(ownResponse.status()).toBe(200);
    const own = await ownResponse.json();
    expect(own.items.some((item:{id:string})=>item.id===person.id)).toBe(true);
    await learner.screenshot({path:path.join(evidence,"invitation-accepted.png"),fullPage:true});
    await page.reload();
    await expect(access.getByText(email,{exact:true})).toBeVisible();
    await access.getByText("Восстановление доступа",{exact:true}).click();
    await access.getByRole("button",{name:"Подготовить ссылку восстановления",exact:true}).click();
    const recoveryUrl = await access.getByLabel("Ссылка восстановления",{exact:false}).inputValue();
    expect(recoveryUrl).toContain("/learn/recovery#token=");
    await recovery.goto(recoveryUrl);
    await expect(recovery.getByRole("heading",{name:"Новый пароль",exact:true})).toBeVisible();
    await recovery.getByLabel("Придумайте пароль",{exact:true}).fill(newPassword);
    await recovery.getByRole("button",{name:"Изменить пароль",exact:true}).click();
    await expect(recovery).toHaveURL(/\/login/);
    await learner.reload();
    await expect(learner.getByLabel("Пароль",{exact:true})).toBeVisible();
    await login(recovery,{email,password:newPassword});
    await expect(recovery.getByRole("heading",{name:"Моё обучение",exact:true})).toBeVisible();
    const after = await recovery.request.get("/api/learn/enrollments");
    expect(after.status()).toBe(200);
    expect((await after.json()).items.some((item:{id:string})=>item.id===person.id)).toBe(true);
    await recovery.screenshot({path:path.join(evidence,"recovery-new-login.png"),fullPage:true});
    await writeFile(path.join(runtime,"identity-result.private.json"),JSON.stringify({email,password:newPassword,recipientId:person.recipientId,enrollmentId:person.id},null,2));
    await writeFile(path.join(evidence,"J02-identity.json"),JSON.stringify({status:"PASS",synthetic:true,recipientId:person.recipientId,enrollmentId:person.id,groupId,invitationIssuedInCenterUI:true,explicitConsentRequired:true,invitationRedeemedInUI:true,recoveryDelivery:"Center prepares a personal link in UI; no outbound provider or message used",recoveryRedeemedInUI:true,oldSessionRevoked:true,newPasswordLogin:true,assignedLearningPreserved:true,mutations:"Browser UI only; GET API readback"},null,2));
  } finally {await learnerContext.close();await recoveryContext.close();}
});

test("J01 combined OPERATOR plus learner switches between own learning and ordinary printing without administration",async({page})=>{
  test.setTimeout(180000);
  await mkdir(evidence,{recursive:true});
  await login(page,base.users.combined);
  await page.locator("header.app-header").getByRole("link",{name:"Моё обучение",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Моё обучение",exact:true})).toBeVisible();
  const mine=await page.request.get("/api/learn/enrollments");expect(mine.status()).toBe(200);
  const learning=await mine.json();expect(learning.total).toBeGreaterThan(0);
  await page.screenshot({path:path.join(evidence,"combined-learning.png"),fullPage:true});
  await page.locator("header.app-header").getByRole("link",{name:"Подготовка документов",exact:true}).click();
  await page.getByRole("link",{name:"Новая заявка",exact:true}).first().click();
  await page.getByRole("radio",{name:"Физическое лицо",exact:true}).check();
  await page.getByRole("button",{name:"Далее",exact:true}).click();
  await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
  const requestId=/\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
  await expect(page.getByLabel("ФИО",{exact:true})).toBeVisible();
  const printing=await page.request.get(`/api/print-requests/${requestId}`);expect(printing.status()).toBe(200);
  const management=await page.request.get("/api/users");expect(management.status()).toBe(403);
  await expect(page.locator("header.app-header").getByRole("link",{name:"Настройки",exact:true})).toHaveCount(0);
  await page.screenshot({path:path.join(evidence,"combined-printing.png"),fullPage:true});
  await page.locator("header.app-header").getByRole("link",{name:"Моё обучение",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Моё обучение",exact:true})).toBeVisible();
  await writeFile(path.join(evidence,"J01-combined.json"),JSON.stringify({status:"PASS",synthetic:true,operationalRole:"OPERATOR",learnerCapability:true,learningCount:learning.total,ownPrintRequestId:requestId,managementDenied:management.status(),navigation:["Моё обучение","Подготовка документов","Новая заявка","Моё обучение"],mutations:"Browser UI creates only own empty printing draft; API GET readback"},null,2));
});
