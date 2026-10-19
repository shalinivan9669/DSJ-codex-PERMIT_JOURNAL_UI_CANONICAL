import {test, expect, type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
const product=path.resolve(__dirname,"../../..");
const fixture=JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!,"utf8"));
const output=path.join(product,"docs/evidence/mvp-all-roles-20261019/run-01/entry");
async function login(page:Page,user:{email:string,password:string}) {
  await page.goto("/login");
  await page.getByLabel("Электронная почта",{exact:true}).fill(user.email);
  await page.getByLabel("Пароль",{exact:true}).fill(user.password);
  const response=page.waitForResponse(r=>r.url().endsWith("/api/auth/login")&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Войти",exact:true}).click();
  const result=await response;
  if(result.status()===429) {await page.waitForTimeout(61000); await page.getByRole("button",{name:"Войти",exact:true}).click();}
  await expect(page).not.toHaveURL(/\/login/,{timeout:30000});
}
test("J01 explicit first super admin, administrative account UI and self-escalation denial; J02 registration configured through UI",async({page,browser})=>{
  test.setTimeout(480000);
  await mkdir(output,{recursive:true});
  const suffix=Date.now();
  await login(page,fixture.users.bootstrap);
  await page.goto("/settings?tab=users");
  const initial=await page.request.get("/api/context").then(r=>r.json());
  if(initial.user.role!=="SUPER_ADMIN") {
    await page.getByRole("button",{name:"Назначить первого суперадминистратора",exact:true}).click();
    const modal=page.getByRole("dialog");
    await modal.getByLabel("Текущий пароль",{exact:true}).fill(fixture.users.bootstrap.password);
    await modal.getByRole("checkbox").check();
    const applied=page.waitForResponse(r=>r.url().endsWith("/api/users/bootstrap-super-admin")&&r.request().method()==="POST");
    await modal.getByRole("button",{name:"Подтвердить назначение",exact:true}).click();
    expect((await applied).status()).toBe(201);
    await expect(page).toHaveURL(/\/login/);
    await login(page,fixture.users.bootstrap);
  }
  await page.goto("/settings?tab=users");
  const created:Record<string,unknown>[]=[];
  for(const role of ["ADMIN","OPERATOR"]) {
    await page.getByRole("button",{name:"Добавить сотрудника",exact:true}).click();
    const modal=page.getByRole("dialog");
    await modal.getByLabel("Имя",{exact:true}).fill(`Синтетический UI ${role}`);
    const email=`mvp-ui-${role.toLowerCase()}-${suffix}@example.test`;
    await modal.getByLabel("Электронная почта",{exact:true}).fill(email);
    await modal.getByRole("combobox",{name:/^Роль/}).selectOption(role);
    await modal.getByLabel("Первоначальный пароль",{exact:true}).fill(fixture.users.bootstrap.password);
    const saved=page.waitForResponse(r=>r.url().endsWith("/api/users")&&r.request().method()==="POST");
    await modal.getByRole("button",{name:"Сохранить",exact:true}).click();
    const response=await saved; expect(response.status(),await response.text()).toBe(201);
    created.push(await response.json()); await expect(modal).toHaveCount(0);
  }
  const auth=await page.request.get("/api/auth/session").then(r=>r.json());
  const denied=await page.request.patch(`/api/users/${fixture.users.bootstrap.id}`,{headers:{origin:process.env.DEMO_ORIGIN!,"x-csrf-token":auth.csrfToken},data:{role:"OPERATOR"}});
  expect(denied.status()).toBe(409); expect((await denied.json()).code).toBe("SELF_ROLE_CHANGE_DENIED");
  await page.screenshot({path:path.join(output,"super-admin-users.png"),fullPage:true});
  const adminContext=await browser.newContext({baseURL:process.env.DEMO_ORIGIN}), anonymous=await browser.newContext({baseURL:process.env.DEMO_ORIGIN});
  try {
    const admin=await adminContext.newPage(), guest=await anonymous.newPage();
    await login(admin,fixture.users.admin); await admin.goto("/settings?tab=users");
    await expect(admin.getByRole("button",{name:/^(Открыть|Закрыть) самостоятельную регистрацию$/})).toBeEnabled();
    const close=admin.getByRole("button",{name:"Закрыть самостоятельную регистрацию",exact:true});
    if(await close.count()) {await close.click(); await expect(admin.getByRole("button",{name:"Открыть самостоятельную регистрацию",exact:true})).toBeVisible();}
    await guest.goto("/learn/register");
    await expect(guest.getByText(/Самостоятельная регистрация сейчас закрыта/)).toBeVisible();
    await expect(guest.getByLabel("ФИО",{exact:true})).toHaveCount(0);
    await admin.getByRole("button",{name:"Открыть самостоятельную регистрацию",exact:true}).click();
    await expect(admin.getByRole("button",{name:"Закрыть самостоятельную регистрацию",exact:true})).toBeVisible();
    await guest.reload();
    const email=`mvp-ui-registered-${suffix}@example.test`;
    await guest.getByLabel("ФИО",{exact:true}).fill("Синтетический новый слушатель");
    await guest.getByLabel("Электронная почта",{exact:true}).fill(email);
    await guest.getByLabel("Придумайте пароль",{exact:true}).fill(fixture.users.learner.password);
    await guest.getByRole("button",{name:"KZ",exact:true}).click();
    await expect(guest.getByLabel("Аты-жөні",{exact:true})).toHaveValue("Синтетический новый слушатель");
    await guest.getByRole("button",{name:"RU",exact:true}).click();
    await guest.getByRole("checkbox").check();
    await guest.getByRole("button",{name:"Создать личный кабинет",exact:true}).click();
    await expect(guest).toHaveURL(/\/learn$/);
    const own=await guest.request.get("/api/context").then(r=>r.json());
    expect(own.user.role).toBe("LEARNER"); expect(own.tenant.id).toBe(fixture.tenantId);
    await guest.getByRole("link",{name:"Профиль и пароль",exact:true}).click();
    await expect(guest.getByLabel("Имя в кабинете",{exact:true})).toHaveValue("Синтетический новый слушатель");
    await guest.setViewportSize({width:390,height:844});
    await guest.screenshot({path:path.join(output,"registered-learner-390.png"),fullPage:true});
    await writeFile(path.join(output,"J01-J02-entry.json"),JSON.stringify({result:"PASS",initialRole:initial.user.role,bootstrapCurrentRole:"SUPER_ADMIN",created,registration:{closedState:true,enabledViaAdminUi:true,tenantId:own.tenant.id,learnerId:own.user.id,consentViaCheckbox:true,localeRetainsInput:true},selfRoleChangeDenied:true},null,2));
  } finally {await adminContext.close();await anonymous.close();}
});
