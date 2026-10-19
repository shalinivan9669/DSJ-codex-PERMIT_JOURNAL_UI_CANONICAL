import { z } from "@demo/contracts";

export const reportKinds = [
  "TRAINING",
  "EMPLOYEES",
  "TESTING",
  "DOCUMENTS",
  "ORGANIZATIONS",
  "DEADLINES",
  "CREDENTIALS",
  "CERTIFICATES",
  "EMPLOYEE_DIRECTORY",
  "ORGANIZATION_DIRECTORY",
  "DOCUMENT_REGISTRY",
] as const;
export type ReportKind = (typeof reportKinds)[number];
export type ReportLanguage = "ru" | "kz";
export type ReportPayload = Record<string, string | number | null>;
export const reportMetrics = [
  "participants",
  "accounts",
  "organizations",
  "activeAssignments",
  "completedAssignments",
  "attempts",
  "passedAttempts",
  "issuedDocuments",
  "validDocuments",
  "expiringDocuments",
  "voidedDocuments",
  "supersededDocuments",
  "unknownValidity",
] as const;
export type ReportMetric = (typeof reportMetrics)[number];
export const reportQuerySchema = z
  .object({
    kind: z.enum(reportKinds).default("TRAINING"),
    filters: z.record(z.string(), z.unknown()).default({}),
    language: z.enum(["ru", "kz"]).default("ru"),
    metric: z.enum(reportMetrics).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export const reportCreateSchema = reportQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["PDF", "XLSX", "CSV"]),
    requestKey: z.string().uuid(),
  });
type Column = { field: string; ru: string; kz: string; width?: number };
const column = (
  field: string,
  ru: string,
  kz: string,
  width?: number,
): Column => ({ field, ru, kz, width });
const person = column("name", "Слушатель", "Тыңдаушы", 1.8);
const organization = column("organization", "Организация", "Ұйым", 1.7);
const course = column(
  "course",
  "Программа / версия",
  "Бағдарлама / нұсқа",
  1.8,
);
const status = column("status", "Состояние", "Күйі", 1.15);
const bin = column("bin", "БИН", "БСН", 1.1);
const documentColumns = [
  column("number", "Номер", "Нөмір"),
  person,
  organization,
  course,
  column("documentType", "Вид", "Түрі"),
  status,
  column("documentDate", "Дата документа", "Құжат күні"),
  column("validUntil", "Действует до", "Қолданылу мерзімі"),
];
export const reportDefinitions: Record<
  ReportKind,
  { ru: string; kz: string; columns: Column[]; rowRu: string; rowKz: string }
> = {
  DOCUMENT_REGISTRY: {
    ru: "Общий реестр документов",
    kz: "Құжаттардың жалпы тізілімі",
    rowRu:
      "Все оформленные документы: обучение и обычная печать. Период относится к дате документа; источники результатов различаются.",
    rowKz:
      "Барлық рәсімделген құжаттар: оқу және кәдімгі басып шығару. Кезең құжат күніне жатады; нәтиже дереккөздері ажыратылған.",
    columns: [column("origin", "Источник", "Дереккөз"), ...documentColumns],
  },
  EMPLOYEE_DIRECTORY: {
    ru: "Все сотрудники",
    kz: "Барлық қызметкерлер",
    rowRu:
      "Все доступные сотрудники, включая сотрудников без назначений. Период и учебные фильтры применяются к показателям обучения.",
    rowKz:
      "Тағайындауы жоқ адамдарды қоса барлық қолжетімді қызметкерлер. Кезең мен оқу сүзгілері оқу көрсеткіштеріне қолданылады.",
    columns: [
      person,
      organization,
      column("position", "Должность", "Лауазым"),
      column("assignments", "Назначений", "Тағайындаулар"),
      column("active", "Активных", "Белсенді"),
      column("completed", "Завершённых", "Аяқталған"),
      column("account", "Учебная учётная запись", "Оқу тіркелгісі"),
    ],
  },
  ORGANIZATION_DIRECTORY: {
    ru: "Все организации",
    kz: "Барлық ұйымдар",
    rowRu:
      "Все доступные организации, включая организации без обучения. Период и учебные фильтры применяются к показателям обучения.",
    rowKz:
      "Оқуы жоқ ұйымдарды қоса барлық қолжетімді ұйымдар. Кезең мен оқу сүзгілері оқу көрсеткіштеріне қолданылады.",
    columns: [
      organization,
      bin,
      column("city", "Подтверждённый город", "Расталған қала"),
      column("participants", "Участников", "Қатысушылар"),
      column("assignments", "Назначений", "Тағайындаулар"),
      column("active", "Активных", "Белсенді"),
      column("completed", "Завершённых", "Аяқталған"),
    ],
  },
  TRAINING: {
    ru: "Обучение",
    kz: "Оқыту",
    rowRu: "Одна строка — одно назначение программы",
    rowKz: "Бір жол — бағдарламаның бір тағайындауы",
    columns: [
      person,
      organization,
      course,
      column("assignedAt", "Назначено", "Тағайындалған"),
      status,
      column("completedAt", "Завершено", "Аяқталған"),
      column("result", "Текущий результат", "Ағымдағы нәтиже"),
      column("dueAt", "Доступ до", "Қолжетімділік мерзімі"),
    ],
  },
  EMPLOYEES: {
    ru: "Сотрудники",
    kz: "Қызметкерлер",
    rowRu:
      "Один человек в выбранных назначениях; связанные организации объединены, повторные назначения считаются отдельно",
    rowKz:
      "Таңдалған тағайындаулардағы бір адам; байланысты ұйымдар біріктірілген, қайталанған тағайындаулар бөлек саналады",
    columns: [
      person,
      organization,
      column("position", "Должность", "Лауазым"),
      column("assignments", "Назначений", "Тағайындаулар"),
      column("active", "Активных", "Белсенді"),
      column("completed", "Завершённых", "Аяқталған"),
      column("account", "Учебная учётная запись", "Оқу тіркелгісі"),
    ],
  },
  TESTING: {
    ru: "Тестирование",
    kz: "Тестілеу",
    rowRu:
      "Отправленная или завершённая попытка, включая повторные; содержание ответов не включается",
    rowKz:
      "Қайталанғанын қоса жіберілген немесе аяқталған талпыныс; жауаптар мазмұны қосылмайды",
    columns: [
      person,
      course,
      column("purpose", "Вид проверки", "Тексеру түрі"),
      column("ordinal", "Попытка", "Талпыныс"),
      column("eventAt", "Отправлено / завершено", "Жіберілген / аяқталған"),
      status,
      column("score", "Баллы", "Ұпай"),
      column("maximum", "Максимум", "Ең көп"),
      column("result", "Результат попытки", "Талпыныс нәтижесі"),
    ],
  },
  DOCUMENTS: {
    ru: "Документы",
    kz: "Құжаттар",
    rowRu:
      "Один документный маршрут результата; ожидание, выдача, отмена и замена отражаются отдельно",
    rowKz:
      "Нәтиженің бір құжат бағыты; күту, беру, күшін жою және ауыстыру бөлек көрсетіледі",
    columns: documentColumns,
  },
  ORGANIZATIONS: {
    ru: "Организации",
    kz: "Ұйымдар",
    rowRu:
      "Одна организация с доступными назначениями; физлица без организации отдельно",
    rowKz:
      "Қолжетімді тағайындаулары бар бір ұйым; ұйымсыз жеке тұлғалар бөлек",
    columns: [
      organization,
      bin,
      column("city", "Подтверждённый город", "Расталған қала"),
      column("participants", "Участников", "Қатысушылар"),
      column("assignments", "Назначений", "Тағайындаулар"),
      column("active", "Активных", "Белсенді"),
      column("completed", "Завершённых", "Аяқталған"),
    ],
  },
  DEADLINES: {
    ru: "Сроки",
    kz: "Мерзімдер",
    rowRu:
      "Срок доступа и подтверждённые сроки документа / следующей проверки — отдельные строки; неизвестное не означает бессрочность",
    rowKz:
      "Қолжетімділік пен құжаттың / келесі тексерудің расталған мерзімдері бөлек жолдарда; белгісіз мерзім шексіз емес",
    columns: [
      person,
      organization,
      course,
      column("deadlineKind", "Назначение срока", "Мерзім мақсаты"),
      column("deadline", "Дата", "Күні"),
      status,
      column("basis", "Источник срока", "Мерзім дереккөзі"),
    ],
  },
  CREDENTIALS: {
    ru: "Реестр удостоверений",
    kz: "Куәліктер тізілімі",
    rowRu:
      "Пронумерованное удостоверение из существующего выпуска, в том числе отменённое / заменённое",
    rowKz:
      "Қолданыстағы шығарылымның нөмірленген куәлігі, күшін жойған / ауыстырылғанын қоса",
    columns: documentColumns.filter((c) => c.field !== "documentType"),
  },
  CERTIFICATES: {
    ru: "Реестр сертификатов",
    kz: "Сертификаттар тізілімі",
    rowRu:
      "Пронумерованный сертификат из существующего выпуска, в том числе отменённый / заменённый",
    rowKz:
      "Қолданыстағы шығарылымның нөмірленген сертификаты, күшін жойған / ауыстырылғанын қоса",
    columns: documentColumns.filter((c) => c.field !== "documentType"),
  },
};
export const reportLabels: Record<string, [string, string]> = {
  LMS: ["Результат обучения", "Оқу нәтижесі"],
  PRINTING: ["Обычная печать", "Кәдімгі басып шығару"],
  ACTIVE: ["Обучается", "Оқып жатыр"],
  COMPLETED: ["Завершено", "Аяқталған"],
  CANCELLED: ["Отменено", "Тоқтатылған"],
  PASSED: ["Сдано", "Өтті"],
  FAILED: ["Не сдано", "Өтпеді"],
  VOIDED: ["Аннулирован", "Күші жойылған"],
  SUPERSEDED: ["Заменён", "Ауыстырылған"],
  ISSUED: ["Выдан", "Берілген"],
  VALID: ["Действует", "Жарамды"],
  EXPIRING: ["Истекает в течение 30 дней", "30 күн ішінде аяқталады"],
  EXPIRED: ["Срок истёк", "Мерзімі аяқталған"],
  UNKNOWN: ["Неизвестно", "Белгісіз"],
  UNKNOWN_VALIDITY: ["Срок действия неизвестен", "Қолданылу мерзімі белгісіз"],
  AWAITING_APPROVAL: ["Ожидает согласования", "Келісу күтілуде"],
  AWAITING_SIGNATURE: ["Ожидает подписи", "Қол қою күтілуде"],
  RENDERING: ["Файлы готовятся", "Файлдар дайындалуда"],
  PREPARED: ["Подготовлен", "Дайындалған"],
  NEEDS_REVIEW: ["Нужна проверка", "Тексеру қажет"],
  SUBMITTED: ["На проверке", "Тексерілуде"],
  FINISHED: ["Завершено", "Аяқталған"],
  FINAL: ["Итоговый экзамен", "Қорытынды емтихан"],
  LEARNING_FINAL: ["Учебное завершение", "Оқуды аяқтау"],
  INTERMEDIATE: ["Промежуточная проверка", "Аралық тексеру"],
  CERTIFICATE: ["Сертификат", "Сертификат"],
  CREDENTIAL: ["Удостоверение", "Куәлік"],
  PROTOCOL: ["Протокол", "Хаттама"],
  ACCESS: ["Доступ к обучению", "Оқуға қолжетімділік"],
  DOCUMENT: ["Действие документа", "Құжаттың қолданылуы"],
  NEXT_CHECK: ["Следующая проверка", "Келесі тексеру"],
  CONNECTED: ["Связана", "Байланыстырылған"],
  NOT_CONNECTED: ["Не связана", "Байланыстырылмаған"],
  NOT_STARTED: ["Результата нет", "Нәтиже жоқ"],
  KNOWN: ["Срок известен", "Мерзімі белгілі"],
};
const translatedFields = new Set([
  "status",
  "result",
  "documentType",
  "purpose",
  "deadlineKind",
  "account",
  "origin",
]);
export function reportCell(
  row: ReportPayload,
  field: string,
  language: ReportLanguage,
): string {
  const value = row[field];
  if (value === null || value === undefined || value === "")
    return language === "kz" ? "Белгісіз" : "Неизвестно";
  return translatedFields.has(field) && reportLabels[String(value)]
    ? reportLabels[String(value)][language === "kz" ? 1 : 0]
    : String(value);
}
export function reportColumns(kind: ReportKind, language: ReportLanguage) {
  return reportDefinitions[kind].columns.map((c) => ({
    field: c.field,
    title: c[language],
    width: c.width || 1,
  }));
}
