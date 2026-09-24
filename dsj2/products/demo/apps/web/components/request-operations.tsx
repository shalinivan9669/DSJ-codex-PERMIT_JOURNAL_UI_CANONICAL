"use client";
import Link from "next/link";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { templateLabels, type Draft, type Recipient } from "@/lib/types";
export function RequestOperations({
  draft,
  selected,
  flush,
  canManage,
}: {
  draft: Draft;
  selected?: Recipient;
  flush: () => Promise<number>;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [source, setSource] = useState("");
  const [version, setVersion] = useState("");
  const [basisDate, setBasisDate] = useState("");
  const [contactAfter, setContactAfter] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [retakeId, setRetakeId] = useState("");
  const [retakeReason, setRetakeReason] = useState("");
  const [retakeDraftId, setRetakeDraftId] = useState("");
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await flush();
      await action();
      setSuccess(message);
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
          <h2>Связанные действия</h2>
          <span className="muted">
            Заказ и повторное обращение используют данные этой заявки
          </span>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Свернуть" : "Открыть действия"}
        </button>
      </div>
      {open && (
        <div className="context-body">
          {error && <Notice>{error}</Notice>}
          {success && (
            <Notice kind="success">
              {success} <Link href="/workbench">Открыть работу центра</Link>
            </Notice>
          )}
          {retakeDraftId && (
            <Notice kind="success">
              Создана отдельная попытка с неподтверждённым результатом.{" "}
              <Link href={`/requests/${retakeDraftId}`}>Открыть пересдачу</Link>
            </Notice>
          )}
          {selected?.assignments
            .filter((a) => a.retakeOf)
            .map((a) => (
              <p key={a.id}>
                Пересдача —{" "}
                <Link href={`/requests/${a.retakeOf!.requestId}`}>
                  предыдущая попытка
                </Link>
                . Основание: {a.retakeOf!.reason}
              </p>
            ))}
          {canManage &&
            !["DRAFT", "CANCELLED"].includes(draft.status) &&
            selected?.assignments.some((a) =>
              ["FAILED", "ABSENT"].includes(a.outcome?.status || ""),
            ) && (
              <details>
                <summary>
                  Создать пересдачу по получателю «{selected.fullNameRu}»
                </summary>
                <p>
                  Создаётся новая заявка и отдельное событие. Предыдущая попытка
                  и её документы сохраняются. Даты и результат новой проверки
                  нужно подтвердить отдельно.
                </p>
                <label>
                  Предыдущая попытка
                  <select
                    value={retakeId}
                    onChange={(e) => setRetakeId(e.target.value)}
                  >
                    <option value="">Выберите попытку</option>
                    {selected.assignments
                      .filter((a) =>
                        ["FAILED", "ABSENT"].includes(a.outcome?.status || ""),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {templateLabels[a.templateId]} ·{" "}
                          {a.outcome?.status === "FAILED"
                            ? "Не сдал"
                            : "Не явился"}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Основание пересдачи
                  <textarea
                    value={retakeReason}
                    onChange={(e) => setRetakeReason(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <button
                  disabled={busy || !retakeId || retakeReason.trim().length < 3}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const expectedRevision = await flush();
                      const next = await api<{ id: string }>(
                        `/print-requests/${draft.id}/retake`,
                        {
                          method: "POST",
                          body: json({
                            expectedRevision,
                            rowId: selected.id,
                            assignmentId: retakeId,
                            reason: retakeReason,
                          }),
                        },
                      );
                      setRetakeDraftId(next.id);
                    } catch (cause) {
                      setError(errorText(cause));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Создать отдельную попытку
                </button>
              </details>
            )}
          {canManage && (
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api("/orders", {
                      method: "POST",
                      body: json({
                        title: draft.title || "Заказ по заявке",
                        customerId: draft.customerId,
                        requestIds: [draft.id],
                      }),
                    }),
                  "Создан заказ со связанной заявкой.",
                )
              }
            >
              Создать связанный заказ
            </button>
          )}
          <p className="fine-print">
            Отдельный заказ нужен, когда требуется вести договорные
            обязательства, передачу комплекта или расчёты. Он не обязателен для
            оформления одного человека.
          </p>
          {canManage && draft.status !== "DRAFT" && selected && (
            <details>
              <summary>
                Повторное обращение по получателю «{selected.fullNameRu}»
              </summary>
              <p>
                Сохраняем возможную потребность для проверки актуальности.
                Подтверждение срока не означает согласие на новый заказ.
              </p>
              <label>
                Исторический документ
                <select
                  value={assignmentId}
                  onChange={(e) => setAssignmentId(e.target.value)}
                >
                  <option value="">Выберите документ</option>
                  {selected.assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {templateLabels[a.templateId]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Источник правила срока
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </label>
                <label>
                  Версия / дата проверки правила
                  <input
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  />
                </label>
                <label>
                  Подтверждённая дата основания
                  <input
                    type="date"
                    value={basisDate}
                    onChange={(e) => setBasisDate(e.target.value)}
                  />
                </label>
                <label>
                  Запланировать обращение
                  <input
                    type="date"
                    value={contactAfter}
                    onChange={(e) => setContactAfter(e.target.value)}
                  />
                </label>
              </div>
              <button
                disabled={
                  busy ||
                  !assignmentId ||
                  !source.trim() ||
                  !version.trim() ||
                  !basisDate
                }
                onClick={() =>
                  void run(
                    () =>
                      api("/renewals", {
                        method: "POST",
                        body: json({
                          customerId: draft.customerId,
                          recipientId: selected.recipientId || null,
                          sourceRequestId: draft.id,
                          sourceRowId: selected.id,
                          assignmentId,
                          policySource: source,
                          policyVersion: version,
                          basisDate,
                          documentValidUntil:
                            selected.assignments.find(
                              (a) => a.id === assignmentId,
                            )?.validUntil || null,
                          contactAfter: contactAfter || null,
                          confirmed: false,
                        }),
                      }),
                    "Потребность добавлена в очередь проверки актуальности.",
                  )
                }
              >
                Добавить в повторные обращения
              </button>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
