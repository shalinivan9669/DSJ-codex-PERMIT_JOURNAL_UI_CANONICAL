"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, downloadExport, errorText, json } from "@/lib/api";
import type { Artifact, Customer, Draft } from "@/lib/types";

type Clarification = {
  revision: number;
  text: string;
  readyToCopy: boolean;
  items: { sourceRow?: number; personnelNumber?: string; message: string }[];
};
const clarificationLine = (item: Clarification["items"][number]) =>
  [
    item.sourceRow ? `Строка ${item.sourceRow}` : "Получатель",
    item.personnelNumber ? `таб. № ${item.personnelNumber}` : "",
    item.message,
  ]
    .filter(Boolean)
    .join(" — ");
type Sheet = {
  revision: number;
  meaningfulHash: string;
  title: string;
  rows: unknown[];
  confirmations: {
    id: string;
    confirmedBy: string;
    source: string;
    current: boolean;
  }[];
};
type Transfer = {
  id: string;
  action: string;
  createdAt: string;
  metadata: {
    recipient: string;
    occurredOn: string;
    method: string;
    reason?: string;
    files: { id: string; format: string; sha256: string }[];
  };
};
export function CustomerReview({
  draft,
  canManage,
  flush,
}: {
  draft: Draft;
  canManage: boolean;
  flush: () => Promise<number>;
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [person, setPerson] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("EMAIL");
  const [kind, setKind] = useState("TRANSFER");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [clarification, setClarification] = useState<Clarification | null>(
    null,
  );
  const [clarificationText, setClarificationText] = useState("");
  const [omittedIssues, setOmittedIssues] = useState<number[]>([]);
  const [clarificationCustomer, setClarificationCustomer] = useState("");
  const [clarificationCustomers, setClarificationCustomers] = useState<
    Customer[]
  >([]);
  const clarificationCustomerKey = [
    ...new Set(
      draft.items
        .map((item) => item.employerId || draft.customerId)
        .filter(Boolean),
    ),
  ].join("|");
  useEffect(() => {
    if (!open) return;
    let active = true;
    const ids = clarificationCustomerKey.split("|").filter(Boolean);
    void Promise.all(ids.map((id) => api<Customer>(`/customers/${id}`)))
      .then((customers) => {
        if (active) setClarificationCustomers(customers);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [open, clarificationCustomerKey]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      api<Sheet>(`/print-requests/${draft.id}/control-sheet`),
      api<Draft & { artifacts: Artifact[] }>(`/print-requests/${draft.id}`),
      api<{ items: Transfer[] }>(`/print-requests/${draft.id}/transfers`),
    ])
      .then(([s, d, history]) => {
        if (active) {
          setSheet(s);
          setTransfers(history.items);
          setArtifacts(
            (d.artifacts || []).filter(
              (a) => a.issuanceId && a.availability !== "MISSING",
            ),
          );
        }
      })
      .catch((c) => {
        if (active) setError(errorText(c));
      });
    return () => {
      active = false;
    };
  }, [open, draft.id, draft.revision, refresh]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await flush();
      await action();
      setSuccess(message);
      setRefresh((v) => v + 1);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel common-context">
      <div className="toolbar">
        <div>
          <h2>Согласование и передача</h2>
          <span className="muted">
            Контрольный список, уточнения и факт передачи комплекта
          </span>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Свернуть" : "Открыть согласование"}
        </button>
      </div>
      {open && (
        <div className="context-body">
          {error && <Notice>{error}</Notice>}
          {success && <Notice kind="success">{success}</Notice>}
          <div className="toolbar-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    downloadExport(
                      `/print-requests/${draft.id}/control-sheet/export`,
                      { format: "XLSX" },
                      "Данные для проверки.xlsx",
                    ),
                  "Контрольный список подготовлен.",
                )
              }
            >
              Контрольный список XLSX
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    downloadExport(
                      `/print-requests/${draft.id}/control-sheet/export`,
                      { format: "PDF" },
                      "Данные для проверки.pdf",
                    ),
                  "Контрольный список подготовлен.",
                )
              }
            >
              Контрольный список PDF
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const query = clarificationCustomer
                    ? `?customerId=${encodeURIComponent(clarificationCustomer)}`
                    : "";
                  const r = await api<Clarification>(
                    `/print-requests/${draft.id}/clarification${query}`,
                  );
                  setClarification(r);
                  setClarificationText(r.text);
                  setOmittedIssues([]);
                }, "Запрос подготовлен. Проверьте замечания и текст перед копированием.")
              }
            >
              Подготовить запрос уточнений
            </button>
          </div>
          {!!clarificationCustomers.length && (
            <label>
              Организация для запроса уточнений
              <select
                value={clarificationCustomer}
                onChange={(event) => {
                  setClarificationCustomer(event.target.value);
                  setClarification(null);
                  setClarificationText("");
                }}
              >
                <option value="">Внутренняя проверка всего состава</option>
                {clarificationCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.nameRu}
                  </option>
                ))}
              </select>
            </label>
          )}
          {clarification && (
            <div className="clarification-editor">
              {!clarification.readyToCopy && (
                <Notice>
                  В составе несколько работодателей. Выберите одну организацию и
                  подготовьте её отдельный запрос. Общий текст доступен только
                  для внутренней проверки.
                </Notice>
              )}
              {clarification.revision !== draft.revision && (
                <Notice>
                  Данные заявки изменились. Подготовьте актуальный запрос
                  заново.
                </Notice>
              )}
              {clarification.items.map((item, index) => (
                <label className="checkbox-label" key={index}>
                  <input
                    type="checkbox"
                    checked={!omittedIssues.includes(index)}
                    onChange={(event) => {
                      const omitted = event.target.checked
                        ? omittedIssues.filter((value) => value !== index)
                        : [...omittedIssues, index];
                      setOmittedIssues(omitted);
                      const lines = clarification.items
                        .filter((_, i) => !omitted.includes(i))
                        .map(clarificationLine);
                      setClarificationText(
                        lines.length
                          ? `Здравствуйте! Просим уточнить сведения для подготовки документов:\n${lines.join("\n")}\nПришлите, пожалуйста, уточнённые значения. Спасибо!`
                          : "Сейчас уточнений сведений у заказчика не требуется.",
                      );
                    }}
                  />
                  {clarificationLine(item)}
                </label>
              ))}
              <label>
                Текст запроса уточнений
                <textarea
                  rows={8}
                  value={clarificationText}
                  onChange={(event) => setClarificationText(event.target.value)}
                />
              </label>
              <small>
                Изменение выбранных замечаний собирает текст заново. После
                выбора можно отредактировать готовый текст. Копирование не
                отправляет сообщение.
              </small>
              <button
                disabled={
                  busy ||
                  !clarification.readyToCopy ||
                  clarification.revision !== draft.revision ||
                  !clarificationText.trim()
                }
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(clarificationText);
                  }, "Проверенный текст скопирован. Сообщение не отправлялось.")
                }
              >
                Копировать запрос уточнений
              </button>
            </div>
          )}
          <p className="fine-print">
            Контрольный список не является выданным документом. Изменение
            существенных данных делает прежнее согласование неактуальным.
          </p>
          {sheet?.confirmations.map((c) => (
            <p key={c.id}>
              {c.current
                ? "Согласование актуально"
                : "Нужно повторное согласование"}
              : {c.confirmedBy} · {c.source}
            </p>
          ))}
          {canManage && (
            <details>
              <summary>Зафиксировать ответ заказчика</summary>
              <label>
                Кто подтвердил список
                <input
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                />
              </label>
              <label>
                Источник ответа
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Письмо, дата, согласованная версия"
                />
              </label>
              <button
                disabled={busy || !sheet || !person.trim() || !source.trim()}
                onClick={() =>
                  void run(async () => {
                    const current = await api<Sheet>(
                      `/print-requests/${draft.id}/control-sheet`,
                    );
                    if (sheet?.meaningfulHash !== current.meaningfulHash)
                      throw new Error(
                        "Состав изменился. Проверьте новый контрольный список перед подтверждением.",
                      );
                    return api(
                      `/print-requests/${draft.id}/control-sheet/confirm`,
                      {
                        method: "POST",
                        body: json({
                          expectedRevision: current.revision,
                          meaningfulHash: current.meaningfulHash,
                          confirmedBy: person,
                          source,
                        }),
                      },
                    );
                  }, "Согласование текущей версии сохранено.")
                }
              >
                Сохранить подтверждение
              </button>
            </details>
          )}
          {canManage && artifacts.length > 0 && (
            <details>
              <summary>Зафиксировать передачу или повторную печать</summary>
              <p>
                Выберите фактически переданные файлы. Эта запись сама не
                отправляет сообщения заказчику.
              </p>
              {artifacts.map((a) => (
                <label className="checkbox" key={a.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, a.id]
                          : selected.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.fileName || a.filename || a.name || a.format}
                </label>
              ))}
              <div className="form-grid">
                <label>
                  Получатель комплекта
                  <input
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  />
                </label>
                <label>
                  Дата передачи
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  Способ
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="EMAIL">Электронная почта</option>
                    <option value="PORTAL">Кабинет заказчика</option>
                    <option value="PAPER">Бумажные экземпляры</option>
                    <option value="OTHER">Другой согласованный способ</option>
                  </select>
                </label>
                <label>
                  Действие
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="TRANSFER">Передача комплекта</option>
                    <option value="REPRINT_DAMAGED">
                      Перепечатка испорченного экземпляра
                    </option>
                  </select>
                </label>
              </div>
              {kind === "REPRINT_DAMAGED" && (
                <label>
                  Причина перепечатки
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <button
                disabled={
                  busy ||
                  !selected.length ||
                  !person.trim() ||
                  !date ||
                  (kind === "REPRINT_DAMAGED" && !reason.trim())
                }
                onClick={() =>
                  void run(
                    () =>
                      api(`/print-requests/${draft.id}/transfers`, {
                        method: "POST",
                        body: json({
                          artifactIds: selected,
                          recipient: person,
                          occurredOn: date,
                          method,
                          kind,
                          ...(reason ? { reason } : {}),
                        }),
                      }),
                    "Факт передачи сохранён с выбранным составом файлов.",
                  )
                }
              >
                Зафиксировать факт
              </button>
            </details>
          )}
          <details>
            <summary>
              История передачи и перепечатки ({transfers.length})
            </summary>
            {transfers.length ? (
              <ul>
                {transfers.map((transfer) => (
                  <li key={transfer.id}>
                    <strong>
                      {transfer.action === "DAMAGED_COPY_REPRINT"
                        ? "Перепечатка испорченного экземпляра"
                        : "Передача комплекта"}
                    </strong>
                    <p>
                      {transfer.metadata.occurredOn} ·{" "}
                      {transfer.metadata.recipient} ·{" "}
                      {(
                        {
                          EMAIL: "Электронная почта",
                          PORTAL: "Кабинет заказчика",
                          PAPER: "Бумажные экземпляры",
                          OTHER: "Другой согласованный способ",
                        } as Record<string, string>
                      )[transfer.metadata.method] || transfer.metadata.method}
                    </p>
                    {transfer.metadata.reason && (
                      <p>Причина: {transfer.metadata.reason}</p>
                    )}
                    <p>Выбранных файлов: {transfer.metadata.files.length}.</p>
                    <details>
                      <summary>Состав переданного комплекта</summary>
                      <ul>
                        {transfer.metadata.files.map((file) => (
                          <li key={file.id}>
                            <a
                              href={`/api/artifacts/${encodeURIComponent(file.id)}`}
                              download
                            >
                              Скачать сохранённый {file.format}
                            </a>
                            <span className="hash">
                              {" "}
                              SHA-256: {file.sha256}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Передача и перепечатка ещё не зафиксированы.</p>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
