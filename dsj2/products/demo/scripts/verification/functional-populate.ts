/** Reusable original content pack for one explicitly guarded, synthetic local installation.
 * All business mutations use product services. No progress, passing scores, documents,
 * signatures or external receipts are inserted. Clean-start acceptance uses UI separately.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Response } from "express";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  consentVersion,
} from "../../packages/contracts/src";
import { db, type Context, type DemoRequest } from "../../apps/api/src/core";
import {
  bootstrapSuperAdmin,
  saveUser,
  saveCustomer,
  saveProfile,
} from "../../apps/api/src/settings";
import { saveRecipient } from "../../apps/api/src/recipients";
import {
  createCourse,
  updateVersion,
  publishVersion,
} from "../../apps/api/src/lms/courses";
import { uploadMaterial } from "../../apps/api/src/lms/materials";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { createTeachingBinding } from "../../apps/api/src/lms/teaching-bindings";
import { createTeachingEvent } from "../../apps/api/src/lms/teaching-events";
import {
  createLearnerInvite,
  exchangeLearnerInvite,
} from "../../apps/api/src/lms/identity";
import {
  createEmployerInvite,
  exchangeEmployerInvite,
} from "../../apps/api/src/employer-invites";
import { curriculum, questionsFor } from "./functional-curriculum";

const url = new URL(process.env.DATABASE_URL || "");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55489" ||
  url.pathname !== "/demo_test_functional_20261019_run01_browser"
)
  throw new Error("SYNTHETIC_BROWSER_DATABASE_REQUIRED");
const runtime = resolve(".runtime/functional-completion-20261019/run-01");
const statePath = join(runtime, "populated.private.json");
let state: Record<string, any> = {};
const save = () => writeFile(statePath, JSON.stringify(state, null, 2));
const credential = () => `Demo-${randomBytes(18).toString("base64url")}!`;
const mockResponse = {
  cookie() {
    return this;
  },
  setHeader() {
    return this;
  },
} as unknown as Response;
function syntheticRequest(index: string): DemoRequest {
  return {
    ip: `synthetic-content-${index}`,
    correlationId: `synthetic-content-${randomUUID()}`,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as DemoRequest;
}
async function material(
  c: Context,
  courseId: string,
  name: string,
  mimetype: string,
) {
  const source = join(runtime, "content", name),
    temp = join(runtime, "content", `${randomUUID()}-${name}`);
  await copyFile(source, temp);
  return uploadMaterial(c, courseId, {
    path: temp,
    originalname: name,
    mimetype,
    size: (await stat(temp)).size,
  } as Express.Multer.File);
}
function extraQuestions() {
  const base = {
    version: 1,
    category: "БиОТ",
    topic: "Передача и контроль",
    source: "Авторский разбор / 19.10.2026",
    correctOptionIds: [],
    multiple: false,
  };
  const option = (id: string, textRu: string, textKz: string) => ({
    id,
    textRu,
    textKz,
  });
  return [
    {
      ...base,
      id: "biot-multiple",
      promptRu:
        "Какие сведения позволяют продолжить работу с сообщением? Выберите все подходящие.",
      promptKz:
        "Хабарлама бойынша жұмысты жалғастыруға қандай мәліметтер көмектеседі? Барлығын таңдаңыз.",
      options: [
        option("a", "Точное место и наблюдение", "Нақты орын және бақылау"),
        option("b", "Принятые безопасные меры", "Қабылданған қауіпсіз шаралар"),
        option(
          "c",
          "Непроверенная оценка виновника",
          "Кінәлі туралы тексерілмеген баға",
        ),
      ],
      multiple: true,
      correctOptionIds: ["a", "b"],
      answerSpec: { kind: "MULTIPLE", correctOptionIds: ["a", "b"] },
    },
    {
      ...base,
      id: "biot-matching",
      promptRu: "Соотнесите элемент записи с его назначением.",
      promptKz: "Жазба элементін оның мақсатымен сәйкестендіріңіз.",
      options: [
        option("fact", "Факт", "Факт"),
        option("owner", "Ответственный", "Жауапты тұлға"),
        option("evidence", "Подтверждение", "Растау"),
      ],
      answerSpec: {
        kind: "MATCHING",
        pairs: [
          { leftId: "fact", rightId: "what" },
          { leftId: "owner", rightId: "who" },
          { leftId: "evidence", rightId: "result" },
        ],
        rightOptions: [
          option("what", "Что наблюдали", "Не байқалды"),
          option("who", "Кто принимает решение", "Кім шешім қабылдайды"),
          option("result", "Чем проверен результат", "Нәтиже немен тексерілді"),
        ],
      },
    },
    {
      ...base,
      id: "biot-ordering",
      promptRu: "Расположите этапы работы с обычным замечанием по порядку.",
      promptKz: "Қалыпты ескерту бойынша жұмыс кезеңдерін реттеңіз.",
      options: [
        option("observe", "Зафиксировать наблюдение", "Бақылауды тіркеу"),
        option(
          "assign",
          "Назначить безопасное действие и ответственного",
          "Қауіпсіз әрекет пен жауаптыны белгілеу",
        ),
        option(
          "verify",
          "Проверить фактический результат",
          "Нақты нәтижені тексеру",
        ),
      ],
      answerSpec: {
        kind: "ORDERING",
        correctOrderIds: ["observe", "assign", "verify"],
      },
    },
    {
      ...base,
      id: "biot-text",
      promptRu:
        "Как называется то, что вы непосредственно наблюдали? Одно слово.",
      promptKz: "Тікелей байқаған нәрсе қалай аталады? Бір сөз.",
      options: [],
      answerSpec: {
        kind: "TEXT",
        mode: "EXACT",
        acceptedAnswers: ["факт"],
        caseSensitive: false,
        collapseWhitespace: true,
      },
    },
    {
      ...base,
      id: "biot-case",
      promptRu: "Какой следующий шаг допустим в описанной ситуации?",
      promptKz: "Сипатталған жағдайда келесі қандай қадам орынды?",
      options: [
        option(
          "a",
          "Передать точное описание ответственному по местной процедуре",
          "Жергілікті рәсіммен нақты сипаттаманы жауаптыға беру",
        ),
        option(
          "b",
          "Самому разобрать неизвестное оборудование",
          "Белгісіз жабдықты өз бетімен бөлшектеу",
        ),
      ],
      correctOptionIds: ["a"],
      answerSpec: {
        kind: "CASE",
        contextRu:
          "Во время обычного обхода вы заметили повреждение корпуса незнакомого оборудования. У вас нет допуска к ремонту.",
        contextKz:
          "Жоспарлы тексеруде таныс емес жабдық корпусының зақымын байқадыңыз. Жөндеуге рұқсатыңыз жоқ.",
        response: { kind: "SINGLE", correctOptionIds: ["a"] },
      },
    },
    {
      ...base,
      id: "biot-manual",
      promptRu:
        "Напишите передачу смене по незавершённой задаче: проход временно ограничен, решение ещё не проверено.",
      promptKz:
        "Аяқталмаған тапсырма бойынша ауысымға хабарлама жазыңыз: жол уақытша шектелген, шешім тексерілмеген.",
      options: [],
      answerSpec: {
        kind: "TEXT",
        mode: "MANUAL",
        criteriaRu:
          "Названы место, текущее состояние, ограничение, ответственный и следующий контроль. Нет вымышленных выполненных действий.",
        criteriaKz:
          "Орын, қазіргі күй, шектеу, жауапты тұлға және келесі бақылау аталған. Ойдан шығарылған орындалған әрекет жоқ.",
      },
    },
  ];
}
async function main() {
  state = JSON.parse(await readFile(statePath, "utf8").catch(() => "{}"));
  const actual = await db.$queryRaw<
    Array<{ name: string; port: number }>
  >`SELECT current_database() AS name, inet_server_port() AS port`;
  if (actual[0]?.name !== url.pathname.slice(1) || actual[0]?.port !== 55489)
    throw new Error("ACTUAL_DATABASE_IDENTITY_MISMATCH");
  await mkdir(runtime, { recursive: true });
  const original = JSON.parse(
    await readFile(join(runtime, "browser-director.private.json"), "utf8"),
  );
  let actor = await db.user.findUniqueOrThrow({
    where: { email: original.email },
  });
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: actor.tenantId },
  });
  if (!tenant.demoOnly) throw new Error("DEMONSTRATION_TENANT_REQUIRED");
  let c: Context = {
    tenantId: actor.tenantId,
    userId: actor.id,
    role: actor.role,
    sessionId: "synthetic-content-population",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  if (actor.role !== "SUPER_ADMIN") {
    await bootstrapSuperAdmin(c, {
      currentPassword: original.password,
      confirm: true,
    });
    actor = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    c = { ...c, role: actor.role };
  }
  state.syntheticOnly = true;
  state.tenantId = tenant.id;
  state.origin = "http://127.0.0.1:3349";
  state.users ||= {};
  state.users.superAdmin = {
    id: actor.id,
    email: actor.email,
    password: original.password,
    role: actor.role,
  };
  await save();
  const names: Record<string, string> = {
    admin: "Администратор",
    director: "Директор",
    operator: "Оператор",
    teacher: "Преподаватель",
    methodist: "Методист",
    expert: "Эксперт",
    viewer: "Наблюдатель",
  };
  for (const [key, label] of Object.entries(names)) {
    if (state.users[key]) continue;
    const password = credential(),
      email = `${key}@functional.example.test`,
      role = key.toUpperCase();
    const user = await saveUser(c, {
      email,
      displayName: `Учебный ${label.toLowerCase()}`,
      role,
      password,
    });
    state.users[key] = { id: user.id, email, password, role };
    await save();
  }
  if (!state.profileId) {
    const profile = await saveProfile(c, {
      nameRu: "Учебный центр «Практика DEMO»",
      nameKz: "«Практика DEMO» оқу орталығы",
      addressRu: "Учебная площадка",
      addressKz: "Оқу алаңы",
      cityRu: "Кызылорда",
      cityKz: "Қызылорда",
      approvalBasis: "Учебный пример настройки центра, 19.10.2026",
      headName: "Учебный директор",
      commission: [
        { name: "Учебный председатель", position: "Председатель" },
        { name: "Учебный преподаватель", position: "Член комиссии" },
      ],
      people: [
        {
          name: "Учебный преподаватель",
          position: "Преподаватель",
          role: "TEACHER",
        },
      ],
      approved: true,
    });
    state.profileId = profile.id;
    await save();
  }
  state.organizations ||= [];
  for (const index of [0, 1])
    if (!state.organizations[index]) {
      const label = index === 0 ? "Север" : "Юг";
      const organization = await saveCustomer(c, {
        nameRu: `Учебная организация «${label}»`,
        nameKz: index === 0 ? "«Солтүстік» оқу ұйымы" : "«Оңтүстік» оқу ұйымы",
        addressRu: "Демонстрационная площадка",
        addressKz: "Демонстрациялық алаң",
        city: "Кызылорда",
      });
      state.organizations[index] = organization;
      await save();
    }
  state.courses ||= {};
  for (const source of curriculum) {
    if (state.courses[source.key]?.published) continue;
    const questions = [
      ...questionsFor(source.key),
      ...(source.key === "biot" ? extraQuestions() : []),
    ];
    const content = courseContentSchema.parse({
      titleRu: `Учебный пример — ${source.titleRu}`,
      titleKz: `Оқу мысалы — ${source.titleKz}`,
      descriptionRu:
        source.goalRu +
        " Авторский материал для демонстрации обучения; параметры не устанавливают обязательные нормативы.",
      descriptionKz:
        source.goalKz +
        " Оқуды көрсетуге арналған авторлық материал; параметрлер міндетті нормативтерді белгілемейді.",
      category: source.category,
      hours: source.key === "biot" ? 2 : 1,
      accessDays: 90,
      learningOutcome: "REGULATED",
      metadata: {
        goalRu: source.goalRu,
        goalKz: source.goalKz,
        audienceRu: "Участники учебного разбора",
        audienceKz: "Оқу талдауына қатысушылар",
        format: "ONLINE",
        documentValidity: "Учебная информационная карточка",
        trainingRecurrence: "Определяется ответственным центром",
        parameterSource:
          "Авторский демонстрационный сценарий от 19.10.2026, не нормативная программа",
        updatedOn: "2026-10-19",
      },
      modules: [
        {
          id: `${source.key}-foundation`,
          titleRu: "Наблюдение и безопасные действия",
          titleKz: "Бақылау және қауіпсіз әрекеттер",
          lessons: source.lessons.slice(0, 2).map((l, i) => ({
            id: `${source.key}-text-${i + 1}`,
            kind: "TEXT",
            titleRu: l.ru,
            titleKz: l.kz,
            textRu: l.ruText,
            textKz: l.kzText,
            required: true,
          })),
        },
        {
          id: `${source.key}-application`,
          titleRu: "Применение и проверка результата",
          titleKz: "Қолдану және нәтижені тексеру",
          lessons: source.lessons.slice(2).map((l, i) => ({
            id: `${source.key}-text-${i + 3}`,
            kind: "TEXT",
            titleRu: l.ru,
            titleKz: l.kz,
            textRu: l.ruText,
            textKz: l.kzText,
            required: true,
          })),
        },
      ],
      exam: {
        questions,
        questionCount: source.key === "biot" ? 10 : 8,
        durationMinutes: 20,
        maxAttempts: 3,
        thresholdPercent: 80,
        comparison: source.key === "hygiene" ? "GT" : "GTE",
        revealAnswers: false,
      },
    });
    const profile = regulatoryProfileSchema.parse({
      title: `Учебный маршрут ${source.category}`,
      status: "CONFIRMED",
      synthetic: true,
      category: source.category,
      competency: source.key === "hygiene" ? "HYGIENE" : "OTHER",
      sources: [
        {
          ...source.source,
          revision:
            "Карточка проверена 19.10.2026; применимость редакции требует проверки",
          status: "REVIEW_REQUIRED",
        },
      ],
      effectiveFrom: "2026-10-19",
      reviewReference:
        "Технический учебный маршрут автономной демонстрационной установки; не юридическое подтверждение",
      assessmentKind: "CENTER_EXAM",
      examiner: "Учебный преподаватель DEMO",
      issuer: "Учебный центр «Практика DEMO»",
      commissionKind: "CENTER",
      commission: [
        { name: "Учебный председатель", role: "Председатель" },
        { name: "Учебный преподаватель", role: "Член комиссии" },
      ],
      requiresApproval: true,
      requiresEmployeeSignature: false,
      legalForm: "INFORMATION_CARD",
      documentTypes: ["PROTOCOL", "CERTIFICATE"],
      sanitary: source.key === "hygiene",
      destination: "NOT_CONNECTED",
    });
    let entry = state.courses[source.key];
    if (!entry) {
      const created = await createCourse(c, { content, profile });
      entry = { id: created.course.id, versionId: created.version.id };
      state.courses[source.key] = entry;
      await save();
    }
    entry.materials ||= {};
    if (!entry.materials.pdf) {
      entry.materials.pdf = await material(
        c,
        entry.id,
        `${source.key}-guide.pdf`,
        "application/pdf",
      );
      await save();
    }
    content.modules[1].lessons.push({
      id: `${source.key}-guide`,
      titleRu: "Памятка для разбора и сохранения",
      titleKz: "Талдау және сақтау жадынамасы",
      kind: "PDF",
      materialId: entry.materials.pdf.id,
      required: true,
      prerequisiteLessonIds: [],
      textRu: "",
      textKz: "",
      durationSeconds: null,
    });
    if (source.key === "biot") {
      for (const [key, name, mime] of [
        ["video", "biot-observation.mp4", "video/mp4"],
        ["ru", "biot-ru.vtt", "text/vtt"],
        ["kk", "biot-kk.vtt", "text/vtt"],
      ])
        if (!entry.materials[key]) {
          entry.materials[key] = await material(c, entry.id, name, mime);
          await save();
        }
      content.modules[0].lessons.push({
        id: "biot-video",
        titleRu: "От наблюдения до подтверждённого результата · 3 минуты",
        titleKz: "Бақылаудан расталған нәтижеге дейін · 3 минут",
        kind: "VIDEO",
        materialId: entry.materials.video.id,
        required: true,
        prerequisiteLessonIds: [],
        textRu:
          "Учебный разбор без звука. Включите русские или казахские субтитры.",
        textKz:
          "Дыбыссыз оқу талдауы. Орысша немесе қазақша субтитрді қосыңыз.",
        durationSeconds: 180,
        videoPolicy: {
          minimumPercent: 85,
          allowSeekAhead: false,
          playbackRates: [1, 1.25, 1.5],
        },
        subtitles: [
          {
            materialId: entry.materials.ru.id,
            language: "ru",
            label: "Русский",
          },
          {
            materialId: entry.materials.kk.id,
            language: "kk",
            label: "Қазақша",
          },
        ],
      });
      content.modules[1].lessons.push({
        id: "biot-checkpoint",
        titleRu: "Промежуточная самопроверка",
        titleKz: "Аралық өзін-өзі тексеру",
        kind: "ASSESSMENT",
        required: true,
        prerequisiteLessonIds: [],
        textRu: "",
        textKz: "",
        materialId: null,
        durationSeconds: null,
        assessment: {
          questions: content.exam.questions.slice(0, 5),
          questionCount: 5,
          durationMinutes: 10,
          maxAttempts: 5,
          thresholdPercent: 80,
          comparison: "GTE",
          revealAnswers: true,
        },
      });
      content.modules[1].lessons.push({
        id: "biot-task",
        titleRu: "Практическая работа: сообщение и передача смены",
        titleKz: "Практикалық жұмыс: хабарлама және ауысымды тапсыру",
        kind: "ASSIGNMENT",
        required: true,
        prerequisiteLessonIds: [],
        textRu: "",
        textKz: "",
        materialId: null,
        durationSeconds: null,
        assignment: {
          instructionsRu:
            "Учебная ситуация: коробки находятся у выхода, проход временно ограничен. Составьте сообщение ответственному и передачу следующей смене. Не утверждайте, что опасность устранена.",
          instructionsKz:
            "Оқу жағдайы: қораптар шығу есігінің жанында, жол уақытша шектелген. Жауапты тұлғаға хабарлама және келесі ауысымға тапсыру мәтінін құрыңыз. Қауіп жойылды деп жазбаңыз.",
          criteriaRu:
            "Точное место; наблюдаемый факт; временная мера; ответственный; следующий контроль. Нет вымышленных результатов.",
          criteriaKz:
            "Нақты орын; бақыланған факт; уақытша шара; жауапты тұлға; келесі бақылау. Ойдан шығарылған нәтиже жоқ.",
          allowText: true,
          allowFiles: true,
          maxSubmissions: 3,
        },
      });
    }
    const version = await db.courseVersion.findUniqueOrThrow({
      where: { id: entry.versionId },
    });
    if (version.status !== "PUBLISHED") {
      const saved = await updateVersion(c, version.id, {
        revision: version.revision,
        content,
        profile,
      });
      await publishVersion(c, version.id, { revision: saved.revision });
    }
    for (const key of ["teacher", "methodist", "expert"])
      if (
        !(await db.lmsTeachingBinding.findFirst({
          where: {
            tenantId: c.tenantId,
            courseId: entry.id,
            userId: state.users[key].id,
            revokedAt: null,
          },
        }))
      )
        await createTeachingBinding(c, {
          courseId: entry.id,
          userId: state.users[key].id,
          role: key.toUpperCase(),
        });
    entry.published = true;
    entry.titleRu = content.titleRu;
    entry.questionCount = questions.length;
    await save();
    console.log(
      JSON.stringify({ published: source.key, questions: questions.length }),
    );
  }
  state.learners ||= [];
  for (let index = 0; index < 16; index++) {
    const number = String(index + 1).padStart(2, "0"),
      org = state.organizations[index < 8 ? 0 : 1];
    let learner = state.learners[index];
    if (!learner) {
      const recipient = await saveRecipient(c, {
        id: randomUUID(),
        fullNameRu: `Учебный слушатель ${number}`,
        fullNameKz: `Оқу тыңдаушысы ${number}`,
        positionRu: "Участник обучения",
        positionKz: "Оқу қатысушысы",
        workplaceRu: org.nameRu,
        workplaceKz: org.nameKz,
        employerId: org.id,
        personnelNumber: `DEMO-${number}`,
      });
      learner = {
        recipientId: recipient.id,
        email: `learner${number}@functional.example.test`,
        password: credential(),
        customerId: org.id,
        course: index < 8 ? "biot" : index < 12 ? "ptm" : "hygiene",
      };
      state.learners[index] = learner;
      await save();
    }
    if (!learner.enrollmentId) {
      const result = await assignEnrollments(c, {
        courseVersionId: state.courses[learner.course].versionId,
        recipientIds: [learner.recipientId],
        customerId: org.id,
        operationId: randomUUID(),
      });
      learner.enrollmentId = result.items[0].id;
      await save();
    }
    if (!learner.userId) {
      const existing = await db.user.findUnique({
        where: { email: learner.email },
      });
      if (!existing) {
        const invitation = await createLearnerInvite(c, {
          recipientId: learner.recipientId,
          email: learner.email,
          customerId: org.id,
        });
        await exchangeLearnerInvite(syntheticRequest(number), mockResponse, {
          token: invitation.token,
          password: learner.password,
          consentVersion,
          consent: true,
        });
      }
      learner.userId = (
        await db.user.findUniqueOrThrow({ where: { email: learner.email } })
      ).id;
      await save();
    }
  }
  for (const index of [0, 1]) {
    const key = `employer${index + 1}`;
    if (state.users[key]) continue;
    const email = `employer${index + 1}@functional.example.test`,
      password = credential();
    const invitation = await createEmployerInvite(c, {
      customerId: state.organizations[index].id,
      email,
      displayName: `Учебный представитель ${index + 1}`,
      permissions: ["READ", "DOWNLOAD", "ASSIGN_TRAINING", "PROPOSE"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      accessExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    });
    await exchangeEmployerInvite(
      syntheticRequest(`employer${index}`),
      mockResponse,
      { token: invitation.inviteUrl.split("#")[1], password },
    );
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    state.users[key] = { id: user.id, email, password, role: "EMPLOYER" };
    await save();
  }
  state.groups ||= {};
  for (const [key, course, from, to, orgIndex] of [
    ["north", "ptm", 0, 8, 0],
    ["south", "biot", 8, 16, 1],
  ] as const) {
    if (!state.groups[key]) {
      const assigned = await assignEnrollments(c, {
        courseVersionId: state.courses[course].versionId,
        recipientIds: state.learners
          .slice(from, to)
          .map((l: any) => l.recipientId),
        customerId: state.organizations[orgIndex].id,
        groupName:
          key === "north"
            ? "Учебная группа «Север»: готовность к эвакуации"
            : "Учебная группа «Юг»: безопасная передача смены",
        operationId: randomUUID(),
      });
      const e = await db.enrollment.findUniqueOrThrow({
        where: { id: assigned.items[0].id },
      });
      state.groups[key] = {
        id: e.groupId,
        enrollmentIds: assigned.items.map((x: any) => x.id),
      };
      await save();
    }
    if (!state.groups[key].eventId) {
      const event = await createTeachingEvent(c, {
        groupId: state.groups[key].id,
        titleRu: "Совместный разбор учебной ситуации",
        titleKz: "Оқу жағдайын бірлесіп талдау",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        timezone: "Asia/Qyzylorda",
        teacherUserId: state.users.teacher.id,
        location: "Учебная аудитория DEMO",
        operationId: randomUUID(),
      });
      state.groups[key].eventId = event.id;
      await save();
    }
  }
  state.completedAt = new Date().toISOString();
  await save();
  const evidence = resolve(
    "docs/evidence/functional-completion-20261019/run-01",
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "CONTENT_CATALOG.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        createdBy:
          "Product domain actions in isolated demonstration installation",
        doesNotAssert:
          "No inserted passing exam, signature, document issuance or external receipt; simulated account consent belongs only to synthetic identities",
        tenantId: state.tenantId,
        staffRoles: Object.values(state.users).map((u: any) => u.role),
        organizations: state.organizations.map((o: any) => ({
          id: o.id,
          nameRu: o.nameRu,
        })),
        courses: Object.values(state.courses).map((c: any) => ({
          id: c.id,
          versionId: c.versionId,
          titleRu: c.titleRu,
          questionCount: c.questionCount,
          materials: Object.values(c.materials).map((m: any) => ({
            id: m.id,
            name: m.originalName,
            bytes: m.size,
          })),
        })),
        learners: state.learners.map((l: any) => ({
          recipientId: l.recipientId,
          course: l.course,
          enrollmentId: l.enrollmentId,
        })),
        completedAt: state.completedAt,
      },
      null,
      2,
    ),
  );
  console.log("POPULATED_DEMONSTRATION_READY");
}
void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
