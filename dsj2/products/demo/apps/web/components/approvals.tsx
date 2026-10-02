"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext, Draft, Page, Role } from "@/lib/types";
import { dateTime, Status } from "./request-list";
import { templateLabels } from "@/lib/types";
import { validationErrors } from "@/lib/validation-errors";

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
  const approval = draft.approval;
  if (!approval && draft.status !== "DRAFT") return null;
  return (
    <section className="approval-banner" aria-label="Согласование заявки">
      <div className="approval-summary">
        <strong>
          {approval?.status === "APPROVED"
            ? "Редакция согласована директором"
            : approval?.status === "REJECTED"
              ? "Директор вернул редакцию на доработку"
              : "Рабочая версия ожидает согласования"}
        </strong>
        {approval && <Status value={approval.status} />}
      </div>
      <p>
        {approval?.status === "APPROVED"
          ? "Можно подготовить окончательные документы к подписанию. Новые изменения потребуют нового решения."
          : "Введённые сведения сохранены отдельно. Действующая заявка изменится после решения директора."}
      </p>
      {!compact && (
        <div className="action-buttons">
          {approval && (
            <Link
              className="button"
              href={`/approvals?proposal=${encodeURIComponent(approval.proposalId)}`}
            >
              {role === "DIRECTOR"
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
  const director = context.user.role === "DIRECTOR";
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
          }
        })
        .catch((caught) => {
          if (active) setError(errorText(caught));
        });
    return () => {
      active = false;
    };
  }, [selected, refresh]);
  async function decide(decision: "APPROVE" | "REJECT") {
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
              ? "Проверьте предложенную редакцию и примите решение. Подписание готовых документов выполняется в заявке."
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
                    {typeof issue === "string" ? issue : issue.message}
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
            {context.user.role === "ADMIN" && (
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
              <Link className="button" href={`/requests/${detail.requestId}`}>
                Открыть заявку и предпросмотр
              </Link>
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
                <>
                  <h3>Предлагаемые изменения</h3>
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
                </>
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
                      disabled={!!busy}
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
