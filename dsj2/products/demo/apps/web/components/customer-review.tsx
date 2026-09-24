"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, downloadExport, errorText, json } from "@/lib/api";
import type { Artifact, Draft } from "@/lib/types";
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
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      api<Sheet>(`/print-requests/${draft.id}/control-sheet`),
      api<Draft & { artifacts: Artifact[] }>(`/print-requests/${draft.id}`),
    ])
      .then(([s, d]) => {
        if (active) {
          setSheet(s);
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
                  const r = await api<{ text: string }>(
                    `/print-requests/${draft.id}/clarification`,
                  );
                  await navigator.clipboard.writeText(r.text);
                }, "Запрос уточнений скопирован. Отправьте его согласованным способом.")
              }
            >
              Копировать запрос уточнений
            </button>
          </div>
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
        </div>
      )}
    </section>
  );
}
