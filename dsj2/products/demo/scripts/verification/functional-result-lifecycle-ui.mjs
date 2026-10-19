import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const root=process.cwd();
const runtime=path.join(root,".runtime/functional-completion-20261019/run-01");
const evidence=path.join(root,"docs/evidence/functional-completion-20261019/run-01/operations/result-lifecycle");
const originalDir=path.join(root,"docs/evidence/functional-completion-20261019/run-01/documents/sanitary/original");
const statePath=path.join(runtime,"sanitary-lifecycle.private.json");
const data=JSON.parse(await fs.readFile(path.join(runtime,"populated.private.json"),"utf8"));
const stage=process.argv[2]||"baseline";
const enrollmentId="8c0aaf32-4cb3-4750-8097-db379df16329";
const originalResultId="95585bef-3543-41f9-b4cd-76cd30e47452";
const originalRequestId="d0b76fa3-5e67-4a52-b133-85230ecd4695";
if(data.origin!=="http://127.0.0.1:3349"||!["baseline","correct","prepare","verify-issued","revoke","verify-revoked"].includes(stage))throw new Error("SANITARY_LIFECYCLE_GUARD");
const sha=(value)=>createHash("sha256").update(value).digest("hex");
const jsonHash=(value)=>sha(JSON.stringify(value));
const readJson=async file=>JSON.parse(await fs.readFile(file,"utf8"));
const saveJson=async(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2));
await fs.mkdir(evidence,{recursive:true});
let state;
try{state=await readJson(statePath);}catch{state={originalResultId,originalRequestId,enrollmentId};}
const saveState=()=>saveJson(statePath,state);
const browser=await chromium.launch({channel:"chrome",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(25000);
async function read(url){const r=await page.request.get(data.origin+"/api"+url);expect(r.ok(),await r.text()).toBe(true);return r.json();}
async function enrollment(){return read(`/lms/enrollments/${enrollmentId}`);}
function immutableResult(result){const immutable={...result};for(const key of ["state","eligible","documentEligible","reviewReasons"])delete immutable[key];return immutable;}
function verificationLinks(request){return request.issuances.flatMap(i=>i.snapshot.draft.items.flatMap(p=>p.assignments.map(a=>({assignmentId:a.id,url:a.lms?.verification?.url})).filter(a=>a.url)));}
async function publicRecords(request,expected,suffix){
  const records=[];
  const context=await browser.newContext({viewport:{width:1280,height:1000}});
  const visitor=await context.newPage();
  for(const link of verificationLinks(request)){
    const pending=visitor.waitForResponse(r=>r.url().includes("/api/verification/")&&r.request().method()==="GET");
    await visitor.goto(link.url);const response=await pending;expect(response.ok(),await response.text()).toBe(true);
    const record=await response.json();expect(record.status).toBe(expected);
    await expect(visitor.locator("dd").filter({hasText:record.document.number})).toBeVisible();
    await visitor.screenshot({path:path.join(evidence,`${suffix}-${record.document.number}.png`),fullPage:true});records.push(record);
  }
  await context.close();return records;
}
async function registry(request,expected,suffix){
  const pending=page.waitForResponse(r=>r.url().endsWith("/api/lms/reports/query")&&r.request().method()==="POST");
  await page.goto(data.origin+`/lms/reports?kind=DOCUMENT_REGISTRY&sourceRequestId=${request.id}`);
  const response=await pending;expect(response.ok(),await response.text()).toBe(true);const report=await response.json();
  expect(report.items.length).toBe(request.documents.length);
  for(const item of report.items)expect(item.payload.status).toBe(expected);
  await expect(page.getByRole("region",{name:"Строки отчёта",exact:true}).locator("table tbody tr")).toHaveCount(request.documents.length);
  await page.screenshot({path:path.join(evidence,`${suffix}-registry.png`),fullPage:true});return report.items.map(i=>i.payload);
}
async function preserveOriginal(){
  const current=await read(`/print-requests/${originalRequestId}`);
  const reference=await readJson(path.join(runtime,"sanitary-original-request.private.json"));
  expect(current.documents.map(d=>({id:d.id,number:d.number}))).toEqual(reference.documents.map(d=>({id:d.id,number:d.number})));
  expect(jsonHash(current.issuances.map(i=>i.snapshot))).toBe(state.originalSnapshotHash);
  const hashes=[];
  for(const file of state.originalFiles){
    const response=await page.request.get(data.origin+`/api/artifacts/${file.id}`);expect(response.ok()).toBe(true);const bytes=await response.body();
    expect(sha(bytes)).toBe(file.sha256);hashes.push({id:file.id,sha256:sha(bytes),bytes:bytes.length});
  }
  const currentEnrollment=await enrollment();const original=currentEnrollment.results.find(r=>r.id===originalResultId);
  expect(jsonHash(immutableResult(original))).toBe(state.originalResultHash);
  return {oldNumbersUnchanged:true,oldSnapshotUnchanged:true,oldResultUnchanged:true,files:hashes};
}
try{
  await page.goto(data.origin+"/login");await page.locator('input[type="email"]').fill(data.users.director.email);await page.locator('input[type="password"]').fill(data.users.director.password);await page.getByRole("button",{name:"Войти",exact:true}).click();await page.waitForURL(u=>!u.pathname.includes("login"));
  if(stage==="baseline"){
    const original=await read(`/print-requests/${originalRequestId}`);const learning=await enrollment();
    expect(learning.results.find(r=>r.id===originalResultId)?.state).toBe("PASSED");
    await saveJson(path.join(runtime,"sanitary-original-request.private.json"),original);await saveJson(path.join(runtime,"sanitary-original-enrollment.private.json"),learning);
    const issued=await readJson(path.join(originalDir,"issued-result.json"));
    state.originalFiles=[];
    for(const file of issued.outputs){const bytes=await fs.readFile(path.join(originalDir,file.name));state.originalFiles.push({id:file.id,name:file.name,sha256:sha(bytes),bytes:bytes.length});}
    state.originalSnapshotHash=jsonHash(original.issuances.map(i=>i.snapshot));state.originalResultHash=jsonHash(immutableResult(learning.results.find(r=>r.id===originalResultId)));
    await saveState();
    await saveJson(path.join(evidence,"baseline.json"),{status:"PASS",enrollmentId,originalResultId,originalRequestId,files:state.originalFiles,snapshotHash:state.originalSnapshotHash,resultHash:state.originalResultHash,public:await publicRecords(original,"ACTIVE_RECORD","original-active"),registry:await registry(original,"VALID","original-active")});
  }
  if(stage==="correct"||stage==="revoke"){
    if(!state.originalResultHash)throw new Error("BASELINE_REQUIRED");
    const learning=await enrollment();
    const target=stage==="correct"?originalResultId:state.replacementResultId;if(!target)throw new Error("RESULT_REQUIRED");
    const existing=learning.results.find(r=>r.id===target);expect(existing).toBeTruthy();
    const expected=stage==="correct"?"SUPERSEDED":"VOIDED";
    if(existing.state!==expected){
      expect(existing.state).toBe("PASSED");
      await page.goto(data.origin+`/lms/results?enrollmentId=${enrollmentId}`);
      await page.getByText("Исправление или аннулирование",{exact:true}).click();
      const form=page.locator("details").filter({has:page.getByText("Исправление или аннулирование",{exact:true})});
      await form.getByRole("combobox").selectOption(stage==="correct"?"correct":"revoke");
      const reason=stage==="correct"?"Учебная проверка исправления после выпуска: уточнено основание повторной выдачи; сведения об экзамене и оценка сохраняются.":"Учебная проверка аннулирования: исправленная демонстрационная запись отозвана после подтверждённого выпуска. Это не медицинское заключение.";
      await form.getByLabel("Основание",{exact:true}).fill(reason);
      const pending=page.waitForResponse(r=>r.url().endsWith(`/api/lms/results/${target}/${stage==="correct"?"correct":"revoke"}`)&&r.request().method()==="POST");
      await form.getByRole("button",{name:stage==="correct"?"Создать исправленную редакцию":"Аннулировать результат",exact:true}).click();
      const response=await pending;expect(response.ok(),await response.text()).toBe(true);const result=await response.json();
      if(stage==="correct")state.replacementResultId=result.replacementResultId;
      state[stage]={response:result,reason};await saveState();
      await page.reload();await expect(page.getByRole("heading",{name:"Результаты",exact:true})).toBeVisible();
      await page.screenshot({path:path.join(evidence,stage+"-result.png"),fullPage:true});
    }
    const after=await enrollment();expect(after.results.find(r=>r.id===target).state).toBe(expected);
    if(stage==="correct"){
      const replacement=after.results.find(r=>r.id===state.replacementResultId);expect(replacement).toBeTruthy();expect(replacement.revision).toBe(after.results.find(r=>r.id===originalResultId).revision+1);state.replacementResultHash=jsonHash(immutableResult(replacement));await saveState();
      const original=await read(`/print-requests/${originalRequestId}`);
      await saveJson(path.join(evidence,"corrected-result.json"),{status:"PASS",originalResultId,replacementResultId:replacement.id,revision:replacement.revision,reason:state.correct.reason,immutable:await preserveOriginal(),public:await publicRecords(original,"REPLACED","original-replaced"),registry:await registry(original,"SUPERSEDED","original-replaced")});
    }
  }
  if(stage==="prepare"){
    await page.goto(data.origin+`/lms/results?enrollmentId=${enrollmentId}`);
    const button=page.getByRole("button",{name:"Подготовить документы",exact:true});await button.waitFor();
    const pending=page.waitForResponse(r=>r.url().endsWith("/api/lms/results/documents")&&r.request().method()==="POST");await button.click();
    const response=await pending;expect(response.ok(),await response.text()).toBe(true);const prepared=await response.json();
    expect(prepared.errors).toHaveLength(0);const items=prepared.items.filter(i=>i.resultId===state.replacementResultId);expect(items).toHaveLength(2);
    state.replacementRequestId=items[0].requestId;expect(state.replacementRequestId).not.toBe(originalRequestId);await saveState();
    await saveJson(path.join(runtime,"documents-sanitary-request.private.json"),{requestUrl:`/requests/${state.replacementRequestId}`});
    await saveJson(path.join(evidence,"replacement-prepared.json"),{status:"PASS",requestId:state.replacementRequestId,resultId:state.replacementResultId,items});
  }
  if(stage==="verify-issued"||stage==="verify-revoked"){
    const replacement=await read(`/print-requests/${state.replacementRequestId}`);expect(replacement.documents).toHaveLength(2);expect(replacement.issuances).toHaveLength(1);
    const original=await readJson(path.join(runtime,"sanitary-original-request.private.json"));
    for(const doc of replacement.documents)expect(original.documents.map(d=>d.number)).not.toContain(doc.number);
    const revoked=stage==="verify-revoked";
    const replacementFiles=[];
    for(const artifact of replacement.artifacts.filter(a=>a.provenance==="ORIGINAL"&&["PDF","DOCX"].includes(a.format))){const response=await page.request.get(data.origin+`/api/artifacts/${artifact.id}`);expect(response.ok()).toBe(true);const bytes=await response.body();replacementFiles.push({id:artifact.id,format:artifact.format,sha256:sha(bytes),bytes:bytes.length});}
    expect(replacementFiles).toHaveLength(4);
    const replacementSnapshotHash=jsonHash(replacement.issuances.map(i=>i.snapshot));
    if(revoked){expect(replacementFiles).toEqual(state.replacementFiles);expect(replacementSnapshotHash).toBe(state.replacementSnapshotHash);}else{state.replacementFiles=replacementFiles;state.replacementSnapshotHash=replacementSnapshotHash;await saveState();}
    const learning=await enrollment();const result=learning.results.find(r=>r.id===state.replacementResultId);
    expect(result.state).toBe(revoked?"VOIDED":"PASSED");expect(jsonHash(immutableResult(result))).toBe(state.replacementResultHash);
    const publicState=await publicRecords(replacement,revoked?"REVOKED":"ACTIVE_RECORD",revoked?"replacement-revoked":"replacement-issued");
    const registryState=await registry(replacement,revoked?"VOIDED":"VALID",revoked?"replacement-revoked":"replacement-issued");
    const oldPublic=await publicRecords(original,"REPLACED",revoked?"old-after-revoke":"old-after-issue");
    for(const record of oldPublic)expect(record.replacement?.number).toBe(replacement.documents.find(d=>d.templateId===record.document.type).number);
    await saveJson(path.join(evidence,revoked?"F20-final.json":"replacement-issued.json"),{status:"PASS",enrollmentId,originalResultId,replacementResultId:state.replacementResultId,originalRequestId,replacementRequestId:state.replacementRequestId,correctReason:state.correct.reason,...(revoked?{revokeReason:state.revoke.reason}:{}),old:await preserveOriginal(),newDocuments:replacement.documents.map(d=>({id:d.id,number:d.number,type:d.templateId})),replacementResultMetadataUnchanged:true,replacementSnapshotHash,replacementFiles,public:publicState,registry:registryState,oldPublic});
  }
  console.log(JSON.stringify({stage,status:"PASS",replacementResultId:state.replacementResultId,replacementRequestId:state.replacementRequestId}));
}catch(error){await page.screenshot({path:path.join(evidence,stage+"-failure.png"),fullPage:true});throw error;}finally{await browser.close();}
