"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import type { Customer, Recipient } from "@/lib/types";
import { lms, type Course, type LearnerSummary } from "@/lib/lms-api";
import { LmsHeading, PageControls, lmsError, type Translate } from "./common";

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof lms.assign>
  > | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [repairing, setRepairing] = useState("");
  const initializedVersion = useRef("");
  const initializedRecipients = useRef(new Set<string>());
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
    void lms
      .assignmentContext(requestId, page, search)
      .then((data) => {
        if (!alive) return;
        setRecipients(data.recipients);
        setTotal(data.total);
        setCourses(data.courses);
        setCustomerId(data.customerId);
        const selectionScope = `${scope}:${requestId}`;
        if (requestId && !search) {
          const unseen = data.recipients.filter(
            (row) =>
              !initializedRecipients.current.has(`${selectionScope}:${row.id}`),
          );
          unseen.forEach((row) =>
            initializedRecipients.current.add(`${selectionScope}:${row.id}`),
          );
          setSelected(
            (current) => new Set([...current, ...unseen.map((r) => r.id)]),
          );
        }
        let preferred = query.get("versionId") || "";
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
        if (alive) setError(lmsError(caught, t));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, refresh, page, search]);
  const visible = recipients;
  const errors = new Map(
    result?.errors.map((row) => [row.recipientId, row.message]) || [],
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
      setError(lmsError(caught, t));
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
      const report = await lms.assign(versionId, [...selected], customerId);
      setResult(report);
      if (report.errors.length)
        setSelected(new Set(report.errors.map((e) => e.recipientId)));
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Назначить обучение", "Оқуды тағайындау")} />
      {error && (
        <Notice>
          {error}
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
              disabled={busy}
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
          <Notice kind={result.errors.length ? "error" : "success"}>
            {t("Назначено", "Тағайындалды")}: {result.created}.{" "}
            {result.duplicates > 0 &&
              `${t("Уже назначено", "Бұрын тағайындалған")}: ${result.duplicates}. `}
            {result.errors.length > 0 &&
              `${t("Нужна проверка строк", "Тексерілетін жолдар")}: ${result.errors.length}.`}
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
