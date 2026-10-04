"use client";
import { isDirectorRole } from "@demo/contracts";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext, Draft, Page, Role } from "@/lib/types";
import { dateTime, Status } from "./request-list";
import { templateLabels, documentTitle } from "@/lib/types";
import { validationErrors } from "@/lib/validation-errors";
import { rejectionReason } from "@/lib/rejection-reason";
import { approvedScopeIssued } from "@/lib/request-actions";
import { addressIssue, type AddressedIssue } from "@/lib/validation-address";
import type { ApprovalReview } from "@/lib/approval-review";
import { ApprovalReviewPanel } from "./approval-review";
import { approvalRefreshRequired } from "@/lib/approval-refresh";
import { ApprovalPreview } from "./approval-preview";

type Proposal = {
  id: string;
  requestId: string;
  status: string;
  title?: string;
  proposalHash: string;
  requestRevision: number;
  submittedAt: string;
  requestedAction: "SAVE" | "CANCEL" | "ARCHIVE";
  author?: { displayName: string };
  request?: { title: string };
  reason?: string;
  referenceLabels?: Record<string, string>;
  diff?: { path: string; before: unknown; after: unknown }[];
  decision?: { decision: string; comment: string; createdAt: string } | null;
  draft?: Draft | null;
  assignments?: { rowId: string; assignmentId: string }[] | null;
  review?: ApprovalReview | null;
  reviewUnavailable?: boolean;
  currentRevision?: number;
};
const labels: Record<string, string> = {
  title: "Название заявки",
  kind: "Тип заявки",
  customerId: "Заказчик",
  organizationSnapshots: "Утверждаемые реквизиты организаций",
  nameRu: "Наименование RU",
  nameKz: "Наименование KZ",
  bin: "БИН",
  addressRu: "Адрес RU",
  addressKz: "Адрес KZ",
  items: "Сотрудники",
  assignments: "Документы",
  events: "Обучения",
  fullNameRu: "ФИО RU",
  fullNameKz: "ФИО KZ",
  fullNameEn: "ФИО EN",
  positionRu: "Должность RU",
  positionKz: "Должность KZ",
  positionEn: "Должность EN",
  workplaceRu: "Место работы RU",
  workplaceKz: "Место работы KZ",
  workplaceEn: "Место работы EN",
  employeeCategory: "Категория сотрудника",
  documentDate: "Дата выдачи",
  protocolDate: "Дата протокола",
  trainingStart: "Начало обучения",
  trainingEnd: "Окончание обучения",
  validUntil: "Действует до",
  trainingSubject: "Программа обучения",
  trainingSubjectEn: "Программа EN",
  hours: "Часы обучения",
  productionHours: "Производственные часы",
  protocolMode: "Режим протокола",
  templateId: "Документ",
  protocolTemplateId: "Форма протокола",
  englishAppendix: "Английская страница",
  commonFields: "Общие данные",
  result: "Результат",
  status: "Статус",
  reason: "Основание",
  validityMode: "Срок действия",
  biotCategory: "Категория БиОТ",
  profileVersionId: "Версия реквизитов центра",
  photoAssetId: "Фотография",
  outcome: "Результат обучения",
  personnelNumber: "Табельный номер",
  resultEn: "Результат EN",
  resultKz: "Результат KZ",
  professionRu: "Профессия RU",
  professionKz: "Профессия KZ",
  psQualificationRu: "Присвоенная квалификация RU",
  psQualificationKz: "Присвоенная квалификация KZ",
  reasonEn: "Основание EN",
  education: "Образование",
  educationEn: "Образование EN",
  departmentRu: "Подразделение RU",
  departmentKz: "Подразделение KZ",
  departmentEn: "Подразделение EN",
  employerBin: "БИН работодателя",
  employerAddressRu: "Адрес работодателя RU",
  employerAddressKz: "Адрес работодателя KZ",
  employerAddressEn: "Адрес работодателя EN",
  employerId: "Запись работодателя",
  externalBasisNumber: "Номер внешнего основания",
  source: "Подтверждающий источник",
  confirmedAt: "Дата подтверждения результата",
  confirmedBy: "Подтвердивший сотрудник",
  biotCheckType: "Вид проверки БиОТ",
  biotIndustryRu: "Отрасль RU",
  biotIndustryKz: "Отрасль KZ",
  biotIndustryEn: "Отрасль EN",
  biotKnowledgeResult: "Результат проверки знаний",
  biotKnowledgeResultEn: "Результат проверки знаний EN",
  biotProctoringResult: "Результат прокторинга",
  biotProctoringResultEn: "Результат прокторинга EN",
  biotUniqueNumber: "Уникальный номер",
  biotNotes: "Примечания БиОТ",
  biotNotesEn: "Примечания БиОТ EN",
  profileOverrideId: "Профиль комиссии",
  commonFieldOverrides: "Особые значения обучения",
  trainingDateRule: "Расчёт периода обучения",
};
function fieldLabel(path: string) {
  return path
    .replace(/\b(items|assignments|events)\.(\d+)(?=\.|$)/g, "$1[$2]")
    .replace(/items\[(\d+)\]/g, (_, index) => `Сотрудник ${Number(index) + 1}`)
    .replace(
      /assignments\[(\d+)\]/g,
      (_, index) => `Документ ${Number(index) + 1}`,
    )
    .replace(/events\[(\d+)\]/g, (_, index) => `Обучение ${Number(index) + 1}`)
    .split(".")
    .map((key) => labels[key] || key)
    .join(" · ");
}
function readable(
  value: unknown,
  references: Record<string, string> = {},
): string {
  if (value == null || value === "") return "Не задано";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value))
    return value.map((entry) => readable(entry, references)).join("\n\n");
  if (typeof value === "object")
    return Object.entries(value)
      .filter(
        ([key]) =>
          ![
            "id",
            "fieldOrigins",
            "dateOrigins",
            "revision",
            "eventId",
            "protocolModeSource",
          ].includes(key),
      )
      .map(
        ([key, entry]) =>
          `${labels[key] || key}: ${readable(entry, references)}`,
      )
      .join("\n");
  const choices: Record<string, string> = {
    ...templateLabels,
    PASSED: "Сдал",
    FAILED: "Не сдал",
    ABSENT: "Не явился",
    UNKNOWN: "Результат не подтверждён",
    PERIODIC: "Очередная проверка",
    REPEAT: "Повторная проверка",
    WORKER: "Рабочий",
    ITR: "ИТР",
    GROUP: "Общий",
    INDIVIDUAL: "На каждого",
    UNLIMITED: "Бессрочно",
    FIXED: "Срок ограничен",
    PERSON: "Физическое лицо",
    COMPANY: "Организация",
  };
  return references[String(value)] || choices[String(value)] || String(value);
}

export function ApprovalBanner({
  draft,
  role,
  onRefresh,
  compact = false,
}: {
  draft: Draft;
  role: Role;
  onRefresh: () => Promise<void>;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnedProposal, setReturnedProposal] = useState<Proposal | null>(
    null,
  );
  const [returnError, setReturnError] = useState("");
  const approval = draft.approval;
  const refreshDraft = useRef(onRefresh);
  const currentDraft = useRef(draft);
  useEffect(() => {
    refreshDraft.current = onRefresh;
    currentDraft.current = draft;
  }, [onRefresh, draft]);
  useEffect(() => {
    if (
      !approval?.status ||
      !["PENDING", "APPROVED"].includes(approval.status) ||
      draft.status !== "DRAFT"
    )
      return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const latest = await api<Parameters<typeof approvalRefreshRequired>[1]>(
          `/print-requests/${encodeURIComponent(draft.id)}/approval`,
        );
        if (active && approvalRefreshRequired(currentDraft.current, latest))
          await refreshDraft.current();
      } catch {
        // A transient background read does not interrupt typing. The explicit
        // refresh remains available, and the next visible check retries.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => void check(), 6000);
    const onVisible = () => void check();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [draft.id, draft.status, approval?.status]);
  useEffect(() => {
    let active = true;
    setReturnedProposal(null);
    setReturnError("");
    if (approval?.status === "REJECTED") {
      void api<Proposal>(
        `/approvals/${encodeURIComponent(approval.proposalId)}`,
      )
        .then((detail) => {
          if (!active) return;
          if (!rejectionReason({ id: draft.id, approval }, detail)) {
            setReturnError(
              "Замечание директора недоступно. Откройте решение для проверки.",
            );
            return;
          }
          setReturnedProposal(detail);
        })
        .catch(() => {
          if (active)
            setReturnError(
              "Не удалось загрузить замечание директора. Откройте решение для проверки.",
            );
        });
    }
    return () => {
      active = false;
    };
  }, [
    draft.id,
    approval?.proposalId,
    approval?.proposalHash,
    approval?.status,
  ]);
  const reason = rejectionReason(draft, returnedProposal);
  if (!approval && draft.status !== "DRAFT") return null;
  return (
    <section className="approval-banner" aria-label="Согласование заявки">
      <div className="approval-summary">
        <strong>
          {approval?.status === "APPROVED"
            ? "Редакция согласована директором"
            : approval?.status === "REJECTED"
              ? "Директор вернул редакцию на доработку"
              : approval?.status === "PENDING"
                ? "Выбранный состав передан директору"
                : "Рабочий черновик сохраняется"}
        </strong>
        {approval && <Status value={approval.status} />}
      </div>
      {approval?.status === "REJECTED" &&
        (reason ? (
          <p>
            <strong>Причина возврата:</strong> {reason}
          </p>
        ) : returnError ? (
          <p>
            {returnError}{" "}
            <Link
              href={`/approvals?proposal=${encodeURIComponent(approval.proposalId)}`}
            >
              Посмотреть решение
            </Link>
          </p>
        ) : (
          <p role="status">Загружаем замечание директора…</p>
        ))}
      <p>
        {approval?.status === "APPROVED"
          ? draft.status === "FINALIZED"
            ? "Документы подготовлены и доступны для печати."
            : approvedScopeIssued(draft)
              ? "Согласованная партия уже оформлена; документы доступны для печати. Для следующего выпуска подтвердите и передайте новый состав выше."
              : "Можно оформить согласованный состав. Следующие люди и курсы продолжат работу в этой заявке. Изменение согласованных данных потребует нового решения."
          : approval?.status === "PENDING"
            ? "Директор рассматривает выбранных людей и курсы. Остальные назначения остаются рабочим черновиком."
            : "Ввод сохраняется автоматически. Готовый состав передаётся директору отдельной командой после проверки."}
      </p>
      {!compact && (
        <div className="action-buttons">
          {approval && (
            <Link
              className="button"
              href={`/approvals?proposal=${encodeURIComponent(approval.proposalId)}`}
            >
              {isDirectorRole(role)
                ? "Проверить и принять решение"
                : "Посмотреть решение"}
            </Link>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onRefresh();
              } catch (caught) {
                setError(errorText(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Обновляем…" : "Обновить состояние"}
          </button>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </section>
  );
}

export function Approvals({ context }: { context: AppContext }) {
  const [rows, setRows] = useState<Page<Proposal>>({ items: [], total: 0 });
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Proposal | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dataIssues, setDataIssues] = useState<
    ReturnType<typeof validationErrors>
  >([]);
  const [refresh, setRefresh] = useState(0);
  const director = isDirectorRole(context.user.role);
  useEffect(() => {
    setSelected(
      new URLSearchParams(window.location.search).get("proposal") || "",
    );
  }, []);
  useEffect(() => {
    let active = true;
    setBusy("list");
    setError("");
    void api<Page<Proposal>>(`/approvals?status=${status}&page=${page}`)
      .then((result) => {
        if (!active) return;
        setRows(result);
        setSelected((id) => id || result.items[0]?.id || "");
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      })
      .finally(() => {
        if (active) setBusy("");
      });
    return () => {
      active = false;
    };
  }, [status, page, refresh]);
  const loadDetail = useCallback(async () => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const result = await api<Proposal>(
      `/approvals/${encodeURIComponent(selected)}`,
    );
    setDetail(result);
    setReason("");
  }, [selected]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    setDataIssues([]);
    if (selected)
      void api<Proposal>(`/approvals/${encodeURIComponent(selected)}`)
        .then((result) => {
          if (active) {
            setDetail(result);
            setReason("");
            if (
              result.status === "PENDING" &&
              result.requestedAction === "SAVE"
            ) {
              setDataIssues(result.review?.issues || []);
              if (result.reviewUnavailable || result.review?.issues.length)
                setError(
                  "Переданная редакция требует исправления. Верните её менеджеру, проверьте актуальный черновик и передайте подготовленный состав повторно.",
                );
            }
          }
        })
        .catch((caught) => {
          if (active) setError(errorText(caught));
        });
    return () => {
      active = false;
    };
  }, [selected, refresh]);
  async function decide(decision: "APPROVE" | "REJECT", returnReason?: string) {
    if (!detail) return;
    setBusy(decision);
    setError("");
    setMessage("");
    setDataIssues([]);
    try {
      await api(`/approvals/${detail.id}/decision`, {
        method: "POST",
        body: json({
          decision,
          reason:
            returnReason ||
            reason.trim() ||
            (decision === "APPROVE"
              ? "Проверено и согласовано директором"
              : ""),
          expectedProposalHash: detail.proposalHash,
        }),
      });
      setMessage(
        decision === "APPROVE"
          ? "Редакция согласована. Решение сохранено в истории."
          : "Редакция возвращена менеджеру с замечанием.",
      );
      await loadDetail();
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(errorText(caught));
      setDataIssues(validationErrors(caught));
    } finally {
      setBusy("");
    }
  }
  const changes = (detail?.diff || []).filter(
    (change) =>
      !/(?:^|\.)(?:id|fieldOrigins|dateOrigins|schemaVersion|businessRuleVersion|revision)(?:\.|$)/.test(
        change.path,
      ),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{director ? "Кабинет директора" : "Согласование заявок"}</h1>
          <p>
            {director
              ? "Проверьте редакцию и согласуйте её или верните менеджеру. После согласования документы доступны для печати."
              : "Решения директора по сохранённым рабочим версиям."}
          </p>
        </div>
        <button
          onClick={() => setRefresh((value) => value + 1)}
          disabled={!!busy}
        >
          Обновить
        </button>
      </div>
      {error && (
        <Notice>
          {error}
          {!!dataIssues.length && detail && (
            <>
              <ul>
                {dataIssues.map((issue, index) => (
                  <li key={index}>
                    {typeof issue === "string"
                      ? issue
                      : (() => {
                          const addressed = addressIssue(
                            issue,
                            detail.draft?.items || [],
                            detail.draft?.events || [],
                          ) as AddressedIssue;
                          const row = detail.draft?.items.find(
                            (item) =>
                              item.id ===
                              (addressed.rowId ||
                                addressed.recipientId ||
                                addressed.itemId),
                          );
                          const assignment = row?.assignments.find(
                            (item) => item.id === addressed.assignmentId,
                          );
                          const query = new URLSearchParams({
                            check: "1",
                            issuePath: String(addressed.path || ""),
                            issueField: addressed.field || "",
                            issueRow: row?.id || "",
                            issueAssignment: assignment?.id || "",
                            issueEvent: addressed.eventId || "",
                          });
                          return (
                            <Link
                              href={`/requests/${detail.requestId}/edit?${query}`}
                            >
                              {row?.fullNameRu ? `${row.fullNameRu} · ` : ""}
                              {assignment
                                ? `${documentTitle(assignment.templateId)} · `
                                : ""}
                              {fieldLabel(
                                String(
                                  (assignment && addressed.field) ||
                                    addressed.path ||
                                    addressed.field ||
                                    "",
                                ),
                              )}
                              : {issue.message}. Исправить поле
                            </Link>
                          );
                        })()}
                  </li>
                ))}
              </ul>
              <Link
                className="button"
                href={`/requests/${detail.requestId}/edit?check=1`}
              >
                Исправить данные заявки
              </Link>
            </>
          )}
        </Notice>
      )}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="toolbar">
        <label className="inline-label">
          Состояние
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
              setSelected("");
            }}
          >
            <option value="PENDING">Ожидают решения</option>
            <option value="APPROVED">Согласованы</option>
            <option value="REJECTED">Возвращены</option>
            {isDirectorRole(context.user.role) && (
              <option value="SUPERSEDED">Заменены новыми редакциями</option>
            )}
          </select>
        </label>
        <span role="status">Версий: {rows.total}</span>
      </div>
      <div className="approval-layout">
        <section aria-label="Предложенные редакции">
          <ul className="approval-list">
            {rows.items.map((row) => (
              <li key={row.id}>
                <button
                  aria-pressed={selected === row.id}
                  onClick={() => {
                    setSelected(row.id);
                    setMessage("");
                  }}
                >
                  <strong>{row.title || "Новая заявка"}</strong>
                  <small>
                    {row.author?.displayName || "Сотрудник центра"} ·{" "}
                    {dateTime(row.submittedAt)} · редакция {row.requestRevision}
                  </small>
                  <Status value={row.status} />
                </button>
              </li>
            ))}
          </ul>
          {!rows.items.length && (
            <p>
              {busy === "list" ? "Загружаем…" : "В этом разделе нет заявок."}
            </p>
          )}
          <div className="pagination">
            <button
              disabled={page === 1 || !!busy}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </button>
            <span>{page}</span>
            <button
              disabled={page * 50 >= rows.total || !!busy}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </button>
          </div>
        </section>
        <section
          className="panel approval-detail"
          aria-label="Рассмотрение редакции"
          aria-busy={!!selected && !detail}
        >
          {detail ? (
            <>
              <h2>{detail.request?.title || detail.title || "Новая заявка"}</h2>
              <p>
                {detail.author?.displayName} · редакция {detail.requestRevision}{" "}
                · <Status value={detail.status} />
              </p>
              {detail.review && (
                <ApprovalReviewPanel
                  key={detail.id}
                  review={detail.review}
                  submitted={detail.draft}
                />
              )}
              {detail.requestedAction === "SAVE" && detail.review && (
                <ApprovalPreview
                  key={`preview:${detail.id}`}
                  requestId={detail.requestId}
                  proposalId={detail.id}
                  proposalHash={detail.proposalHash}
                  revision={detail.requestRevision}
                />
              )}
              {!detail.review && detail.assignments && (
                <details>
                  <summary>
                    Согласуемый состав:{" "}
                    {
                      new Set(detail.assignments.map((entry) => entry.rowId))
                        .size
                    }{" "}
                    человек, {detail.assignments.length} назначений документов
                  </summary>
                  <ul>
                    {detail.draft?.items.map((row) => (
                      <li key={row.id}>
                        {row.fullNameRu}:{" "}
                        {row.assignments
                          .map((assignment) =>
                            documentTitle(assignment.templateId),
                          )
                          .join(", ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Link className="button" href={`/requests/${detail.requestId}`}>
                Открыть рабочую заявку и файлы
              </Link>
              {detail.status === "PENDING" &&
                detail.requestedAction === "SAVE" &&
                (detail.reviewUnavailable ||
                  !!detail.review?.issues.length) && (
                  <Notice kind="info">
                    Сохранённая редакция не меняется при появлении новых
                    стандартных значений. Для исправления используется текущая
                    рабочая версия и новая передача директору.
                    <div className="action-buttons">
                      {director && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            void decide(
                              "REJECT",
                              reason.trim() ||
                                "Проверить обязательные данные в актуальном черновике и повторно передать готовый состав.",
                            )
                          }
                        >
                          Вернуть для проверки актуального черновика
                        </button>
                      )}
                      <Link
                        className="button"
                        href={`/requests/${detail.requestId}/edit?check=1`}
                      >
                        Открыть актуальный черновик
                      </Link>
                    </div>
                  </Notice>
                )}
              {detail.requestedAction !== "SAVE" && (
                <Notice kind="info">
                  Запрошено{" "}
                  {detail.requestedAction === "CANCEL"
                    ? "аннулирование выпуска"
                    : "архивирование черновика"}
                  . Основание: {detail.reason || "—"}
                </Notice>
              )}
              {director && (
                <details>
                  <summary>Подробное сравнение сохранённых полей</summary>
                  <p>
                    Это исходные изменения. Общие и рассчитанные значения
                    показаны выше в подготовленных данных.
                  </p>
                  {changes.length ? (
                    <div className="table-scroll">
                      <table className="approval-diff">
                        <thead>
                          <tr>
                            <th>Поле</th>
                            <th>Было</th>
                            <th>Стало</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((change) => (
                            <tr key={change.path}>
                              <th scope="row">{fieldLabel(change.path)}</th>
                              <td>
                                <pre>
                                  {readable(
                                    change.before,
                                    detail.referenceLabels,
                                  )}
                                </pre>
                              </td>
                              <td>
                                <pre>
                                  {readable(
                                    change.after,
                                    detail.referenceLabels,
                                  )}
                                </pre>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>Содержательные поля не изменены.</p>
                  )}
                </details>
              )}
              {detail.decision && (
                <Notice
                  kind={
                    detail.decision.decision === "APPROVE" ? "success" : "info"
                  }
                >
                  {detail.decision.comment} ·{" "}
                  {dateTime(detail.decision.createdAt)}
                </Notice>
              )}
              {director && detail.status === "PENDING" && (
                <div className="approval-decision">
                  <label>
                    Комментарий к решению
                    <textarea
                      value={reason}
                      maxLength={2000}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Для возврата укажите, что нужно исправить"
                    />
                  </label>
                  <div className="action-buttons">
                    <button
                      className="primary"
                      disabled={
                        !!busy ||
                        (detail.requestedAction === "SAVE" &&
                          (detail.reviewUnavailable ||
                            !!detail.review?.issues.length))
                      }
                      onClick={() => void decide("APPROVE")}
                    >
                      {busy === "APPROVE"
                        ? "Согласовываем…"
                        : "Согласовать эту редакцию"}
                    </button>
                    <button
                      disabled={!!busy || !reason.trim()}
                      onClick={() => void decide("REJECT")}
                    >
                      {busy === "REJECT"
                        ? "Возвращаем…"
                        : "Вернуть на доработку"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p>
              {selected
                ? "Загружаем редакцию…"
                : "Выберите заявку для просмотра."}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
