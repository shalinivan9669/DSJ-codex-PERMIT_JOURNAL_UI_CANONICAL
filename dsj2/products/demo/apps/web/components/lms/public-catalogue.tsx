"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import type { Enrollment, Paged } from "@/lib/lms-api";
import type { AppContext } from "@/lib/types";
import {
  applications,
  type ApplicationDefaults,
  type PublicProgramme,
} from "@/lib/lms-applications";
import {
  LmsHeading,
  PageControls,
  LanguageSwitch,
  useLanguage,
  type Translate,
} from "./common";
import "./lms.css";
import { applicationError } from "./application-errors";

const emptyForm = {
  organization: "",
  bin: "",
  contactName: "",
  phone: "",
  email: "",
  position: "",
  quantity: 1,
  comment: "",
  customerId: "",
};
export function PublicCatalogue({ context }: { context?: AppContext | null }) {
  const { t, language, setLanguage } = useLanguage(
    context ? `${context.tenant.id}:${context.user.id}` : "public",
  );
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const [data, setData] = useState<{
    centerName: string;
    items: PublicProgramme[];
    total: number;
    pageSize: number;
  } | null>(null);
  const [selected, setSelected] = useState<PublicProgramme | null>(null);
  const [existingEnrollment, setExistingEnrollment] = useState<Enrollment | null>(null);
  const [checkingEnrollment, setCheckingEnrollment] = useState(false);
  const [selectionMissing, setSelectionMissing] = useState(false);
  const [defaults, setDefaults] = useState<ApplicationDefaults | null>(null);
  const [form, setForm] = useState(emptyForm),
    [business, setBusiness] = useState(context?.user.role === "EMPLOYER");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<{
    id: string;
    centerName: string;
  } | null>(null);
  const key = useRef("");
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (context?.user.role === "EMPLOYER") setBusiness(true);
  }, [context?.user.id, context?.user.role]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void applications
        .catalogue(page, search, !!context)
        .then((v) => {
          if (!alive) return;
          setData(v);
          setError(null);
          const choice = new URLSearchParams(window.location.search).get("courseVersionId") || sessionStorage.getItem("lms:course-choice");
          if (choice) {
            const item = v.items.find((p) => p.courseVersionId === choice);
            if (item) setSelected(item);
            else
              void applications
                .catalogue(1, "", !!context, choice)
                .then((found) => {
                  if (alive) {
                    setSelected(found.items[0] || null);
                    setSelectionMissing(!found.items.length);
                  }
                })
                .catch((caught) => {
                  if (alive) {
                    setError(caught);
                  }
                });
          }
        })
        .catch((e) => {
          if (alive) { setError(e); setData(null); }
        }).finally(() => { if (alive) setLoading(false); });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, search, refresh, context?.user.id]);
  useEffect(() => {
    if (!context || !["LEARNER", "EMPLOYER"].includes(context.user.role))
      return;
    let alive = true;
    void applications
      .defaults()
      .then((value) => {
        if (!alive) return;
        setDefaults(value);
        setForm((old) => {
          const org =
            value.organizations.length === 1 ? value.organizations[0] : null;
          return {
            ...old,
            contactName: value.contactName,
            email: value.email,
            ...(org
              ? { customerId: org.id, organization: org.nameRu, bin: org.bin }
              : {}),
          };
        });
      })
      .catch(setError);
    return () => {
      alive = false;
    };
  }, [context?.user.id]);
  useEffect(() => {
    setExistingEnrollment(null);
    if (context?.user.role !== "LEARNER" || !selected) return;
    let alive = true;
    setCheckingEnrollment(true);
    const query = `/learn/enrollments?courseId=${encodeURIComponent(selected.id)}&page=1&pageSize=1`;
    void Promise.all([
      api<Paged<Enrollment>>(`${query}&status=ACTIVE`),
      api<Paged<Enrollment>>(`${query}&status=COMPLETED`),
    ]).then(([active, completed]) => {
      if (alive) setExistingEnrollment(active.items[0] || completed.items[0] || null);
    }).catch((caught) => { if (alive) setError(caught); })
      .finally(() => { if (alive) setCheckingEnrollment(false); });
    return () => { alive = false; };
  }, [context?.user.id, selected?.id, refresh]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function choose(programme: PublicProgramme) {
    setSelected(programme);
    setReceipt(null);
    setError(null);
    setSelectionMissing(false);
    window.history.replaceState(window.history.state, "", `/catalogue?courseVersionId=${encodeURIComponent(programme.courseVersionId)}`);
    sessionStorage.setItem("lms:course-choice", programme.courseVersionId);
    const storageKey = `lms:application:${context?.user.id || "anonymous"}:${programme.courseVersionId}`;
    key.current = sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, key.current);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    const storageKey = `lms:application:${context?.user.id || "anonymous"}:${selected.courseVersionId}`;
    key.current ||= sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, key.current);
    try {
      const result = await applications.submit(
        {
          kind: business ? "B2B" : "B2C",
          courseVersionId: selected.courseVersionId,
          idempotencyKey: key.current,
          ...(business
            ? { ...form, customerId: form.customerId || undefined }
            : { comment: form.comment, quantity: 1 }),
        },
        !context,
      );
      setReceipt(result);
      sessionStorage.removeItem("lms:course-choice");
      window.history.replaceState(window.history.state, "", "/catalogue");
      sessionStorage.removeItem(storageKey);
      key.current = "";
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const isApplicant =
    !context || ["LEARNER", "EMPLOYER"].includes(context.user.role);
  const returnTo = selected ? `/catalogue?courseVersionId=${encodeURIComponent(selected.courseVersionId)}` : "/catalogue";
  return (
    <div className="lms-workspace" lang={language === "kz" ? "kk" : "ru"}>
      <div className="lms-toolbar">
        <strong>{data?.centerName || "DEMO"}</strong>
        <LanguageSwitch language={language} onChange={setLanguage} />
        {context && (
          <Link
            href={
              context.user.role === "LEARNER"
                ? "/learn/applications"
                : "/lms/applications"
            }
          >
            {t("Мои заявки", "Менің өтінімдерім")}
          </Link>
        )}
      </div>
      <LmsHeading title={t("Программы обучения", "Оқу бағдарламалары")} />
      {selectionMissing && <Notice>{t("Набор на выбранную программу закрыт. Выберите доступную программу или откройте свои заявки.", "Таңдалған бағдарламаға қабылдау жабық. Қолжетімді бағдарламаны таңдаңыз немесе өтінімдеріңізді ашыңыз.")}</Notice>}
      {!!error && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice>
            {applicationError(error, t)}{" "}
            <button onClick={() => setRefresh((n) => n + 1)}>
              {t("Обновить программы", "Бағдарламаларды жаңарту")}
            </button>
          </Notice>
        </div>
      )}
      {receipt ? (
        <section className="panel lms-panel" role="status">
          <h2>{t("Заявка сохранена", "Өтінім сақталды")}</h2>
          <p>
            {receipt.centerName}
          </p>
          <p>
            {t(
              "Центр рассмотрит заявку. Зачисление ещё не подтверждено.",
              "Орталық өтінімді қарайды. Оқуға қабылдау әлі расталған жоқ.",
            )}
          </p>
          {context && (
            <Link
              className="button primary"
              href={
                context.user.role === "LEARNER"
                  ? `/learn/applications?applicationId=${encodeURIComponent(receipt.id)}`
                  : `/lms/applications?applicationId=${encodeURIComponent(receipt.id)}`
              }
            >
              {t("Состояние заявки", "Өтінім күйі")}
            </Link>
          )}
          <button
            onClick={() => {
              setReceipt(null);
              setSelected(null);
              key.current = "";
            }}
          >
            {t("К программам", "Бағдарламаларға")}
          </button>
        </section>
      ) : selected ? (
        <section className="panel lms-panel">
          <LmsHeading title={t(selected.titleRu, selected.titleKz)}>
            <button
              onClick={() => {
                setSelected(null);
                sessionStorage.removeItem("lms:course-choice");
                window.history.replaceState(window.history.state, "", "/catalogue");
              }}
            >
              {t("К списку", "Тізімге")}
            </button>
          </LmsHeading>
          <p>{t(selected.summaryRu, selected.summaryKz)}</p>
          <p>
            {selected.hours} {t("часов", "сағат")}
            {selected.durationDays && <> · {t("Продолжительность", "Ұзақтығы")}: {selected.durationDays} {t("дней", "күн")}</>}
          </p>
          {existingEnrollment && !business ? (
            <div>
              <p>{existingEnrollment.status === "COMPLETED" ? t("Вы уже завершили эту программу.", "Сіз бұл бағдарламаны аяқтадыңыз.") : t("Обучение уже назначено вам.", "Оқу сізге тағайындалған.")}</p>
              <Link className="button primary lms-primary" href={`/learn/${encodeURIComponent(existingEnrollment.id)}`}>{existingEnrollment.status === "COMPLETED" ? t("Результат и документы", "Нәтиже және құжаттар") : t("Продолжить обучение", "Оқуды жалғастыру")}</Link>
            </div>
          ) : isApplicant && (
            <>
              <div className="lms-toolbar">
                {context?.user.role !== "EMPLOYER" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={business}
                      onChange={(e) => setBusiness(e.target.checked)}
                    />{" "}
                    {t("Заявка организации", "Ұйым өтінімі")}
                  </label>
                )}
              </div>
              {!context && !business ? (
                <div>
                  <Link className="button primary" href={`/learn/register?returnTo=${encodeURIComponent(returnTo)}`}>
                    {t("Записаться", "Жазылу")}
                  </Link>{" "}
                  <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>{t("Войти", "Кіру")}</Link>
                </div>
              ) : (
                <form onSubmit={submit}>
                  {business && (
                    <div className="lms-grid">
                      {defaults?.organizations.length ? (
                        <label>
                          {t("Организация", "Ұйым")}
                          <select
                            value={form.customerId}
                            onChange={(e) => {
                              const org = defaults.organizations.find(
                                (o) => o.id === e.target.value,
                              );
                              setForm((old) => ({
                                ...old,
                                customerId: org?.id || "",
                                organization: org?.nameRu || "",
                                bin: org?.bin || "",
                              }));
                            }}
                          >
                            <option value="">
                              {t("Выберите организацию", "Ұйымды таңдаңыз")}
                            </option>
                            {defaults.organizations.map((org) => (
                              <option key={org.id} value={org.id}>
                                {t(org.nameRu, org.nameKz)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <TextField
                          label={t("Организация", "Ұйым")}
                          value={form.organization}
                          set={(v) =>
                            setForm((f) => ({ ...f, organization: v }))
                          }
                          required
                        />
                      )}
                      <TextField
                        label={t("БИН", "БСН")}
                        value={form.bin}
                        set={(v) => setForm((f) => ({ ...f, bin: v }))}
                        required={!form.customerId}
                        readOnly={!!form.customerId}
                        maxLength={12}
                        pattern="[0-9]{12}"
                      />
                      <TextField
                        label={t("Контактное лицо", "Байланыс тұлғасы")}
                        value={form.contactName}
                        set={(v) => setForm((f) => ({ ...f, contactName: v }))}
                        required
                        readOnly={!!defaults}
                      />
                      <TextField
                        label={t("Телефон", "Телефон")}
                        value={form.phone}
                        set={(v) => setForm((f) => ({ ...f, phone: v }))}
                        required
                        type="tel"
                      />
                      <TextField
                        label={t("Электронная почта", "Электрондық пошта")}
                        value={form.email}
                        set={(v) => setForm((f) => ({ ...f, email: v }))}
                        required
                        readOnly={!!defaults}
                        type="email"
                      />
                      <TextField
                        label={t("Должность", "Лауазым")}
                        value={form.position}
                        set={(v) => setForm((f) => ({ ...f, position: v }))}
                      />
                      <label>
                        {t("Количество сотрудников", "Қызметкерлер саны")}
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          required
                          value={form.quantity}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              quantity: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                  {!business && defaults && (
                    <p>
                      {defaults.contactName} · {defaults.email}
                    </p>
                  )}
                  <label>
                    {t("Комментарий", "Түсініктеме")}
                    <textarea
                      maxLength={2000}
                      value={form.comment}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, comment: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    className="primary lms-primary"
                    disabled={busy || checkingEnrollment || (!!context && !defaults) || !selected.available}
                  >
                    {checkingEnrollment ? t("Открываем ваши назначения…", "Тағайындауларыңыз ашылуда…") : busy
                      ? t("Сохраняем…", "Сақталуда…")
                      : t("Отправить заявку", "Өтінімді жіберу")}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="panel lms-panel" aria-busy={loading}>
          <label>
            {t("Найти программу", "Бағдарламаны табу")}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {loading && <p role="status">{t("Загружаем программы…", "Бағдарламалар жүктелуде…")}</p>}
          <ul className="lms-list">
            {data?.items.map((programme) => (
              <li key={programme.id}>
                <div>
                  <strong>{t(programme.titleRu, programme.titleKz)}</strong>
                  <p>{t(programme.summaryRu, programme.summaryKz)}</p>
                  <span>
                    {programme.hours} {t("часов", "сағат")}
                    {programme.durationDays && <> · {t("Продолжительность", "Ұзақтығы")}: {programme.durationDays} {t("дней", "күн")}</>}
                  </span>
                </div>
                <button onClick={() => choose(programme)}>
                  {t("Подробнее", "Толығырақ")}
                </button>
              </li>
            ))}
          </ul>
          {!loading && !error && data && !data.items.length && <div className="lms-empty">
            <p>{search ? t("Программы не найдены.", "Бағдарламалар табылмады.") : t("Открытого набора пока нет.", "Ашық қабылдау әлі жоқ.")}</p>
            {search ? <button type="button" onClick={() => { setSearch(""); setPage(1); }}>{t("Сбросить поиск", "Іздеуді тазарту")}</button> : context && ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "METHODIST"].includes(context.user.role) ? <Link href="/lms">{t("Подготовить программу к публикации", "Бағдарламаны жариялауға дайындау")}</Link> : context ? <Link href={context.user.role === "LEARNER" ? "/learn/applications" : "/lms/applications"}>{t("Проверить мои заявки", "Өтінімдерімді тексеру")}</Link> : <Link href="/login">{t("Войти в свой кабинет", "Жеке кабинетке кіру")}</Link>}
          </div>}
          <PageControls
            page={page}
            total={data?.total || 0}
            pageSize={25}
            onPage={setPage}
            t={t}
          />
        </section>
      )}
    </div>
  );
}
function TextField({
  label,
  value,
  set,
  ...props
}: {
  label: string;
  value: string;
  set: (value: string) => void;
  required?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  pattern?: string;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        {...props}
        maxLength={props.maxLength || 300}
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </label>
  );
}
export function PublicityEditor({
  courseId,
  t,
}: {
  courseId: string;
  t: Translate;
}) {
  const [value, setValue] = useState<{
      enabled: boolean;
      summaryRu: string;
      summaryKz: string;
    } | null>(null),
    [error, setError] = useState<unknown>(null),
    [saved, setSaved] = useState(false);
  const dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void import("@/lib/api")
      .then(({ api }) =>
        api<{ enabled: boolean; summaryRu: string; summaryKz: string }>(
          `/lms/courses/${courseId}/catalogue`,
        ),
      )
      .then((v) => {
        if (!dirty.current) setValue(v);
      })
      .catch(setError);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [courseId]);
  function update(patch: Partial<NonNullable<typeof value>>) {
    if (!value) return;
    const next = { ...value, ...patch };
    dirty.current = true;
    setSaved(false);
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void import("@/lib/api")
        .then(({ api, json }) =>
          api(`/lms/courses/${courseId}/catalogue`, {
            method: "PATCH",
            body: json(next),
          }),
        )
        .then(() => {
          setSaved(true);
          setError(null);
        })
        .catch(setError);
    }, 500);
  }
  return (
    <details>
      <summary>{t("Открытый набор", "Ашық қабылдау")}</summary>
      {value && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            {t("Показывать в открытом каталоге", "Ашық каталогта көрсету")}
          </label>
          <label>
            {t("Описание · RU", "Сипаттама · RU")}
            <textarea
              maxLength={3000}
              value={value.summaryRu}
              onChange={(e) => update({ summaryRu: e.target.value })}
            />
          </label>
          <label>
            {t("Описание · KZ", "Сипаттама · KZ")}
            <textarea
              maxLength={3000}
              value={value.summaryKz}
              onChange={(e) => update({ summaryKz: e.target.value })}
            />
          </label>
          {saved && <span role="status">{t("Сохранено", "Сақталды")}</span>}
          {!!error && <p role="alert">{applicationError(error, t)}</p>}
        </div>
      )}
    </details>
  );
}
