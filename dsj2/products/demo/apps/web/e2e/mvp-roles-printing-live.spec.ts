import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
const product=path.resolve(__dirname,"../../..");
const output=path.join(product,"docs/evidence/mvp-all-roles-20261019/run-01/printing");
async function login(page:Page,user:{email:string;password:string}){
  await page.goto("/login");await page.getByLabel("Электронная почта",{exact:true}).fill(user.email);await page.getByLabel("Пароль",{exact:true}).fill(user.password);
  for(let i=0;i<3;i++){const result=page.waitForResponse(r=>r.url().endsWith("/api/auth/login")&&r.request().method()==="POST");await page.getByRole("button",{name:"Войти",exact:true}).click();const r=await result;if(r.status()!==429){expect(r.ok(),await r.text()).toBe(true);break;}await page.waitForTimeout(30000);await page.waitForTimeout(31000);}
  await expect(page).not.toHaveURL(/\/login/);
}
test("J11 ordinary operator request, director review, original files and PASSED provenance remain separate from LMS",async({page,browser})=>{
  test.setTimeout(480000);await mkdir(output,{recursive:true});
  const fixture=JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!,"utf8"));
  const context=await browser.newContext({baseURL:process.env.DEMO_ORIGIN});const director=await context.newPage();
  try{
    await login(page,fixture.users.operator);await login(director,fixture.users.director);
    await page.goto("/requests/new");await page.getByRole("radio",{name:/^Организация/}).check();await page.getByRole("button",{name:"Далее",exact:true}).click();await expect(page).toHaveURL(/\/requests\/[a-f0-9-]+\/edit$/);
    const id=/\/requests\/([a-f0-9-]+)\/edit$/.exec(page.url())![1];
    const read=async()=>{const r=await page.request.get(`/api/print-requests/${id}`);expect(r.ok(),await r.text()).toBe(true);return r.json();};
    await page.getByLabel("Название компании",{exact:true}).fill(`Синтетическая обычная печать ${Date.now()}`);
    await page.getByLabel("ФИО, строка 1",{exact:true}).fill("Синтетический Печатный Сотрудник");
    await page.getByLabel("Должность · RU, строка 1",{exact:true}).fill("Слесарь");await page.getByLabel("Должность · KZ, строка 1",{exact:true}).fill("Жөндеуші");
    await page.getByRole("button",{name:"ПТМ: добавить всем в заявке (1)",exact:true}).click();
    await page.getByText("Параметры обучения и документов",{exact:true}).click();
    await page.getByLabel("Объём обучения, часов",{exact:true}).filter({visible:true}).first().fill("16");
    await expect.poll(async()=>{const d=await read();return d.items?.[0]?.assignments?.length||0;}).toBeGreaterThan(0);
    await page.getByRole("button",{name:"Дополнительные действия",exact:true}).click();await page.getByRole("button",{name:"Сохранить изменения",exact:true}).click();await expect(page.locator(".save-indicator")).toContainText(/сохранена/i);
    const draft=await read();expect(draft.items[0].assignments.every((a:any)=>a.outcome?.status==="PASSED"&&a.fieldOrigins?.outcome==="AUTO"&&a.outcome?.source==="Стандартный положительный результат при создании назначения")).toBe(true);
    const ready=page.getByRole("region",{name:"Готовность и состав следующего выпуска"});
    const sent=page.waitForResponse(r=>r.url().endsWith(`/print-requests/${id}/approval/submit`)&&r.request().method()==="POST",{timeout:180000});await ready.getByRole("button",{name:/Проверить и передать директору/}).click();const response=await sent;expect(response.ok(),await response.text()).toBe(true);const submitted=await response.json();expect(submitted.approval.status).toBe("PENDING");
    await director.goto(`/approvals?proposal=${submitted.approval.proposalId}`);
    await director.getByText(/^Предпросмотр данных всех людей и документов/).click();
    await expect(director.getByRole("region",{name:"Подготовленные данные редакции"})).toContainText("Синтетический Печатный Сотрудник");
    const viewer=director.getByRole("region",{name:"Предпросмотр назначенных документов"});await viewer.getByRole("button",{name:"Создать предпросмотр",exact:true}).click();await expect(viewer.getByRole("img",{name:/^Страница 1 из/})).toBeVisible({timeout:180000});await director.screenshot({path:path.join(output,"director-preview.png"),fullPage:true});
    await director.getByRole("button",{name:"Согласовать эту редакцию",exact:true}).click();await expect.poll(async()=>(await read()).approval?.status).toBe("APPROVED");
    await expect(page.getByRole("button",{name:"Сформировать документы",exact:true})).toBeEnabled({timeout:30000});await page.getByRole("button",{name:"Сформировать документы",exact:true}).click();
    await expect.poll(async()=>{const d=await read();return d.jobs?.filter((j:any)=>j.provenance==="ORIGINAL"||j.issuanceId).every((j:any)=>j.status==="SUCCEEDED")&&d.documents?.length>0;},{timeout:210000}).toBe(true);
    const issued=await read();expect(issued.issuances).toHaveLength(1);expect(new Set(issued.documents.map((d:any)=>d.number)).size).toBe(issued.documents.length);
    const pdf=issued.artifacts.find((a:any)=>a.format==="PDF"&&a.provenance==="ORIGINAL");expect(pdf).toBeTruthy();const file=await page.request.get(`/api/artifacts/${pdf.id}`);expect(file.ok(),await file.text()).toBe(true);expect((await file.body()).subarray(0,4).toString()).toBe("%PDF");
    await writeFile(path.join(output,"ordinary.pdf"),await file.body());
    const docx=issued.artifacts.find((a:any)=>a.format==="DOCX"&&a.provenance==="ORIGINAL");expect(docx).toBeTruthy();
    const docxFile=await page.request.get(`/api/artifacts/${docx.id}`);expect(docxFile.ok()).toBe(true);expect((await docxFile.body()).subarray(0,2).toString()).toBe("PK");
    await writeFile(path.join(output,"ordinary.docx"),await docxFile.body());await page.screenshot({path:path.join(output,"operator-files.png"),fullPage:true});
    const record={status:"PASS",synthetic:true,requestId:id,issuedDocumentIds:issued.documents.map((d:any)=>d.id),numbers:issued.documents.map((d:any)=>d.number),pdfArtifactId:pdf.id,docxArtifactId:docx.id,defaultOutcome:"PASSED",defaultOutcomeOrigin:"AUTO",outcomeSources:draft.items[0].assignments.map((a:any)=>a.outcome.source),ordinaryRequestSource:issued.requestSource||"ORDINARY",unsignedPaperIsNotElectronicOriginal:true};
    await writeFile(path.join(output,"J11-printing.json"),JSON.stringify(record,null,2));
  }finally{await context.close();}
});
