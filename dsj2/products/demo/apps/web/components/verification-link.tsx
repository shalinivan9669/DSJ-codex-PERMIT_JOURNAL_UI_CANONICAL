"use client";
import { useCabinetText, useCabinetError } from "./cabinet-language";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { templateLabels } from "@/lib/types";
export function VerificationLink({
  documents,
}: {
  documents: { id: string; number: string; templateId: string }[];
}) {
  const tr = useCabinetText();
  const [documentId, setDocumentId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useCabinetError();
  const [result, setResult] = useState<{
    id: string;
    path: string;
    qrDataUrl?: string;
  } | null>(null);
  const [revoked, setRevoked] = useState(false);
  return (
    <details className="outcome-entry">
      <summary>{tr("Ссылка и QR для проверки записи")}</summary>
      {error && <Notice>{error}</Notice>}
      <p>
        {tr("Открывает минимальную запись эмитента с номером и состоянием документа. ФИО и весь комплект по ссылке не публикуются.")}</p>
      <label>
        {tr("Выданный документ")}<select
          value={documentId}
          onChange={(e) => {
            setDocumentId(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">{tr("Выберите документ")}</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {tr(templateLabels[d.templateId] || d.templateId)} · № {d.number}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {tr("Разрешаю публичную проверку выбранной записи эмитента")}</label>
      <button
        disabled={busy || !documentId || !confirmed}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const value = await api<{
              id: string;
              path: string;
              qrDataUrl?: string;
            }>("/verification-links", {
              method: "POST",
              body: json({ documentId, publicationConfirmed: true }),
            });
            setResult(value);
            setRevoked(false);
            setConfirmed(false);
          } catch (c) {
            setError(c);
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr("Создать ссылку и QR")}</button>
      {result && !revoked && (
        <div className="verification-result">
          <p>
            {tr("Сохраните ссылку: секретная часть показывается только после создания.")}</p>
          <a href={result.path} target="_blank" rel="noreferrer">
            {tr("Открыть публичную проверку")}</a>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(new URL(result.path, window.location.origin).href)
                .catch(() =>
                  setError(
                    "Буфер обмена недоступен. Откройте ссылку и скопируйте адрес.",
                  ),
                )
            }
          >
            {tr("Копировать ссылку")}</button>
          {result.qrDataUrl && (
            <>
              <img
                className="verification-qr"
                src={result.qrDataUrl}
                alt={tr("QR для проверки записи эмитента")}
                width={240}
                height={240}
              />
              <a
                className="button"
                href={result.qrDataUrl}
                download={tr("QR-проверка-записи.png")}
              >
                {tr("Скачать QR")}</a>
            </>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/verification-links/${result.id}/revoke`, {
                  method: "POST",
                  body: "{}",
                });
                setRevoked(true);
              } catch (c) {
                setError(c);
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr("Отозвать публичную ссылку")}</button>
        </div>
      )}
      {revoked && (
        <Notice kind="success">
          {tr("Ссылка отозвана. Публичная проверка по ней недоступна.")}</Notice>
      )}
      <p className="fine-print">
        {tr("QR не является ЭЦП или государственным реестром и не подтверждает неизменность изменённого DOCX.")}</p>
    </details>
  );
}
