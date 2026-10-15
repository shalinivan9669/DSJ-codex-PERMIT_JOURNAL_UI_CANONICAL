"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type LmsLesson,
  type LmsQuestion,
  type RegulatoryProfile,
} from "@demo/contracts/src/lms";
import {
  ApiError,
  api,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import { AutosaveLane } from "@/lib/autosave";
import { lms, type CourseVersion } from "@/lib/lms-api";
import { LmsHeading, Status, lmsError, type Translate } from "./common";
import { useLmsSaveNavigation } from "./use-save-navigation";
import type { CalendarVersion } from "./sanitary-settings";

export const emptyCourse = () =>
  courseContentSchema.parse({
    titleRu: "Новый курс",
    titleKz: "Жаңа курс",
    modules: [],
    exam: { questions: [], questionCount: 1 },
  });
export const emptyProfile = (issuer = "") =>
  regulatoryProfileSchema.parse({ title: "Новое основание", issuer });
type Draft = { content: CourseContent; profile: RegulatoryProfile };
export function CourseEditor({ id, t }: { id: string; t: Translate }) {
  const [version, setVersion] = useState<CourseVersion | null>(null);
  const [versions, setVersions] = useState<CourseVersion[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [calendars, setCalendars] = useState<CalendarVersion[]>([]);
  const lane = useRef<AutosaveLane<Draft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = useRef(t);
  text.current = t;
  useLmsSaveNavigation(
    id,
    () => !!lane.current?.dirty,
    () => lane.current?.flush() || Promise.resolve(),
    (caught) => setError(lmsError(caught, text.current)),
  );
  function install(value: CourseVersion) {
    const next = { content: value.content, profile: value.profile };
    setVersion(value);
    setDraft(next);
    setError("");
    setConflict(false);
    setSaveState("saved");
    lane.current = new AutosaveLane(
      next,
      value.revision,
      async (snapshot, revision) => {
        try {
          return await lms.saveVersion(
            value.id,
            revision,
            snapshot.content,
            snapshot.profile,
          );
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) {
            lane.current?.pause(caught);
            setConflict(true);
          }
          throw caught;
        }
      },
      (state, revision, caught) => {
        setSaveState(state);
        setVersion((current) => (current ? { ...current, revision } : current));
        if (caught) setError(lmsError(caught, text.current));
        else if (state === "saved") setError("");
      },
    );
  }
  async function load() {
    try {
      const data = await lms.course(id);
      setVersions(data.versions);
      const latest =
        data.versions.find((v) => v.status === "DRAFT") || data.versions[0];
      if (latest) install(latest);
    } catch (caught) {
      setError(lmsError(caught, text.current));
    }
  }
  useEffect(() => {
    void load();
    void api<CalendarVersion[]>("/lms/sanitary/calendars")
      .then(setCalendars)
      .catch(() => {});
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (lane.current?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const logout = (event: Event) => {
      (
        event as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>
      ).detail.waitUntil(
        lane.current?.flush().catch(() => {
          throw new NavigationBlockedError();
        }) || Promise.resolve(),
      );
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, logout);
    };
  }, []);
  function edit(next: Draft) {
    setDraft(next);
    lane.current?.edit(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => void lane.current?.flush().catch(() => {}),
      600,
    );
  }
  async function businessAction(kind: "publish" | "new") {
    if (!version || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "publish") {
        const revision = await lane.current!.flush();
        install(await lms.publish(version.id, revision));
      } else install(await lms.newVersion(id));
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  if (!draft || !version)
    return (
      <section aria-busy={!error}>
        {error ? (
          <Notice>
            {error}
            <button onClick={() => void load()}>
              {t("Повторить", "Қайталау")}
            </button>
          </Notice>
        ) : (
          t("Открываем курс…", "Курс ашылуда…")
        )}
      </section>
    );
  const frozen = version.status !== "DRAFT";
  const content = draft.content;
  const profile = draft.profile;
  const contentEdit = (patch: Partial<CourseContent>) =>
    edit({
      ...draft,
      content: { ...content, ...patch },
      profile:
        patch.category !== undefined
          ? { ...profile, category: patch.category }
          : profile,
    });
  const profileEdit = (patch: Partial<RegulatoryProfile>) =>
    edit({ ...draft, profile: { ...profile, ...patch } });
  function lessonEdit(
    moduleId: string,
    lessonId: string,
    patch: Partial<LmsLesson>,
  ) {
    contentEdit({
      modules: content.modules.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              lessons: m.lessons.map((l) =>
                l.id === lessonId ? { ...l, ...patch } : l,
              ),
            }
          : m,
      ),
    });
  }
  function questionEdit(questionId: string, patch: Partial<LmsQuestion>) {
    contentEdit({
      exam: {
        ...content.exam,
        questions: content.exam.questions.map((q) =>
          q.id === questionId ? { ...q, ...patch } : q,
        ),
      },
    });
  }
  return (
    <>
      <LmsHeading title={t(content.titleRu, content.titleKz)}>
        <Link className="button" href="/lms">
          {t("К курсам", "Курстарға")}
        </Link>
      </LmsHeading>
      <div className="lms-editor-actions">
        <span>
          <Status value={version.status} t={t} /> · {t("Версия", "Нұсқа")}{" "}
          {version.version}
        </span>
        <span className="lms-save-state" role="status">
          {frozen
            ? ""
            : saveState === "saved"
              ? t("Сохранено", "Сақталды")
              : saveState === "saving" || saveState === "dirty"
                ? t("Сохраняем…", "Сақталуда…")
                : t("Не сохранено", "Сақталмады")}
        </span>
      </div>
      {error && (
        <Notice>
          {error}
          <button
            onClick={() =>
              conflict
                ? void load()
                : void lane.current?.flush().catch(() => {})
            }
          >
            {conflict
              ? t("Открыть актуальную редакцию", "Соңғы нұсқаны ашу")
              : t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
        onBlur={() => {
          if (lane.current?.dirty && !lane.current.paused)
            void lane.current.flush().catch(() => {});
        }}
      >
        <legend>{t("Программа", "Бағдарлама")}</legend>
        <div className="lms-fields">
          <label>
            {t("Название RU", "Атауы RU")}
            <input
              value={content.titleRu}
              onChange={(e) => contentEdit({ titleRu: e.target.value })}
            />
          </label>
          <label>
            {t("Название KZ", "Атауы KZ")}
            <input
              value={content.titleKz}
              onChange={(e) => contentEdit({ titleKz: e.target.value })}
            />
          </label>
          <label>
            {t("Описание RU", "Сипаттама RU")}
            <textarea
              value={content.descriptionRu}
              onChange={(e) => contentEdit({ descriptionRu: e.target.value })}
            />
          </label>
          <label>
            {t("Описание KZ", "Сипаттама KZ")}
            <textarea
              value={content.descriptionKz}
              onChange={(e) => contentEdit({ descriptionKz: e.target.value })}
            />
          </label>
          <label>
            {t("Категория слушателей", "Тыңдаушылар санаты")}
            <input
              value={content.category}
              onChange={(e) => contentEdit({ category: e.target.value })}
            />
          </label>
          <div className="lms-fields">
            <label>
              {t("Часы", "Сағат")}
              <input
                type="number"
                min={0}
                max={10000}
                value={content.hours}
                onChange={(e) => contentEdit({ hours: Number(e.target.value) })}
              />
            </label>
            <label>
              {t("Доступ, дней", "Қолжетімділік, күн")}
              <input
                type="number"
                min={1}
                max={3650}
                value={content.accessDays}
                onChange={(e) =>
                  contentEdit({ accessDays: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
        <details>
          <summary>
            {t("Основание и оформление", "Негіз және рәсімдеу")}
          </summary>
          <div className="lms-fields">
            <label>
              {t("Название основания", "Негіздің атауы")}
              <input
                value={profile.title}
                onChange={(e) => profileEdit({ title: e.target.value })}
              />
            </label>
            <label>
              {t("Проверка основания", "Негізді тексеру")}
              <select
                value={profile.status}
                onChange={(e) =>
                  profileEdit({
                    status: e.target.value as RegulatoryProfile["status"],
                  })
                }
              >
                <option value="NEEDS_LEGAL_REVIEW">
                  {t("Нужна правовая проверка", "Құқықтық тексеру қажет")}
                </option>
                <option value="DRAFT">{t("Черновик", "Жоба")}</option>
                <option value="CONFIRMED">
                  {t("Проверено", "Тексерілген")}
                </option>
              </select>
            </label>
            <label>
              {t("Компетенции", "Құзыреттер")}
              <select
                value={profile.competency}
                onChange={(e) =>
                  profileEdit({
                    competency: e.target
                      .value as RegulatoryProfile["competency"],
                  })
                }
              >
                <option value="OTHER">{t("Иные", "Өзге")}</option>
                <option value="GENERAL">{t("Общие", "Жалпы")}</option>
                <option value="SPECIAL">{t("Специальные", "Арнайы")}</option>
                <option value="HYGIENE">
                  {t("Гигиенические", "Гигиеналық")}
                </option>
              </select>
            </label>
            <label>
              {t("Оценка", "Бағалау")}
              <select
                value={profile.assessmentKind}
                onChange={(e) =>
                  profileEdit({
                    assessmentKind: e.target
                      .value as RegulatoryProfile["assessmentKind"],
                  })
                }
              >
                <option value="PRACTICE">
                  {t("Учебный тест", "Жаттығу тесті")}
                </option>
                <option value="CENTER_EXAM">
                  {t("Экзамен центра", "Орталық емтиханы")}
                </option>
                <option value="EXTERNAL_AUTHORIZED">
                  {t("Внешний экзамен", "Сыртқы емтихан")}
                </option>
              </select>
            </label>
            <label>
              {t("Действует с", "Басталуы")}
              <input
                type="date"
                value={profile.effectiveFrom || ""}
                onChange={(e) =>
                  profileEdit({ effectiveFrom: e.target.value || null })
                }
              />
            </label>
            <label>
              {t("Действует до", "Аяқталуы")}
              <input
                type="date"
                value={profile.effectiveUntil || ""}
                onChange={(e) =>
                  profileEdit({ effectiveUntil: e.target.value || null })
                }
              />
            </label>
            <label>
              {t("Основание проверки", "Тексеру негізі")}
              <input
                value={profile.reviewReference}
                onChange={(e) =>
                  profileEdit({ reviewReference: e.target.value })
                }
              />
            </label>
            <label>
              {t("Уполномоченный экзаменатор", "Уәкілетті емтихан алушы")}
              <input
                value={profile.examiner}
                onChange={(e) => profileEdit({ examiner: e.target.value })}
              />
            </label>
            <label>
              {t("Эмитент документа", "Құжатты беруші")}
              <input
                value={profile.issuer}
                onChange={(e) => profileEdit({ issuer: e.target.value })}
              />
            </label>
            <label>
              {t("Вид документа", "Құжат түрі")}
              <select
                value={profile.legalForm}
                onChange={(e) =>
                  profileEdit({
                    legalForm: e.target.value as RegulatoryProfile["legalForm"],
                  })
                }
              >
                <option value="INFORMATION_CARD">
                  {t("Информационная карточка", "Ақпараттық карточка")}
                </option>
                <option value="PAPER_ORIGINAL">
                  {t("Бумажный оригинал", "Қағаз түпнұсқа")}
                </option>
                <option value="ELECTRONIC_ORIGINAL">
                  {t("Электронный оригинал", "Электрондық түпнұсқа")}
                </option>
                <option value="COPY_OF_ORIGINAL">
                  {t("Копия оригинала", "Түпнұсқа көшірмесі")}
                </option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("Комплект документов", "Құжаттар жинағы")}</legend>
            {(
              [
                ["PROTOCOL", "Протокол", "Хаттама"],
                ["CERTIFICATE", "Сертификат", "Сертификат"],
                ["CREDENTIAL", "Удостоверение", "Куәлік"],
              ] as const
            ).map(([kind, ru, kz]) => (
              <label className="lms-inline-label" key={kind}>
                <input
                  type="checkbox"
                  checked={profile.documentTypes.includes(kind)}
                  onChange={(e) =>
                    profileEdit({
                      documentTypes: e.target.checked
                        ? [...profile.documentTypes, kind]
                        : profile.documentTypes.filter(
                            (value) => value !== kind,
                          ),
                    })
                  }
                />
                {t(ru, kz)}
              </label>
            ))}
          </fieldset>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={profile.synthetic}
              onChange={(e) => profileEdit({ synthetic: e.target.checked })}
            />
            {t(
              "Синтетическая учебная программа",
              "Синтетикалық оқу бағдарламасы",
            )}
          </label>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={profile.sanitary}
              onChange={(e) => profileEdit({ sanitary: e.target.checked })}
            />
            {t("Санитарное обучение", "Санитариялық оқыту")}
          </label>
          {profile.sanitary && (
            <div className="lms-fields">
              <label>
                {t("Производственный календарь", "Өндірістік күнтізбе")}
                <select
                  value={profile.calendarVersionId || ""}
                  onChange={(event) => {
                    const calendar = calendars.find(
                      (value) => value.id === event.target.value,
                    );
                    profileEdit({
                      calendarVersionId: event.target.value || null,
                      ...(calendar ? { timezone: calendar.timezone } : {}),
                    });
                  }}
                >
                  <option value="">
                    {t("Выберите календарь", "Күнтізбені таңдаңыз")}
                  </option>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name} · {t("версия", "нұсқа")}{" "}
                      {calendar.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(
                  "Время окончания рабочего дня",
                  "Жұмыс күнінің аяқталу уақыты",
                )}
                <input
                  type="time"
                  value={profile.cutoff}
                  onChange={(event) =>
                    profileEdit({ cutoff: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="lms-fields">
            {(
              [
                ["requiresApproval", "Требуется согласование", "Келісу қажет"],
                ["requiresPractice", "Требуется практика", "Практика қажет"],
                [
                  "requiresProctoring",
                  "Требуется прокторинг",
                  "Прокторинг қажет",
                ],
                [
                  "requiresEmployeeSignature",
                  "Требуется подпись слушателя",
                  "Тыңдаушы қол қоюы қажет",
                ],
              ] as const
            ).map(([key, ru, kz]) => (
              <label key={key} className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={profile[key]}
                  onChange={(e) => profileEdit({ [key]: e.target.checked })}
                />
                {t(ru, kz)}
              </label>
            ))}
          </div>
          <label>
            {t("Комиссия", "Комиссия")}
            <select
              value={profile.commissionKind}
              onChange={(e) =>
                profileEdit({
                  commissionKind: e.target
                    .value as RegulatoryProfile["commissionKind"],
                })
              }
            >
              <option value="NONE">
                {t(
                  "Не требуется по основанию",
                  "Негіз бойынша талап етілмейді",
                )}
              </option>
              <option value="CENTER">
                {t("Учебного центра", "Оқу орталығының")}
              </option>
              <option value="EMPLOYER">
                {t("Работодателя", "Жұмыс берушінің")}
              </option>
              <option value="EXTERNAL">{t("Внешняя", "Сыртқы")}</option>
            </select>
          </label>
          {profile.commission.map((person, i) => (
            <div className="lms-fields" key={i}>
              <label>
                {t("ФИО члена комиссии", "Комиссия мүшесінің аты-жөні")}
                <input
                  value={person.name}
                  onChange={(e) =>
                    profileEdit({
                      commission: profile.commission.map((p, n) =>
                        n === i ? { ...p, name: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("Роль в комиссии", "Комиссиядағы рөлі")}
                <input
                  value={person.role}
                  onChange={(e) =>
                    profileEdit({
                      commission: profile.commission.map((p, n) =>
                        n === i ? { ...p, role: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              profileEdit({
                commission: [...profile.commission, { name: "", role: "" }],
              })
            }
          >
            {t("Добавить члена комиссии", "Комиссия мүшесін қосу")}
          </button>
          <label>
            {t(
              "Обязательные подписанты — по одному на строку",
              "Міндетті қол қоюшылар — әр жолға біреу",
            )}
            <textarea
              value={profile.requiredSignatures.join("\n")}
              onChange={(e) =>
                profileEdit({
                  requiredSignatures: e.target.value
                    .split("\n")
                    .filter(Boolean),
                })
              }
            />
          </label>
          {profile.sources.map((source, i) => (
            <fieldset key={i}>
              <legend>
                {t("Источник", "Дереккөз")} {i + 1}
              </legend>
              <label>
                {t("Название", "Атауы")}
                <input
                  value={source.title}
                  onChange={(e) =>
                    profileEdit({
                      sources: profile.sources.map((s, n) =>
                        n === i ? { ...s, title: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <div className="lms-fields">
                <label>
                  {t("Ссылка", "Сілтеме")}
                  <input
                    type="url"
                    value={source.url}
                    onChange={(e) =>
                      profileEdit({
                        sources: profile.sources.map((s, n) =>
                          n === i ? { ...s, url: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {t("Редакция", "Редакция")}
                  <input
                    value={source.revision}
                    onChange={(e) =>
                      profileEdit({
                        sources: profile.sources.map((s, n) =>
                          n === i ? { ...s, revision: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              profileEdit({
                sources: [
                  ...profile.sources,
                  { title: "", url: "", revision: "" },
                ],
              })
            }
          >
            {t("Добавить источник", "Дереккөз қосу")}
          </button>
        </details>
      </fieldset>
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
      >
        <legend>{t("Модули и уроки", "Модульдер мен сабақтар")}</legend>
        {content.modules.map((module, index) => (
          <details key={module.id} open={content.modules.length === 1}>
            <summary>
              {module.titleRu || t("Новый модуль", "Жаңа модуль")} ·{" "}
              {module.lessons.length}
            </summary>
            <div className="lms-fields">
              <label>
                {t("Модуль RU", "Модуль RU")}
                <input
                  value={module.titleRu}
                  onChange={(e) =>
                    contentEdit({
                      modules: content.modules.map((m) =>
                        m.id === module.id
                          ? { ...m, titleRu: e.target.value }
                          : m,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("Модуль KZ", "Модуль KZ")}
                <input
                  value={module.titleKz}
                  onChange={(e) =>
                    contentEdit({
                      modules: content.modules.map((m) =>
                        m.id === module.id
                          ? { ...m, titleKz: e.target.value }
                          : m,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {module.lessons.map((lesson, lessonIndex) => (
              <fieldset key={lesson.id}>
                <legend>
                  {t("Урок", "Сабақ")} {lessonIndex + 1}
                </legend>
                <div className="lms-fields">
                  <label>
                    {t("Урок RU", "Сабақ RU")}
                    <input
                      value={lesson.titleRu}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          titleRu: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Урок KZ", "Сабақ KZ")}
                    <input
                      value={lesson.titleKz}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          titleKz: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Материал", "Материал")}
                    <select
                      value={lesson.kind}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          kind: e.target.value as LmsLesson["kind"],
                        })
                      }
                    >
                      <option value="TEXT">{t("Текст", "Мәтін")}</option>
                      <option value="PDF">PDF</option>
                      <option value="VIDEO">{t("Видео", "Бейне")}</option>
                    </select>
                  </label>
                  <label className="lms-inline-label">
                    <input
                      type="checkbox"
                      checked={lesson.required}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          required: e.target.checked,
                        })
                      }
                    />
                    {t("Обязательный урок", "Міндетті сабақ")}
                  </label>
                  <label>
                    {t("Текст RU", "Мәтін RU")}
                    <textarea
                      rows={5}
                      value={lesson.textRu}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          textRu: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Текст KZ", "Мәтін KZ")}
                    <textarea
                      rows={5}
                      value={lesson.textKz}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          textKz: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                {lesson.kind !== "TEXT" && (
                  <label>
                    {lesson.materialId
                      ? t("Заменить файл", "Файлды ауыстыру")
                      : t("Файл урока", "Сабақ файлы")}
                    <input
                      type="file"
                      accept={
                        lesson.kind === "VIDEO"
                          ? "video/mp4,video/webm"
                          : "application/pdf"
                      }
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusy(true);
                        try {
                          const material = await lms.uploadMaterial(id, file);
                          lessonEdit(module.id, lesson.id, {
                            materialId: material.id,
                          });
                        } catch (caught) {
                          setError(lmsError(caught, t));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>
                )}
                {lesson.kind === "VIDEO" && (
                  <label>
                    {t("Длительность, секунд", "Ұзақтығы, секунд")}
                    <input
                      type="number"
                      min={1}
                      value={lesson.durationSeconds || ""}
                      onChange={(e) =>
                        lessonEdit(module.id, lesson.id, {
                          durationSeconds: Number(e.target.value) || null,
                        })
                      }
                    />
                  </label>
                )}
                <details>
                  <summary>
                    {t(
                      "Предыдущие обязательные уроки",
                      "Алдыңғы міндетті сабақтар",
                    )}
                  </summary>
                  {content.modules
                    .flatMap((value) => value.lessons)
                    .filter((value) => value.id !== lesson.id)
                    .map((previous) => (
                      <label className="lms-inline-label" key={previous.id}>
                        <input
                          type="checkbox"
                          checked={lesson.prerequisiteLessonIds.includes(
                            previous.id,
                          )}
                          onChange={(event) =>
                            lessonEdit(module.id, lesson.id, {
                              prerequisiteLessonIds: event.target.checked
                                ? [...lesson.prerequisiteLessonIds, previous.id]
                                : lesson.prerequisiteLessonIds.filter(
                                    (value) => value !== previous.id,
                                  ),
                            })
                          }
                        />
                        {t(
                          previous.titleRu,
                          previous.titleKz || previous.titleRu,
                        )}
                      </label>
                    ))}
                </details>
                <div className="lms-actions">
                  <button
                    type="button"
                    disabled={lessonIndex === 0}
                    onClick={() => {
                      const lessons = [...module.lessons];
                      [lessons[lessonIndex - 1], lessons[lessonIndex]] = [
                        lessons[lessonIndex]!,
                        lessons[lessonIndex - 1]!,
                      ];
                      contentEdit({
                        modules: content.modules.map((m) =>
                          m.id === module.id ? { ...m, lessons } : m,
                        ),
                      });
                    }}
                  >
                    {t("Выше", "Жоғары")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      contentEdit({
                        modules: content.modules.map((m) =>
                          m.id === module.id
                            ? {
                                ...m,
                                lessons: m.lessons.filter(
                                  (l) => l.id !== lesson.id,
                                ),
                              }
                            : m,
                        ),
                      })
                    }
                  >
                    {t("Убрать урок", "Сабақты алып тастау")}
                  </button>
                </div>
              </fieldset>
            ))}
            <div className="lms-actions">
              <button
                type="button"
                onClick={() =>
                  contentEdit({
                    modules: content.modules.map((m) =>
                      m.id === module.id
                        ? {
                            ...m,
                            lessons: [
                              ...m.lessons,
                              {
                                id: crypto.randomUUID(),
                                titleRu: "",
                                titleKz: "",
                                kind: "TEXT",
                                textRu: "",
                                textKz: "",
                                materialId: null,
                                durationSeconds: null,
                                required: true,
                                prerequisiteLessonIds: [],
                              },
                            ],
                          }
                        : m,
                    ),
                  })
                }
              >
                {t("Добавить урок", "Сабақ қосу")}
              </button>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  const modules = [...content.modules];
                  [modules[index - 1], modules[index]] = [
                    modules[index]!,
                    modules[index - 1]!,
                  ];
                  contentEdit({ modules });
                }}
              >
                {t("Модуль выше", "Модульді жоғары")}
              </button>
            </div>
          </details>
        ))}
        <button
          type="button"
          onClick={() =>
            contentEdit({
              modules: [
                ...content.modules,
                {
                  id: crypto.randomUUID(),
                  titleRu: "",
                  titleKz: "",
                  lessons: [],
                },
              ],
            })
          }
        >
          {t("Добавить модуль", "Модуль қосу")}
        </button>
      </fieldset>
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
      >
        <legend>{t("Вопросы и оценка", "Сұрақтар мен бағалау")}</legend>
        <details>
          <summary>{t("Параметры теста", "Тест параметрлері")}</summary>
          <div className="lms-fields">
            {(
              [
                [
                  "questionCount",
                  "Вопросов в попытке",
                  "Талпыныстағы сұрақтар",
                ],
                ["durationMinutes", "Время, минут", "Уақыт, минут"],
                ["maxAttempts", "Попыток", "Талпыныстар"],
                ["thresholdPercent", "Порог, %", "Шекті мән, %"],
              ] as const
            ).map(([key, ru, kz]) => (
              <label key={key}>
                {t(ru, kz)}
                <input
                  type="number"
                  min={key === "thresholdPercent" ? 0 : 1}
                  value={content.exam[key]}
                  onChange={(e) =>
                    contentEdit({
                      exam: { ...content.exam, [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
            <label>
              {t("Правило порога", "Шекті мән ережесі")}
              <select
                value={content.exam.comparison}
                onChange={(e) =>
                  contentEdit({
                    exam: {
                      ...content.exam,
                      comparison: e.target.value as "GT" | "GTE",
                    },
                  })
                }
              >
                <option value="GTE">
                  {t("Не менее порога", "Шекті мәннен кем емес")}
                </option>
                <option value="GT">
                  {t("Строго больше порога", "Шекті мәннен жоғары")}
                </option>
              </select>
            </label>
          </div>
        </details>
        {content.exam.questions.map((q, i) => (
          <details key={q.id}>
            <summary>
              {i + 1}. {q.promptRu || t("Новый вопрос", "Жаңа сұрақ")}
            </summary>
            <div className="lms-fields">
              <label>
                {t("Вопрос RU", "Сұрақ RU")}
                <textarea
                  value={q.promptRu}
                  onChange={(e) =>
                    questionEdit(q.id, { promptRu: e.target.value })
                  }
                />
              </label>
              <label>
                {t("Вопрос KZ", "Сұрақ KZ")}
                <textarea
                  value={q.promptKz}
                  onChange={(e) =>
                    questionEdit(q.id, { promptKz: e.target.value })
                  }
                />
              </label>
              <label>
                {t("Тема", "Тақырып")}
                <input
                  value={q.category}
                  onChange={(e) =>
                    questionEdit(q.id, { category: e.target.value })
                  }
                />
              </label>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={q.multiple}
                  onChange={(e) =>
                    questionEdit(q.id, {
                      multiple: e.target.checked,
                      correctOptionIds: e.target.checked
                        ? q.correctOptionIds
                        : q.correctOptionIds.slice(0, 1),
                    })
                  }
                />
                {t("Несколько правильных ответов", "Бірнеше дұрыс жауап")}
              </label>
            </div>
            {q.options.map((option, n) => (
              <fieldset key={option.id}>
                <legend>
                  {t("Ответ", "Жауап")} {n + 1}
                </legend>
                <div className="lms-fields">
                  <label>
                    RU
                    <input
                      value={option.textRu}
                      onChange={(e) =>
                        questionEdit(q.id, {
                          options: q.options.map((o) =>
                            o.id === option.id
                              ? { ...o, textRu: e.target.value }
                              : o,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    KZ
                    <input
                      value={option.textKz}
                      onChange={(e) =>
                        questionEdit(q.id, {
                          options: q.options.map((o) =>
                            o.id === option.id
                              ? { ...o, textKz: e.target.value }
                              : o,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <label className="lms-inline-label">
                  <input
                    type="checkbox"
                    checked={q.correctOptionIds.includes(option.id)}
                    onChange={(e) =>
                      questionEdit(q.id, {
                        correctOptionIds: e.target.checked
                          ? q.multiple
                            ? [...q.correctOptionIds, option.id]
                            : [option.id]
                          : q.correctOptionIds.filter((v) => v !== option.id),
                      })
                    }
                  />
                  {t("Правильный ответ", "Дұрыс жауап")}
                </label>
              </fieldset>
            ))}
            <div className="lms-actions">
              <button
                type="button"
                onClick={() =>
                  questionEdit(q.id, {
                    options: [
                      ...q.options,
                      { id: crypto.randomUUID(), textRu: "", textKz: "" },
                    ],
                  })
                }
              >
                {t("Добавить ответ", "Жауап қосу")}
              </button>
              <button
                type="button"
                onClick={() =>
                  contentEdit({
                    exam: {
                      ...content.exam,
                      questions: content.exam.questions.filter(
                        (v) => v.id !== q.id,
                      ),
                    },
                  })
                }
              >
                {t("Убрать вопрос", "Сұрақты алып тастау")}
              </button>
            </div>
          </details>
        ))}
        <button
          type="button"
          onClick={() => {
            const first = crypto.randomUUID();
            contentEdit({
              exam: {
                ...content.exam,
                questions: [
                  ...content.exam.questions,
                  {
                    id: crypto.randomUUID(),
                    version: 1,
                    category: "",
                    promptRu: "",
                    promptKz: "",
                    multiple: false,
                    options: [
                      { id: first, textRu: "", textKz: "" },
                      { id: crypto.randomUUID(), textRu: "", textKz: "" },
                    ],
                    correctOptionIds: [first],
                  },
                ],
              },
            });
          }}
        >
          {t("Добавить вопрос", "Сұрақ қосу")}
        </button>
      </fieldset>
      <div className="lms-editor-actions">
        <button
          className="primary lms-primary"
          disabled={busy || conflict}
          onClick={() => void businessAction(frozen ? "new" : "publish")}
        >
          {busy
            ? t("Подождите…", "Күтіңіз…")
            : frozen
              ? t("Создать новую версию", "Жаңа нұсқа жасау")
              : t("Опубликовать", "Жариялау")}
        </button>
        {versions.length > 1 && (
          <details>
            <summary>{t("История версий", "Нұсқалар тарихы")}</summary>
            {versions.map((v) => (
              <p key={v.id}>
                {v.version} · <Status value={v.status} t={t} />
              </p>
            ))}
          </details>
        )}
      </div>
    </>
  );
}
