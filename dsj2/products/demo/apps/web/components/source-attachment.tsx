"use client";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
export type SourceAttachmentRecord = {
  id: string;
  fileName: string;
  category: string;
  customerVisible: boolean;
};
export function SourceAttachment({
  owner,
  attachments = [],
  canManage,
  canShare,
  onChanged,
}: {
  owner: { evidenceId: string } | { dossierId: string };
  attachments?: SourceAttachmentRecord[];
  canManage: boolean;
  canShare: boolean;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 1048576)
        throw new Error("Размер вложения — не более 1 МБ.");
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsDataURL(file);
      });
      await api("/value-attachments", {
        method: "POST",
        body: json({
          ...owner,
          category: "SOURCE",
          source,
          fileName: file.name,
          contentBase64,
          customerVisible: canShare && visible,
        }),
      });
      setFile(null);
      setSource("");
      setVisible(false);
      onChanged();
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Файлы источника ({attachments.length})</summary>
      {error && <Notice>{error}</Notice>}
      {attachments.map((file) => (
        <p key={file.id}>
          <a href={`/api/value-attachments/${file.id}`} download>
            {file.fileName}
          </a>
          <small>
            {file.customerVisible
              ? "Разрешён для выбранного досье заказчика"
              : "Внутренний документ центра"}
          </small>
        </p>
      ))}
      {canManage && (
        <>
          <label>
            Источник вложения
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <label>
            PDF, PNG или JPEG до 1 МБ
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {canShare && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Разрешить это вложение в выбранном пакете заказчика
            </label>
          )}
          <button
            disabled={busy || !file || !source.trim()}
            onClick={() => void upload()}
          >
            Сохранить файл источника
          </button>
        </>
      )}
    </details>
  );
}
