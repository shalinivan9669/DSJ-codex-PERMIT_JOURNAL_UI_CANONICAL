import {test,expect,type Page,type Locator,type APIResponse} from "@playwright/test";
import {readFileSync,existsSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import type {CourseContent,LmsQuestion} from "../../../packages/contracts/src/lms";
const product=path.resolve(__dirname,"../../..");
const runtime=path.join(product,".runtime/mvp-all-roles-20261019/run-01");
const output=path.join(product,"docs/evidence/mvp-all-roles-20261019/run-01/learning");
type User={id:string;email:string;password:string;recipientId?:string};
async function body<T=any>(response:Pick<APIResponse,"ok"|"status"|"text"|"json">):Promise<T> {expect(response.ok(),`${response.status()} ${await response.text()}`).toBe(true);return response.json();}
async function login(page:Page,user:User) {
  await page.goto("/login");await page.getByLabel("Электронная почта",{exact:true}).fill(user.email);await page.getByLabel("Пароль",{exact:true}).fill(user.password);
  for(let n=0;n<3;n++){const response=page.waitForResponse(r=>r.url().endsWith("/api/auth/login")&&r.request().method()==="POST");await page.getByRole("button",{name:"Войти",exact:true}).click();const r=await response;if(r.status()!==429){expect(r.ok(),await r.text()).toBe(true);break;}await page.waitForTimeout(30000);await page.waitForTimeout(31000);}
  await expect(page).not.toHaveURL(/\/login/,{timeout:30000});
}
async function answer(scope:Locator,q:LmsQuestion) {
  const spec=q.answerSpec!,r=spec.kind==="CASE"?spec.response:spec;
  if(r.kind==="TEXT"){await scope.getByLabel("Ваш ответ").fill("ключ");return;}
  if(r.kind==="MATCHING"){for(const pair of r.pairs)await scope.getByRole("combobox",{name:new RegExp(`^${q.options.find(o=>o.id===pair.leftId)!.textRu}`)}).selectOption(pair.rightId);return;}
  if(r.kind==="ORDERING"){
    for(let target=0;target<r.correctOrderIds.length;target++){const label=q.options.find(o=>o.id===r.correctOrderIds[target])!.textRu;let labels=await scope.locator("ol li > span").allTextContents();while(labels.indexOf(label)>target){await scope.getByRole("button",{name:`Выше: ${label}`,exact:true}).click();labels=await scope.locator("ol li > span").allTextContents();}}
    const confirm=scope.getByRole("button",{name:"Подтвердить этот порядок",exact:true});if(await confirm.count())await confirm.click();return;
  }
  for(const id of r.correctOptionIds)await scope.getByLabel(q.options.find(o=>o.id===id)!.textRu,{exact:true}).check();
}
test("J04-J06 organization assignment, real video resume, intermediate test, returned work and six-type final exam",async({browser})=>{
  test.setTimeout(720000);await mkdir(output,{recursive:true});
  const fixture=JSON.parse(readFileSync(process.env.DEMO_MVP_FIXTURE!,"utf8")) as {users:Record<string,User>;organizations:{a1:string};tenantId:string};
  const authored=JSON.parse(readFileSync(path.join(runtime,"authoring-result.json"),"utf8")) as {courseId:string;courseVersionId:string;content:CourseContent};
  const contexts=await Promise.all(Array.from({length:4},()=>browser.newContext({baseURL:process.env.DEMO_ORIGIN})));
  const [employer,admin,learner,teacher]=await Promise.all(contexts.map(c=>c.newPage()));
  const checkpoint=path.join(runtime,"learning-progress.json");
  let progress:any=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,"utf8")):{};
  if(progress.courseVersionId!==authored.courseVersionId)progress={courseId:authored.courseId,courseVersionId:authored.courseVersionId,stages:[]};
  const save=async(stage:string)=>{if(!progress.stages.includes(stage))progress.stages.push(stage);await writeFile(checkpoint,JSON.stringify(progress,null,2));console.log(JSON.stringify({stage,...{enrollmentId:progress.enrollmentId}}));};
  try{
    await login(employer,fixture.users.employer);await login(admin,fixture.users.admin);
    if(!progress.groupId){
      await employer.goto(`/lms/assign?customerId=${fixture.organizations.a1}&versionId=${authored.courseVersionId}`);
      await employer.getByRole("combobox",{name:/^Программа/}).selectOption(authored.courseVersionId);
      await employer.getByLabel("Найти сотрудника",{exact:true}).fill("Синтетический");
      await employer.getByLabel("Синтетический learner",{exact:true}).check();await employer.getByLabel("Синтетический combined",{exact:true}).check();
      await employer.getByText("Группа и сроки · по правилам программы",{exact:true}).click();
      progress.groupName=`Синтетическая сквозная группа ${Date.now()}`;
      await employer.getByLabel("Название группы · необязательно",{exact:true}).fill(progress.groupName);
      const response=employer.waitForResponse(r=>r.url().endsWith("/api/lms/enrollments")&&r.request().method()==="POST");
      await employer.getByRole("button",{name:"Назначить обучение · 2",exact:true}).click();
      const assigned=await body(await response);expect(assigned.errorCount).toBe(0);expect(assigned.created).toBe(2);progress.groupId=assigned.groupId;
      const group=await body(await admin.request.get(`/api/lms/groups/${progress.groupId}`));
      progress.enrollmentId=group.items.find((i:any)=>i.recipient.id===fixture.users.learner.recipientId).id;
      await employer.getByRole("link",{name:"Открыть группу",exact:true}).click();
      await employer.screenshot({path:path.join(output,"employer-group.png"),fullPage:true});await save("assignment-through-ui");
    }
    for(const [key,role]of [["teacher","TEACHER"],["expert","EXPERT"]]){
      if(progress.stages.includes(`binding-${role}`))continue;
      await admin.goto("/lms/learning-roles");
      await admin.getByRole("button",{name:"Назначить полномочия",exact:true}).click();
      const form=admin.locator("form").filter({has:admin.getByRole("heading",{name:"Назначить учебную роль",exact:true})});
      if(await form.getByRole("searchbox",{name:"Поиск пользователя",exact:true}).count())await form.getByRole("searchbox",{name:"Поиск пользователя",exact:true}).fill(fixture.users[key].email);
      await expect(form.locator(`select option[value="${fixture.users[key].id}"]`)).toHaveCount(1);
      await form.getByLabel(/^Пользователь/).selectOption(fixture.users[key].id);await form.getByLabel(/^Роль/).selectOption(role);
      if(await form.getByRole("searchbox",{name:"Поиск курса",exact:true}).count())await form.getByRole("searchbox",{name:"Поиск курса",exact:true}).fill(authored.content.titleRu);
      await expect(form.locator(`select option[value="${authored.courseId}"]`)).toHaveCount(1);await form.getByLabel(/^Курс/).selectOption(authored.courseId);
      if(await form.getByRole("searchbox",{name:"Поиск группы",exact:true}).count())await form.getByRole("searchbox",{name:"Поиск группы",exact:true}).fill(progress.groupName);
      await expect(form.locator(`select option[value="${progress.groupId}"]`)).toHaveCount(1);await form.getByLabel(/^Область группы/).selectOption(progress.groupId);
      const response=admin.waitForResponse(r=>r.url().endsWith("/api/lms/learning-bindings")&&r.request().method()==="POST");
      await form.getByRole("button",{name:"Назначить роль",exact:true}).click();const binding=await body(await response);expect(binding.groupId).toBe(progress.groupId);await save(`binding-${role}`);
    }
    await login(learner,fixture.users.learner);await login(teacher,fixture.users.teacher);
    const openLesson=async(id:string,title:string)=>{await learner.goto(`/learn/${progress.enrollmentId}`);await learner.getByRole("button",{name:"RU",exact:true}).click();await learner.locator(".lms-outline").getByRole("button",{name:new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))}).click();};
    const readLearning=async()=>body(await learner.request.get(`/api/learn/enrollments/${progress.enrollmentId}`));
    const lessons=authored.content.modules.flatMap(m=>m.lessons);
    for(const lesson of lessons){
      if(progress.stages.includes(`lesson-${lesson.id}`))continue;
      await openLesson(lesson.id,lesson.titleRu);
      if(["TEXT","PDF","FILE","LINK"].includes(lesson.kind)){
        if(lesson.kind==="PDF"){
          const href=await learner.getByRole("link",{name:"Открыть материал PDF",exact:true}).getAttribute("href");const file=await learner.request.get(href!);expect(file.ok()).toBe(true);expect((await file.body()).subarray(0,4).toString()).toBe("%PDF");
          const popupPromise=learner.waitForEvent("popup");await learner.getByRole("link",{name:"Открыть материал PDF",exact:true}).click();await(await popupPromise).close();
        }
        await learner.getByRole("button",{name:"Изучено, дальше",exact:true}).click();
      }else if(lesson.kind==="VIDEO"){
        const video=learner.locator("video");await expect(video).toBeVisible();await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
        await video.focus();await video.press("Space");await expect.poll(()=>video.evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(2.5);
        const saved=learner.waitForResponse(r=>r.url().endsWith(`/lessons/${lesson.id}/progress`)&&r.request().method()==="POST");await video.press("Space");await body(await saved);
        const position=await video.evaluate(v=>(v as HTMLVideoElement).currentTime);expect(position).toBeGreaterThan(2);
        await openLesson(lesson.id,lesson.titleRu);const resumed=learner.locator("video");await expect.poll(()=>resumed.evaluate(v=>(v as HTMLVideoElement).currentTime)).toBeGreaterThan(1.5);
        await resumed.focus();await resumed.press("Space");await expect.poll(()=>resumed.evaluate(v=>(v as HTMLVideoElement).ended),{timeout:20000}).toBe(true);
        progress.video={resume:true,positionSeconds:position,actualPlayback:true};
      }else if(lesson.kind==="ASSESSMENT"){
        await learner.getByRole("button",{name:"Начать тест",exact:true}).click();
        for(const q of (lesson as any).assessment.questions)await answer(learner.locator(".lms-question").filter({has:learner.locator("legend").filter({hasText:q.promptRu})}),q);
        await expect(learner.locator(".lms-exam-top [role=status]")).toHaveText("Ответы сохранены");
        const response=learner.waitForResponse(r=>/\/learn\/attempts\/[^/]+\/submit$/.test(r.url()));await learner.getByRole("button",{name:"Завершить попытку",exact:true}).click();const result=await body(await response);expect(result.state).toBe("FINISHED");
      }else if(lesson.kind==="ASSIGNMENT"){
        const readSubmission=async()=>body(await learner.request.get(`/api/lms/enrollments/${progress.enrollmentId}/assignments/${lesson.id}/submission`));
        async function submit(text:string){await learner.getByRole("textbox",{name:/^Ответ/}).fill(`${text} Правка ${Date.now()}.`);const response=learner.waitForResponse(r=>r.url().endsWith(`/assignments/${lesson.id}/submission/submit`)&&r.request().method()==="POST");await learner.getByRole("button",{name:"Отправить на проверку",exact:true}).click();await body(await response);await expect(learner.getByText("Работа отправлена. Ожидаем преподавателя.",{exact:true})).toBeVisible();return readSubmission();}
        async function review(id:string,decision:string,feedback:string){
          await teacher.goto("/lms/teaching");await teacher.getByRole("button",{name:"RU",exact:true}).click();await teacher.getByLabel(/^Работы/).selectOption("SUBMISSION");
          const queue=teacher.locator("section").filter({has:teacher.getByRole("heading",{name:"Очередь проверки",exact:true})});const row=queue.getByRole("listitem").filter({has:teacher.getByText("Синтетический learner",{exact:true})}).first();await row.getByRole("button",{name:"Открыть работу",exact:true}).click();
          const detail=teacher.locator("section[aria-busy]");await detail.getByLabel(/^Решение/).selectOption(decision);await detail.getByLabel("Обратная связь слушателю").fill(feedback);
          await teacher.getByRole("button",{name:"KZ",exact:true}).click();await expect(detail.getByLabel("Тыңдаушыға кері байланыс")).toHaveValue(feedback);await teacher.getByRole("button",{name:"RU",exact:true}).click();
          const response=teacher.waitForResponse(r=>r.url().endsWith(`/lms/reviews/SUBMISSION/${id}/decision`));await detail.getByRole("button",{name:decision==="RETURNED"?"Вернуть на доработку":"Принять работу",exact:true}).click();await body(await response);await expect(teacher.getByText("Решение сохранено",{exact:true})).toBeVisible();
        }
        let submission=await readSubmission();
        if(submission?.status!=="ACCEPTED"){
          if(submission?.status!=="SUBMITTED")submission=await submit("Синтетическая работа: изучил требования и выполнил безопасные действия.");
          await review(submission.id,"RETURNED","Дополните результат проверки.");await openLesson(lesson.id,lesson.titleRu);await expect(learner.getByText("Дополните результат проверки.",{exact:true}).first()).toBeVisible();
          await submit("Синтетическая работа дополнена: результат проверен по всем критериям.");await review(submission.id,"ACCEPTED","Синтетическая проверка: все критерии выполнены.");progress.returnAndResubmit=true;
        }
        await teacher.screenshot({path:path.join(output,"teacher-review.png"),fullPage:true});
      }
      await save(`lesson-${lesson.id}`);
    }
    await learner.goto(`/learn/${progress.enrollmentId}`);
    let final=await readLearning();
    if(!final.results.some((r:any)=>r.verdict==="PASSED")){
      if(!final.attempts.some((a:any)=>a.state==="IN_PROGRESS"))await learner.getByRole("button",{name:"Начать экзамен",exact:true}).click();
      await expect(learner.locator(".lms-question")).toHaveCount(6);
      for(const language of ["RU","KZ"]){await learner.getByRole("button",{name:language,exact:true}).click();for(const width of [360,390,768,1440]){await learner.setViewportSize({width,height:900});expect(await learner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await learner.screenshot({path:path.join(output,`exam-${language}-${width}.png`),fullPage:true});}}
      await learner.getByRole("button",{name:"RU",exact:true}).click();
      for(const q of authored.content.exam.questions)await answer(learner.locator(".lms-question").filter({has:learner.locator("legend").filter({hasText:q.promptRu})}),q);
      await expect(learner.locator(".lms-exam-top [role=status]")).toHaveText("Ответы сохранены");await learner.reload();await expect(learner.getByLabel("Ваш ответ")).toHaveValue("ключ");
      const response=learner.waitForResponse(r=>/\/learn\/attempts\/[^/]+\/submit$/.test(r.url()));await learner.getByRole("button",{name:"Завершить попытку",exact:true}).click();const submitted=await body(await response);expect(submitted.state).toBe("FINISHED");
      final=await readLearning();progress.attemptId=submitted.id;progress.answerReload=true;
    }
    const result=final.results.find((r:any)=>r.verdict==="PASSED");expect(result).toBeTruthy();expect(result.eligible,"The published center exam must produce a document-eligible result").toBe(true);progress.resultId=result.id;await save("final-exam-passed");
    await writeFile(path.join(runtime,"chain-result.json"),JSON.stringify(progress,null,2));await writeFile(path.join(output,"J04-J06-learning.json"),JSON.stringify({status:"PASS",synthetic:true,...progress},null,2));
  }finally{for(const context of contexts)await context.close();}
});
