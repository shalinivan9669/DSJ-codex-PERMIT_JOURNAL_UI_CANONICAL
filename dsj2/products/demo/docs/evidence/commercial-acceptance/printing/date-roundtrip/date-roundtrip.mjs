import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),require=createRequire(path.join(root,'apps/web/package.json'));
const {chromium,expect}=require('@playwright/test');
const out=path.join(root,'docs/evidence/commercial-acceptance/printing/date-roundtrip');await fs.mkdir(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];const stamp=Date.now();
const zones=['Asia/Almaty','America/Los_Angeles'];
try{
 for(const [zi,timezoneId] of zones.entries()){
  const context=await browser.newContext({baseURL:'http://localhost:3200',timezoneId,viewport:{width:1366,height:900}});const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto('/login');await page.getByLabel('Электронная почта',{exact:true}).fill('admin@demo.local');await page.getByLabel('Пароль',{exact:true}).fill(process.env.DEMO_E2E_PASSWORD);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:'Заявки на печать'})).toBeVisible();
  for(const spec of [{kind:'leap',documentDate:'2028-02-29',protocolDate:'2028-02-28'},{kind:'year',documentDate:'2027-01-01',protocolDate:'2026-12-31'}]){
   const name=`date-${zi}-${spec.kind}`;const dir=path.join(out,name);await fs.mkdir(dir,{recursive:true}); if(await fs.stat(path.join(dir,'result.json')).then(()=>true).catch(()=>false)){results.push(JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8')));continue;}
   try{
    await page.goto('/requests');await page.getByRole('link',{name:'Новая заявка',exact:true}).click();await page.getByRole('button',{name:/Человек Документы/}).click();
    await page.getByLabel('Название заявки',{exact:true}).fill(`ТЕСТ A21 ${timezoneId} ${spec.kind} ${stamp}`);
    await page.getByLabel('ФИО RU, строка 1').fill(`Тестовый Календарный Получатель ${zi+1}`);await page.getByLabel('ФИО KZ, строка 1').fill(`Сынақ Әли Қасымұлы ${zi+1}`);
    const demo=page.getByLabel('Тестовый комплект',{exact:true});if(await demo.isEnabled())await demo.check();else await expect(demo).toBeChecked();
    const assignment=page.locator('.assignment-list details').first();if(!await assignment.evaluate(e=>e.open))await assignment.locator('summary').click();
    await assignment.getByLabel('Форма документа',{exact:true}).selectOption('ps-witness');
    await assignment.getByLabel('Дата документа',{exact:true}).fill(spec.documentDate);await assignment.getByLabel('Дата протокола',{exact:true}).fill(spec.protocolDate);
    await assignment.getByLabel('Программа / тема обучения',{exact:true}).fill('ТЕСТ: календарная проверка');await assignment.getByLabel('Подтверждённый результат / оценка').fill('ТЕСТ: сдал / тапсырды');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.locator('.save-indicator')).toContainText('Сохранено');
    const requestId=/requests\/([^/]+)/.exec(page.url())[1];await page.reload();
    const again=page.locator('.assignment-list details').first();if(!await again.evaluate(e=>e.open))await again.locator('summary').click();
    await expect(again.getByLabel('Дата документа',{exact:true})).toHaveValue(spec.documentDate);await expect(again.getByLabel('Дата протокола',{exact:true})).toHaveValue(spec.protocolDate);
    const ui={documentDate:await again.getByLabel('Дата документа',{exact:true}).inputValue(),protocolDate:await again.getByLabel('Дата протокола',{exact:true}).inputValue(),browser:await page.evaluate(()=>({zone:Intl.DateTimeFormat().resolvedOptions().timeZone,midnightProbe:new Date('2027-01-01T00:30:00Z').toString()}))};
    await page.screenshot({path:path.join(dir,'ui-reloaded.png'),fullPage:true});
    const draft=await (await page.request.get(`/api/print-requests/${requestId}`)).json();await fs.writeFile(path.join(dir,'before-issue.json'),JSON.stringify(draft,null,2));
    await page.getByRole('button',{name:'Проверить',exact:true}).click();await expect(page.getByText('Данные прошли проверку',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Оформить комплект',exact:true}).click();await page.getByRole('button',{name:'Оформить',exact:true}).click();await expect(page.locator('.title-with-status .status')).toHaveText('Оформлено');
    await expect(page.locator('.files-panel')).toContainText('Готово 4 из 4',{timeout:240000});
    const final=await (await page.request.get(`/api/print-requests/${requestId}`)).json();await fs.writeFile(path.join(dir,'issued-response.json'),JSON.stringify(final,null,2));
    expect(final.issuances).toHaveLength(1);const captured=final.issuances[0].snapshot.draft.items[0].assignments[0];expect(captured.documentDate).toBe(spec.documentDate);expect(captured.protocolDate).toBe(spec.protocolDate);
    const artifacts=[];for(const a of final.artifacts){const resp=await page.request.get(`/api/artifacts/${a.id}`);expect(resp.ok()).toBe(true);const bytes=await resp.body();expect(sha(bytes)).toBe(a.sha256);const file=`${a.format.toLowerCase()}-${a.id}.${a.format.toLowerCase()}`;await fs.writeFile(path.join(dir,file),bytes);artifacts.push({id:a.id,format:a.format,file,sha256:sha(bytes),provenance:a.provenance,bytes:bytes.length});}
    await page.reload();const issued=page.locator('.assignment-list details').first();if(!await issued.evaluate(e=>e.open))await issued.locator('summary').click();await expect(issued.getByLabel('Дата документа',{exact:true})).toHaveValue(spec.documentDate);await expect(issued.getByLabel('Дата протокола',{exact:true})).toHaveValue(spec.protocolDate);
    await page.screenshot({path:path.join(dir,'ui-issued-reloaded.png'),fullPage:true});
    const result={name,status:'BROWSER_AND_SNAPSHOT_PASS_PDF_PENDING',requestId,requestUrl:page.url(),timezoneId,expected:spec,ui,snapshotAssignment:captured,browserVersion:browser.version(),templates:final.issuances[0].snapshot.templates.map(t=>({id:t.contract.id,version:t.version,checksum:t.checksum})),artifacts};results.push(result);await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({name,requestId,status:result.status}));
   }catch(e){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(dir,'failure.txt'),String(e.stack));throw e;}
  }
  await context.close();
 }
 await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();}

