"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import Link from "next/link";
import { api, json } from "@/lib/api";
import type { Customer, Recipient } from "@/lib/types";
import { lms, type Course, type LearnerSummary } from "@/lib/lms-api";
import { LearnerAccess } from "./learner-access";
import { OperatorPerson } from "./operator-person";
import { OperatorOrganization } from "./operator-organization";
import { AccessPolicyEditor } from "./access-policy-editor";
import type { AccessPolicy } from "@demo/contracts/src/lms";
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
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [source, setSource] = useState<{ title?: string | null; applicationId?: string | null; courseVersionId?: string | null }>({});
  const [addingPerson, setAddingPerson] = useState(false);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [resuming, setResuming] = useState(false);
  const [customAccess, setCustomAccess] = useState(false);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicy>({ mode: "DAYS", days: 90, timezone: "Asia/Qyzylorda" });
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
  const [selectingAll, setSelectingAll] = useState(false);
  async function selectAllFiltered() {
    setSelectingAll(true);
    setError("");
    try {
      const params = new URLSearchParams({ search });
      for (const [key, value] of Object.entries({
        requestId: origin.sourceRequestId,
        orderId: origin.sourceOrderId,
        groupId: origin.groupId,
        customerId,
      }))
        if (value) params.set(key, value);
      const result = await api<{ recipientIds: string[] }>(
        `/lms/employer-import/selection?${params}`,
      );
      setSelected(new Set(result.recipientIds));
    } catch (caught) {
      setError(caught);
    } finally {
      setSelectingAll(false);
    }
  }
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
    const requestId = query.get("requestId") || query.get("sourceRequestId") || "";
    const orderId = query.get("orderId") || query.get("sourceOrderId") || "";
    const groupId = query.get("groupId") || "";
    const filterCustomer = customerFilter ?? query.get("customerId") ?? "";
    const params = new URLSearchParams({ page: String(page), search });
    for (const [key, value] of Object.entries({ requestId, orderId, groupId, customerId: filterCustomer })) if (value) params.set(key, value);
    void api<Awaited<ReturnType<typeof lms.assignmentContext>> & {
      sourceTitle?: string | null; applicationId?: string | null; courseVersionId?: string | null;
    }>(`/lms/assignment-context?${params}`)
      .then((data) => {
        if (!alive) return;
        setRecipients(data.recipients);
        setTotal(data.total);
        setCourses(data.courses);
        setCustomerId(data.customerId);
        setSource({ title: data.sourceTitle, applicationId: data.applicationId, courseVersionId: data.courseVersionId });
        setOrigin({
          sourceRequestId: data.sourceRequestId,
          sourceOrderId: data.sourceOrderId,
          ...(data.group
            ? { groupId: data.group.id, dueAt: data.group.dueAt }
            : {}),
        });
        if (data.group) setGroupName(data.group.name);
        const selectionScope = `${scope}:${requestId}:${orderId}:${groupId}:${filterCustomer}`;
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
          data.group?.courseVersionId || data.courseVersionId || query.get("versionId") || query.get("courseVersionId") || "";
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
          try {
            const saved = JSON.parse(sessionStorage.getItem(`demo:lms:assignment:${scope}`) || "null");
            const settings = saved?.settings;
            if (settings && saved.state !== "COMPLETED" &&
              (settings.origin.sourceRequestId || "") === requestId &&
              (settings.origin.sourceOrderId || "") === orderId &&
              (settings.origin.groupId || "") === groupId &&
              (settings.customerId || "") === (data.customerId || "")) {
              setVersionId(settings.versionId); setGroupName(settings.groupName);
              setCustomAccess(settings.customAccess); setAccessPolicy(settings.accessPolicy);
              setSelected(new Set(saved.recipientIds)); setResuming(true);
            }
          } catch { /* Current source and persisted row outcomes remain available. */ }
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
  }, [scope, refresh, page, search, customerFilter]);
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
  const completed = result?.state === "COMPLETED" && result.errorCount === 0;
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
          id: current.data.id || row.id,
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
                customerIds: [...new Set([...(value.customerIds || []), customerId])],
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
        groupName,
        customAccess ? accessPolicy : null,
      ]);
      const key = `demo:lms:assignment:${scope}`;
      let operationId = crypto.randomUUID();
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (saved?.fingerprint === fingerprint) operationId = saved.operationId;
        sessionStorage.setItem(
          key,
          JSON.stringify({ fingerprint, operationId, recipientIds: ids, state: "PENDING", settings: { versionId, customerId, origin, groupName, customAccess, accessPolicy } }),
        );
      } catch {
        /* The server still retains every completed row. */
      }
      let report;
      do {
        report = await api<Awaited<ReturnType<typeof lms.assign>>>("/lms/enrollments", {
          method: "POST", body: json({ courseVersionId: versionId, recipientIds: ids, customerId, groupName, ...origin, operationId,
            ...(customAccess && !origin.groupId ? { accessPolicy } : {}),
          }),
        });
        setResult(report);
        try {
          sessionStorage.setItem(key, JSON.stringify({ fingerprint, operationId, recipientIds: ids, state: report.state, settings: { versionId, customerId, origin, groupName, customAccess, accessPolicy } }));
        } catch { /* Persisted server operation can still be retried in this session. */ }
      } while (report.state === "PENDING");
      if (report.state === "COMPLETED")
        setSelected(new Set(report.failedRecipientIds));
      setResuming(report.state !== "COMPLETED");
      setAssignedIds(ids.filter((id) => !report.failedRecipientIds.includes(id)));
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
        {source.title && <p><strong>{source.title}</strong>{source.applicationId && <> · <Link href={`/lms/applications?id=${source.applicationId}`}>{t("Заявка на обучение", "Оқуға өтінім")}</Link></>}{origin.sourceOrderId && <> · <Link href={`/workbench?orderId=${origin.sourceOrderId}`}>{t("Заказ", "Тапсырыс")}</Link></>}</p>}
        {!completed && <>
        {canRepair && !origin.sourceRequestId && !origin.sourceOrderId && !origin.groupId && <OperatorOrganization value={customerId || ""} disabled={busy} t={t} onChange={(value) => {
          setCustomerFilter(value?.id || ""); setCustomerId(value?.id); setSelected(new Set()); setResult(null); setPage(1);
          const query = new URLSearchParams(window.location.search);
          if (value) query.set("customerId", value.id); else query.delete("customerId");
          window.history.replaceState(null, "", `/lms/assign?${query}`);
        }} />}
        {!!customer && (origin.sourceOrderId || origin.sourceRequestId || origin.groupId) && <p>{t(customer.nameRu, customer.nameKz || customer.nameRu)}</p>}
        <div className="lms-toolbar">
          <label>
            {t("Программа", "Бағдарлама")}
            <select
              value={versionId}
              disabled={busy || !!origin.groupId || !!source.courseVersionId}
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
              : `${resuming ? t("Продолжить назначение", "Тағайындауды жалғастыру") : t("Назначить обучение", "Оқуды тағайындау")} · ${selected.size}`}
          </button>
        </div>
        {!busy && !courses.length && <p>{t("Методист или директор должен опубликовать программу, прежде чем ей можно назначить людей.", "Адамдарға тағайындау алдында әдіскер немесе директор бағдарламаны жариялауы керек.")} <Link href="/lms">{t("Открыть программы", "Бағдарламаларды ашу")}</Link></p>}
        {!origin.groupId && <details><summary>{t("Группа и сроки · по правилам программы", "Топ және мерзімдер · бағдарлама ережелері бойынша")}</summary><label>{t("Название группы · необязательно", "Топ атауы · міндетті емес")}<input value={groupName} maxLength={300} disabled={busy} onChange={(event) => setGroupName(event.target.value)} /></label><label className="lms-inline-label"><input type="checkbox" checked={customAccess} disabled={busy} onChange={(event) => setCustomAccess(event.target.checked)} />{t("Задать общий период доступа для состава", "Құрамға ортақ қолжетімділік мерзімін белгілеу")}</label>{customAccess && <AccessPolicyEditor value={accessPolicy} onChange={setAccessPolicy} disabled={busy} t={t} />}</details>}
        </>}
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
        {canRepair && assignedIds.length > 0 && completed && <LearnerAccess recipientIds={assignedIds} customerId={customerId} t={t} />}
        {!canRepair && result?.state === "COMPLETED" && <p>{t("Доступ слушателям открывает центр. Назначение ещё не означает, что слушатель начал обучение.", "Тыңдаушыларға қолжетімділікті орталық ашады. Тағайындау тыңдаушының оқуды бастағанын білдірмейді.")}</p>}
        {completed && <button onClick={() => { setResult(null); setAssignedIds([]); }}>{t("Назначить ещё", "Тағы тағайындау")}</button>}
        {!completed && <>
        <div className="lms-toolbar">
          {canRepair && !origin.sourceRequestId && <button disabled={busy} onClick={() => setAddingPerson((value) => !value)} aria-expanded={addingPerson}>{addingPerson ? t("Закрыть ввод нового человека", "Жаңа адамды енгізуді жабу") : t("Добавить человека", "Адам қосу")}</button>}
          {!origin.groupId && <Link href={`/lms/import?${new URLSearchParams({ ...(customerId ? { customerId } : {}), ...(versionId ? { versionId } : {}), ...(origin.sourceOrderId ? { orderId: origin.sourceOrderId } : {}), ...(origin.sourceRequestId ? { requestId: origin.sourceRequestId } : {}) })}`}>{t("Вставить список или импортировать Excel", "Тізімді қою немесе Excel импорттау")}</Link>}
        </div>
        {addingPerson && canRepair && !origin.sourceRequestId && <OperatorPerson customerId={customerId} t={t} onCreated={(id) => { setSelected((values) => new Set([...values, id])); setSearch(""); setPage(1); setRefresh((value) => value + 1); }} />}
        <div className="lms-toolbar">
          <label>
            {t("Найти сотрудника", "Қызметкерді табу")}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setSelected(new Set());
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
              : t("Выбрать видимый список", "Көрсетілген тізімді таңдау")}
          </label>
          {total > visible.length && (
            <button
              disabled={busy || selectingAll}
              onClick={() => void selectAllFiltered()}
            >
              {t(
                "Выбрать всю отфильтрованную выборку",
                "Сүзілген тізімді түгел таңдау",
              )}{" "}
              · {total}
            </button>
          )}
          {!!selected.size && (
            <span role="status">
              {t("Выбрано", "Таңдалды")}: {selected.size}
            </span>
          )}
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
        </>}
      </section>
    </>
  );
}
