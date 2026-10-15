"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, downloadExport, json } from "@/lib/api";
import { lms, type Enrollment, type Learning, type Paged } from "@/lib/lms-api";
import type { AppContext } from "@/lib/types";
import { ExternalEvidence } from "./external-evidence";
import { LmsDocument } from "./documents";
import {
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  type Translate,
} from "./common";

type Prepared = {
  items: {
    id: string;
    resultId: string;
    requestId: string;
    legalForm: string;
    status: string;
    artifacts: { id: string; kind: string }[];
  }[];
  errors: { resultId: string; message: string }[];
};
export function Results({ t, context }: { t: Translate; context: AppContext }) {
  const [data, setData] = useState<Paged<Enrollment>>({ items: [], total: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [active, setActive] = useState<Enrollment | null>(null);
  const [format, setFormat] = useState<"PDF" | "DOCX">("PDF");
  const [downloading, setDownloading] = useState(false);
  const initializedPages = useRef(new Map<number, Set<string>>());
  const pageSelections = useRef(new Map<number, Set<string>>());
  const staff = context.user.role !== "EMPLOYER";
  const preparedKey = `demo:lms:prepared:${context.tenant.id}:${context.user.id}`;
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    try {
      const ids = JSON.parse(
        sessionStorage.getItem(preparedKey) || "[]",
      ) as unknown;
      if (
        Array.isArray(ids) &&
        ids.length &&
        ids.length <= 750 &&
        ids.every((id) => typeof id === "string")
      ) {
        void Promise.all(
          ids.map(async (id) => {
            const view = await api<{
              link: Prepared["items"][number];
              artifacts: { id: string; kind: string }[];
              status: string;
            }>(`/lms/documents/${id}`);
            return {
              ...view.link,
              artifacts: view.artifacts,
              status: view.status,
            };
          }),
        )
          .then((items) => {
            if (alive)
              setPrepared((current) => ({
                items,
                errors: current?.errors || [],
              }));
          })
          .catch((caught) => {
            if (alive) setError(lmsError(caught, t));
          });
      }
    } catch {
      /* Optional recovery context; server remains the source of facts. */
    }
    return () => {
      alive = false;
    };
  }, [preparedKey, staff, refresh]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        `demo:lms:documents:${context.tenant.id}:${context.user.id}`,
      );
      if (saved === "PDF" || saved === "DOCX") setFormat(saved);
    } catch {
      /* Optional preference. */
    }
  }, [context.tenant.id, context.user.id]);
  useEffect(() => {
    if (
      !prepared?.items.some(
        (item) =>
          !item.artifacts.some((artifact) => artifact.kind === format) &&
          !["VOIDED", "SUPERSEDED", "REJECTED"].includes(item.status),
      )
    )
      return;
    let alive = true;
    const timer = setTimeout(
      () => {
        void Promise.all(
          prepared.items.map(async (item) => {
            const view = await api<{
              artifacts: { id: string; kind: string }[];
              status: string;
            }>(`/lms/documents/${item.id}`);
            return { ...item, artifacts: view.artifacts, status: view.status };
          }),
        )
          .then((items) => {
            if (alive)
              setPrepared((current) =>
                current ? { ...current, items } : null,
              );
          })
          .catch((caught) => {
            if (alive) setError(lmsError(caught, t));
          });
      },
      prepared.items.some((item) => item.status === "AWAITING_APPROVAL")
        ? 10000
        : 3000,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [prepared, format]);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void lms
      .enrollments(false, page)
      .then((value) => {
        if (alive) {
          setData(value);
          setActive((current) =>
            current
              ? value.items.find((item) => item.id === current.id) || current
              : null,
          );
          const firstLoad = !initializedPages.current.has(page);
          const previousIds =
            initializedPages.current.get(page) || new Set<string>();
          const currentIds = new Set(
            value.items.flatMap((item) =>
              item.result ? [item.result.id] : [],
            ),
          );
          initializedPages.current.set(page, currentIds);
          setSelected((current) => {
            const next = new Set(current);
            previousIds.forEach((id) => {
              if (!currentIds.has(id)) next.delete(id);
            });
            for (const enrollment of value.items) {
              const result = enrollment.result;
              if (!result) continue;
              if (!(result.documentEligible ?? result.eligible))
                next.delete(result.id);
              else if (firstLoad && !enrollment.documents?.length)
                next.add(result.id);
            }
            return next;
          });
          setError("");
        }
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [page, refresh]);
  async function prepare() {
    if (busy || !selected.size) return;
    setBusy(true);
    setError("");
    try {
      const value = await api<Prepared>("/lms/results/documents", {
        method: "POST",
        body: json({ resultIds: [...selected] }),
      });
      const continuing = prepared?.errors.some((item) =>
        selected.has(item.resultId),
      );
      const nextPrepared =
        continuing && prepared
          ? {
              items: [
                ...new Map(
                  [...prepared.items, ...value.items].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
              errors: [
                ...prepared.errors.filter(
                  (item) => !selected.has(item.resultId),
                ),
                ...value.errors,
              ],
            }
          : value;
      setPrepared(nextPrepared);
      const completed = new Set(value.items.map((item) => item.resultId));
      setSelected(
        (current) => new Set([...current].filter((id) => !completed.has(id))),
      );
      try {
        sessionStorage.setItem(
          preparedKey,
          JSON.stringify(nextPrepared.items.map((item) => item.id)),
        );
      } catch {
        /* Optional recovery context. */
      }
      setRefresh((v) => v + 1);
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  const rowErrors = new Map(
    prepared?.errors.map((e) => [e.resultId, e.message]) || [],
  );
  const downloadable =
    !!prepared?.items.length &&
    prepared.items.every(
      (item) =>
        !["VOIDED", "SUPERSEDED", "REJECTED"].includes(item.status) &&
        item.artifacts.some((artifact) => artifact.kind === format),
    );
  async function download() {
    if (!prepared || downloading) return;
    setDownloading(true);
    setError("");
    try {
      await downloadExport(
        "/lms/documents/bundle",
        { documentIds: prepared.items.map((item) => item.id), format },
        "LMS-documents.zip",
      );
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Результаты", "Нәтижелер")}>
        {staff && (
          <button
            className="primary lms-primary"
            disabled={busy || !selected.size}
            onClick={() => void prepare()}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : `${t("Подготовить документы", "Құжаттарды дайындау")} · ${selected.size}`}
          </button>
        )}
      </LmsHeading>
      {error && (
        <Notice>
          {error}
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {!!prepared?.items.length && (
        <section className="panel lms-panel">
          <div className="lms-toolbar">
            <h2>{t("Комплект документов", "Құжаттар жинағы")}</h2>
            <div className="lms-actions">
              <label>
                {t("Формат", "Пішім")}
                <select
                  value={format}
                  onChange={(event) => {
                    const value = event.target.value as "PDF" | "DOCX";
                    setFormat(value);
                    try {
                      localStorage.setItem(
                        `demo:lms:documents:${context.tenant.id}:${context.user.id}`,
                        value,
                      );
                    } catch {
                      /* Optional preference. */
                    }
                  }}
                >
                  <option>PDF</option>
                  <option>DOCX</option>
                </select>
              </label>
              <button
                className="primary lms-primary"
                disabled={!downloadable || downloading}
                onClick={() => void download()}
              >
                {t("Скачать комплект", "Жинақты жүктеу")}
              </button>
            </div>
          </div>
          <ul className="lms-list">
            {[
              ...new Map(
                prepared.items.map((item) => [item.requestId, item]),
              ).values(),
            ].map((item) => (
              <li key={item.requestId}>
                <Status value={item.legalForm} t={t} />
                <Status value={item.status} t={t} />
                <Link className="button" href={`/requests/${item.requestId}`}>
                  {t("Посмотреть комплект", "Жинақты қарау")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="panel lms-panel" aria-busy={busy}>
        <div
          className="lms-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Результаты обучения", "Оқу нәтижелері")}
        >
          <table className="lms-table">
            <thead>
              <tr>
                <th>{t("Слушатель", "Тыңдаушы")}</th>
                <th>{t("Программа", "Бағдарлама")}</th>
                <th>{t("Прогресс", "Барысы")}</th>
                <th>{t("Результат", "Нәтиже")}</th>
                <th>{t("Документы", "Құжаттар")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((enrollment) => {
                const result = enrollment.result;
                return (
                  <tr key={enrollment.id}>
                    <td>
                      <div className="lms-inline-label">
                        {staff &&
                          (result?.documentEligible ?? result?.eligible) && (
                            <input
                              type="checkbox"
                              aria-label={t(
                                enrollment.recipient?.data.fullNameRu || "",
                                enrollment.recipient?.data.fullNameKz ||
                                  enrollment.recipient?.data.fullNameRu ||
                                  "",
                              )}
                              checked={selected.has(result.id)}
                              onChange={(event) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(result.id);
                                  else next.delete(result.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        <button
                          className="text-button"
                          onClick={() => setActive(enrollment)}
                        >
                          {t(
                            enrollment.recipient?.data.fullNameRu || "",
                            enrollment.recipient?.data.fullNameKz ||
                              enrollment.recipient?.data.fullNameRu ||
                              "",
                          )}
                        </button>
                      </div>
                    </td>
                    <td>
                      {t(
                        enrollment.courseVersion?.content.titleRu || "",
                        enrollment.courseVersion?.content.titleKz || "",
                      )}
                    </td>
                    <td>{enrollment.progressPercent || 0}%</td>
                    <td>
                      {result ? (
                        <>
                          <Status
                            value={result.state || result.verdict}
                            t={t}
                          />
                          <div className="lms-list-meta">
                            <Status value={result.assessmentKind} t={t} />
                            {result.score != null && (
                              <span>
                                {result.score}/{result.maximum}
                              </span>
                            )}
                          </div>
                          {result.reviewReasons?.includes(
                            "EXAM_DATE_UNKNOWN",
                          ) && (
                            <p>
                              {t(
                                "Уточните дату внешнего экзамена",
                                "Сыртқы емтихан күнін нақтылаңыз",
                              )}
                            </p>
                          )}
                          {rowErrors.get(result.id) && (
                            <p className="lms-error" role="alert">
                              {rowErrors.get(result.id)}
                            </p>
                          )}
                        </>
                      ) : (
                        <Status value="ACTIVE" t={t} />
                      )}
                    </td>
                    <td>
                      {enrollment.documents?.map((document) => (
                        <p key={document.id}>
                          <Status value={document.legalForm} t={t} />
                          {staff && (
                            <Link
                              className="button"
                              href={`/requests/${document.requestId}`}
                            >
                              {t("Посмотреть", "Қарау")}
                            </Link>
                          )}
                        </p>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.items.length && !busy && (
          <p className="lms-empty">
            {t("Назначений пока нет.", "Тағайындаулар әлі жоқ.")}
          </p>
        )}
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize || 50}
          onPage={(nextPage) => {
            pageSelections.current.set(page, new Set(selected));
            setSelected(new Set(pageSelections.current.get(nextPage) || []));
            setPage(nextPage);
          }}
          t={t}
        />
      </section>
      {active && (
        <section className="panel lms-panel">
          <div className="lms-toolbar">
            <h2>
              {t(
                active.recipient?.data.fullNameRu || "",
                active.recipient?.data.fullNameKz ||
                  active.recipient?.data.fullNameRu ||
                  "",
              )}
            </h2>
            <button onClick={() => setActive(null)}>
              {t("Закрыть", "Жабу")}
            </button>
          </div>
          {staff && (
            <InviteAccess
              enrollment={active}
              t={t}
              canRecover={["ADMIN", "DIRECTOR"].includes(context.user.role)}
            />
          )}
          <EnrollmentDetails
            key={active.id}
            enrollment={active}
            t={t}
            staff={staff}
            canReview={["ADMIN", "DIRECTOR"].includes(context.user.role)}
            onChanged={() => setRefresh((v) => v + 1)}
          />
        </section>
      )}
    </>
  );
}
function EnrollmentDetails({
  enrollment,
  t,
  canReview,
  staff,
  onChanged,
}: {
  enrollment: Enrollment;
  t: Translate;
  canReview: boolean;
  staff: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Learning | null>(null),
    [error, setError] = useState("");
  const [reason, setReason] = useState(""),
    [action, setAction] = useState("correct"),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [dueAt, setDueAt] = useState(enrollment.dueAt?.slice(0, 10) || "");
  const [extended, setExtended] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<Learning>(`/lms/enrollments/${enrollment.id}`)
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      });
    return () => {
      alive = false;
    };
  }, [enrollment.id, enrollment.result?.id]);
  async function amend(event: FormEvent) {
    event.preventDefault();
    if (!enrollment.result || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/lms/results/${enrollment.result.id}/${action}`, {
        method: "POST",
        body: json({ reason }),
      });
      setDone(true);
      onChanged();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <Notice>{error}</Notice>}
      {staff && data?.profile.assessmentKind === "EXTERNAL_AUTHORIZED" && (
        <ExternalEvidence
          enrollmentId={enrollment.id}
          t={t}
          canReview={canReview}
          onChanged={onChanged}
        />
      )}
      {data?.documents.map((document) => (
        <LmsDocument
          key={document.id}
          id={document.id}
          t={t}
          canPrepare={staff}
          canAttest={canReview}
          onChanged={onChanged}
        />
      ))}
      {staff && (
        <details>
          <summary>{t("Срок доступа", "Қолжетімділік мерзімі")}</summary>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await api(`/lms/enrollments/${enrollment.id}/extend`, {
                  method: "POST",
                  body: json({
                    dueAt: new Date(`${dueAt}T23:59:59`).toISOString(),
                  }),
                });
                setExtended(true);
                onChanged();
              } catch (caught) {
                setError(lmsError(caught, t));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Доступ до", "Қолжетімділік аяқталуы")}
              <input
                required
                type="date"
                value={dueAt}
                onChange={(event) => {
                  setDueAt(event.target.value);
                  setExtended(false);
                }}
              />
            </label>
            {extended && (
              <p role="status">{t("Срок обновлён", "Мерзім жаңартылды")}</p>
            )}
            <button className="primary" disabled={busy}>
              {t("Обновить срок доступа", "Қолжетімділік мерзімін жаңарту")}
            </button>
          </form>
        </details>
      )}
      {canReview && enrollment.result && (
        <details>
          <summary>
            {t("Исправление или аннулирование", "Түзету немесе күшін жою")}
          </summary>
          {done ? (
            <p role="status">
              {t("Изменение зарегистрировано", "Өзгеріс тіркелді")}
            </p>
          ) : (
            <form onSubmit={amend}>
              <label>
                {t("Действие", "Әрекет")}
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="correct">
                    {t(
                      "Новая редакция с исправленными данными",
                      "Түзетілген деректермен жаңа нұсқа",
                    )}
                  </option>
                  <option value="revoke">
                    {t("Аннулировать результат", "Нәтиженің күшін жою")}
                  </option>
                </select>
              </label>
              <label>
                {t("Основание", "Негіз")}
                <textarea
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                {action === "correct"
                  ? t(
                      "Создать исправленную редакцию",
                      "Түзетілген нұсқаны жасау",
                    )
                  : t("Аннулировать результат", "Нәтиженің күшін жою")}
              </button>
            </form>
          )}
        </details>
      )}
    </>
  );
}
function InviteAccess({
  enrollment,
  t,
  canRecover,
}: {
  enrollment: Enrollment;
  t: Translate;
  canRecover: boolean;
}) {
  const [email, setEmail] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = await api<{ url: string }>(
        enrollment.learnerUserId ? "/lms/recovery" : "/lms/invites",
        {
          method: "POST",
          body: json(
            enrollment.learnerUserId
              ? { userId: enrollment.learnerUserId }
              : { recipientId: enrollment.recipientId, email },
          ),
        },
      );
      setUrl(new URL(value.url, window.location.origin).toString());
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  if (enrollment.learnerUserId && !canRecover) return null;
  return (
    <details>
      <summary>{t("Доступ к обучению", "Оқуға қолжетімділік")}</summary>
      {error && <Notice>{error}</Notice>}
      {url ? (
        <>
          <label>
            {enrollment.learnerUserId
              ? t(
                  "Ссылка восстановления доступа",
                  "Қолжетімділікті қалпына келтіру сілтемесі",
                )
              : t("Ссылка приглашения", "Шақыру сілтемесі")}
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .catch((caught) => setError(lmsError(caught, t)))
            }
          >
            {t("Скопировать", "Көшіру")}
          </button>
        </>
      ) : (
        <form onSubmit={invite}>
          {!enrollment.learnerUserId && (
            <label>
              {t(
                "Электронная почта слушателя",
                "Тыңдаушының электрондық поштасы",
              )}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {enrollment.learnerUserId
              ? t(
                  "Создать ссылку восстановления",
                  "Қалпына келтіру сілтемесін жасау",
                )
              : t("Создать приглашение", "Шақыру жасау")}
          </button>
        </form>
      )}
    </details>
  );
}
