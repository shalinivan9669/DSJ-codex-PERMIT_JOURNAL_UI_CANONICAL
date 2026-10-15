"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import Link from "next/link";
import { api, json } from "@/lib/api";
import type { Customer, Recipient } from "@/lib/types";
import { lms, type Course, type LearnerSummary } from "@/lib/lms-api";
import {
  LmsHeading,
  PageControls,
  lmsError,
  LmsErrorDiagnostic,
  type Translate,
} from "./common";

export function Assignments({
  t,
  scope,
  canRepair = false,
}: {
  t: Translate;
  scope: string;
  canRepair?: boolean;
}) {
  const [recipients, setRecipients] = useState<LearnerSummary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [versionId, setVersionId] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>("");
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof lms.assign>
  > | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [repairing, setRepairing] = useState("");
  const [origin, setOrigin] = useState<{
    sourceRequestId?: string | null;
    sourceOrderId?: string | null;
    groupId?: string;
    dueAt?: string;
  }>({});
  const [groupName, setGroupName] = useState("");
  const initializedVersion = useRef("");
  const restoredSelection = useRef("");
  useEffect(() => {
    let alive = true;
    setCustomer(null);
    if (customerId && canRepair)
      void api<Customer>(`/customers/${customerId}`)
        .then((value) => {
          if (alive) setCustomer(value);
        })
        .catch(() => {
          /* An unavailable employer cannot be confirmed. */
        });
    return () => {
      alive = false;
    };
  }, [customerId, canRepair]);
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(window.location.search);
    const requestId = query.get("requestId") || "";
    const orderId = query.get("orderId") || "";
    const groupId = query.get("groupId") || "";
    void lms
      .assignmentContext(requestId, page, search, orderId, groupId)
      .then((data) => {
        if (!alive) return;
        setRecipients(data.recipients);
        setTotal(data.total);
        setCourses(data.courses);
        setCustomerId(data.customerId);
        setOrigin({
          sourceRequestId: data.sourceRequestId,
          sourceOrderId: data.sourceOrderId,
          ...(data.group
            ? { groupId: data.group.id, dueAt: data.group.dueAt }
            : {}),
        });
        if (data.group) setGroupName(data.group.name);
        const selectionScope = `${scope}:${requestId}:${orderId}:${groupId}`;
        if (restoredSelection.current !== selectionScope) {
          restoredSelection.current = selectionScope;
          try {
            const saved = sessionStorage.getItem(
              `demo:lms:selection:${selectionScope}`,
            );
            if (saved) {
              setSelected(new Set(JSON.parse(saved)));
            } else if (requestId && !groupId) {
              setSelected(
                new Set(
                  data.contextRecipientIds || data.recipients.map((r) => r.id),
                ),
              );
            }
          } catch {
            if (requestId && !groupId)
              setSelected(
                new Set(
                  data.contextRecipientIds || data.recipients.map((r) => r.id),
                ),
              );
          }
        }
        let preferred =
          data.group?.courseVersionId || query.get("versionId") || "";
        try {
          preferred ||= localStorage.getItem(`demo:lms:course:${scope}`) || "";
        } catch {
          /* Optional preference. */
        }
        const published = data.courses
          .map((c) => c.latestVersion)
          .filter((v) => v?.status === "PUBLISHED");
        if (initializedVersion.current !== selectionScope) {
          initializedVersion.current = selectionScope;
          setVersionId(
            published.find((v) => v?.id === preferred)?.id ||
              (published.length === 1 ? published[0]!.id : ""),
          );
        } else {
          setVersionId((current) =>
            published.some((version) => version?.id === current) ? current : "",
          );
        }
        setError("");
      })
      .catch((caught) => {
        if (alive) setError(caught);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, refresh, page, search]);
  const visible = recipients;
  useEffect(() => {
    if (restoredSelection.current)
      try {
        sessionStorage.setItem(
          `demo:lms:selection:${restoredSelection.current}`,
          JSON.stringify([...selected]),
        );
      } catch {
        /* Optional local recovery; durable operation remains server-side. */
      }
  }, [selected]);
  const errors = new Map(
    result?.errors.map((row) => [row.recipientId, lmsError(row, t)]) || [],
  );
  async function repairEmployment(row: LearnerSummary) {
    if (!canRepair || !customer || !customerId || repairing) return;
    setRepairing(row.id);
    setError("");
    try {
      const current = await api<{ data: Recipient }>(`/recipients/${row.id}`);
      await api(`/recipients/${row.id}`, {
        method: "PATCH",
        body: json({
          ...current.data,
          employerId: customerId,
          assignments: [],
        }),
      });
      setResult((value) =>
        value
          ? {
              ...value,
              errors: value.errors.filter(
                (entry) => entry.recipientId !== row.id,
              ),
            }
          : value,
      );
      setRecipients((values) =>
        values.map((value) =>
          value.id === row.id
            ? {
                ...value,
                data: {
                  ...value.data,
                  workplaceRu: customer.nameRu,
                  workplaceKz: customer.nameKz || customer.nameRu,
                },
              }
            : value,
        ),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setRepairing("");
    }
  }
  function toggle(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function assign() {
    if (busy || !versionId || !selected.size) return;
    setBusy(true);
    setError("");
    try {
      const ids = [...selected];
      const fingerprint = JSON.stringify([
        versionId,
        [...ids].sort(),
        customerId,
        origin,
      ]);
      const key = `demo:lms:assignment:${scope}`;
      let operationId = crypto.randomUUID();
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (saved?.fingerprint === fingerprint) operationId = saved.operationId;
        sessionStorage.setItem(
          key,
          JSON.stringify({ fingerprint, operationId }),
        );
      } catch {
        /* The server still retains every completed row. */
      }
      let report;
      do {
        report = await lms.assign(versionId, ids, customerId, groupName, {
          ...origin,
          operationId,
        });
        setResult(report);
      } while (report.state === "PENDING");
      if (report.state === "COMPLETED")
        setSelected(new Set(report.failedRecipientIds));
      if (report.pauseError) setError(report.pauseError);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Назначить обучение", "Оқуды тағайындау")} />
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel">
        <div className="lms-toolbar">
          <label>
            {t("Программа", "Бағдарлама")}
            <select
              value={versionId}
              disabled={busy || !!origin.groupId}
              onChange={(e) => {
                setVersionId(e.target.value);
                setResult(null);
                try {
                  localStorage.setItem(
                    `demo:lms:course:${scope}`,
                    e.target.value,
                  );
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              <option value="">
                {t("Выберите программу", "Бағдарламаны таңдаңыз")}
              </option>
              {courses.flatMap((course) => {
                const version = course.latestVersion;
                return version?.status === "PUBLISHED"
                  ? [
                      <option key={version.id} value={version.id}>
                        {t(version.content.titleRu, version.content.titleKz)} ·{" "}
                        {version.version}
                        {course.assignmentPaused
                          ? ` · ${t("Назначения приостановлены", "Тағайындаулар тоқтатылған")}`
                          : ""}
                      </option>,
                    ]
                  : [];
              })}
            </select>
          </label>
          <button
            className="primary lms-primary"
            disabled={busy || !!repairing || !versionId || !selected.size}
            onClick={() => void assign()}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : `${t("Назначить обучение", "Оқуды тағайындау")} · ${selected.size}`}
          </button>
        </div>
        {result && (
          <Notice kind={result.errorCount ? "error" : "success"}>
            {t("Назначено", "Тағайындалды")}: {result.created}.{" "}
            {result.duplicates > 0 &&
              `${t("Уже назначено", "Бұрын тағайындалған")}: ${result.duplicates}. `}
            {result.errorCount > 0 &&
              `${t("Нужна проверка строк", "Тексерілетін жолдар")}: ${result.errorCount}.`}
            {!!result.conflicts && (
              <p>
                {t(
                  "Ранее назначено в другом контексте, происхождение сохранено",
                  "Басқа контексте бұрын тағайындалған, бастапқы деректер сақталды",
                )}
                : {result.conflicts}
              </p>
            )}
            {result.state === "PENDING" && (
              <p>
                {t("Обработано", "Өңделді")}: {result.cursor}/{result.total}
              </p>
            )}
            {result.groupId && (
              <p>
                <Link href={`/lms/groups/${result.groupId}`}>
                  {t("Открыть группу", "Топты ашу")}
                </Link>
              </p>
            )}
          </Notice>
        )}
        <div className="lms-toolbar">
          <label>
            {t("Найти сотрудника", "Қызметкерді табу")}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={
                visible.length > 0 && visible.every((r) => selected.has(r.id))
              }
              onChange={(e) =>
                setSelected((current) => {
                  const next = new Set(current);
                  for (const row of visible) {
                    if (e.target.checked) next.add(row.id);
                    else next.delete(row.id);
                  }
                  return next;
                })
              }
            />
            {total > 250
              ? t("Выбрать эту страницу", "Осы бетті таңдау")
              : t("Выбрать весь список", "Тізімді түгел таңдау")}
          </label>
        </div>
        <div
          className="lms-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Сотрудники", "Қызметкерлер")}
        >
          <table className="lms-table">
            <thead>
              <tr>
                <th>{t("Сотрудник", "Қызметкер")}</th>
                <th>{t("Должность", "Лауазым")}</th>
                <th>{t("Организация", "Ұйым")}</th>
                <th>{t("Проверка", "Тексеру")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <label className="lms-inline-label">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                      <span>
                        {t(
                          row.data.fullNameRu,
                          row.data.fullNameKz || row.data.fullNameRu,
                        )}
                      </span>
                    </label>
                  </td>
                  <td>
                    {t(
                      row.data.positionRu || "",
                      row.data.positionKz || row.data.positionRu || "",
                    )}
                  </td>
                  <td>
                    {t(
                      row.data.workplaceRu || "",
                      row.data.workplaceKz || row.data.workplaceRu || "",
                    )}
                  </td>
                  <td>
                    {errors.has(row.id) && (
                      <div className="lms-error" role="alert">
                        {errors.get(row.id)}
                        {canRepair &&
                          customer &&
                          result?.errors.some(
                            (entry) =>
                              entry.recipientId === row.id &&
                              entry.code === "EMPLOYMENT_REQUIRED",
                          ) && (
                            <div>
                              <p>
                                {t(
                                  "Работодатель в заявке",
                                  "Өтінімдегі жұмыс беруші",
                                )}
                                :{" "}
                                {t(
                                  customer.nameRu,
                                  customer.nameKz || customer.nameRu,
                                )}
                              </p>
                              <button
                                disabled={!!repairing}
                                onClick={() => void repairEmployment(row)}
                              >
                                {t(
                                  "Подтвердить работодателя",
                                  "Жұмыс берушіні растау",
                                )}
                              </button>
                            </div>
                          )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && !busy && (
          <p className="lms-empty">
            {t("Сотрудников не найдено.", "Қызметкерлер табылмады.")}
          </p>
        )}
        <PageControls
          page={page}
          total={total}
          pageSize={250}
          onPage={setPage}
          t={t}
        />
      </section>
    </>
  );
}
