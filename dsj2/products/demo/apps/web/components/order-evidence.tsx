"use client";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
export function OrderEvidence({
  orderId,
  canManage,
  onChanged,
  events = [],
  attachments = [],
}: {
  orderId: string;
  canManage: boolean;
  onChanged: () => void;
  events?: { id: string; title: string; requestId: string }[];
  attachments?: {
    id: string;
    fileName: string;
    eventId?: string | null;
    source?: string;
  }[];
}) {
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("SOURCE");
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inventory, setInventory] = useState<{
    missing: { id: string; label: string }[];
    limitation: string;
  } | null>(null);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 1_000_000)
        throw new Error(
          "Размер вложения превышает 1 МБ. Выберите компактный PDF, PNG или JPEG.",
        );
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      await api("/value-attachments", {
        method: "POST",
        body: json({
          orderId,
          ...(eventId ? { eventId } : {}),
          category,
          source,
          fileName: file.name,
          contentBase64,
          customerVisible: false,
        }),
      });
      setSuccess(
        "Основание сохранено отдельно от оригиналов выданных документов.",
      );
      onChanged();
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>Дело заказа и сохранённые основания</summary>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <div className="toolbar-actions">
        <button
          disabled={busy}
          onClick={() =>
            void api<typeof inventory>(`/orders/${orderId}/dossier`)
              .then(setInventory)
              .catch((c) => setError(errorText(c)))
          }
        >
          Проверить комплектность оснований
        </button>
        <a
          className="button"
          href={`/api/orders/${orderId}/dossier/export`}
          download
        >
          Скачать дело заказа ZIP
        </a>
      </div>
      {inventory && (
        <>
          <p>{inventory.limitation}</p>
          {inventory.missing.length ? (
            <ul>
              {inventory.missing.map((m) => (
                <li key={m.id}>{m.label}</li>
              ))}
            </ul>
          ) : (
            <p>
              Не закрытых обязательств по основаниям и результатам в заказе нет.
              Полноту самих обязательств подтверждает ответственный.
            </p>
          )}
        </>
      )}
      {!!attachments.length && (
        <>
          <h4>Сохранённые основания</h4>
          {attachments.map((file) => (
            <p key={file.id}>
              <a href={`/api/value-attachments/${file.id}`} download>
                {file.fileName}
              </a>
              <small style={{ display: "block" }}>
                {file.eventId
                  ? `Событие: ${events.find((e) => e.id === file.eventId)?.title || "связано с заявкой"}`
                  : "Заказ в целом"}
                {file.source ? ` · ${file.source}` : ""}
              </small>
            </p>
          ))}
        </>
      )}
      {canManage && (
        <>
          <label>
            К какому событию относится основание
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              <option value="">К заказу в целом</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Категория вложения
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="SOURCE">Исходное основание</option>
              <option value="SIGNED_SCAN">Подписанный внешний экземпляр</option>
              <option value="MANUAL_RESULT">
                Подтверждённая ведомость результатов
              </option>
              <option value="MATERIAL">Учебный материал</option>
              <option value="HANDOVER">Подтверждение передачи</option>
            </select>
          </label>
          <label>
            Источник и назначение
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            Файл PDF, PNG или JPEG
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            disabled={busy || !file || !source.trim()}
            onClick={() => void upload()}
          >
            Сохранить основание
          </button>
        </>
      )}
    </details>
  );
}
