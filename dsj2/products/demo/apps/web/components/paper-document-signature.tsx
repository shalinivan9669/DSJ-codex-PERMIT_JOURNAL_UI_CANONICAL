"use client";

import { useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { useCabinetError, useCabinetLanguage } from "./cabinet-language";

/** Observed paper signatures are recorded separately from verified digital signatures. */
export function PaperDocumentSignature({
  requestId,
  documentId,
  documentDate,
  onSaved,
}: {
  requestId: string;
  documentId: string;
  documentDate?: string;
  onSaved: () => Promise<void>;
}) {
  const t = useCabinetLanguage();
  const [signedAt, setSignedAt] = useState("");
  const [names, setNames] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useCabinetError();
  const submitting = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!saved) {
        await api(`/print-requests/${requestId}/paper-signatures`, {
          method: "POST",
          body: json({
            documentIds: [documentId],
            signedAt,
            signerNames: names
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean),
            reason,
            allRequiredSignaturesPresent: confirmed,
          }),
        });
        setSaved(true);
      }
      await onSaved();
    } catch (caught) {
      setError(caught);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <details className="paper-document-signature">
      <summary>
        {t("Оформить с подписями на бумаге", "Қағаздағы қолдармен рәсімдеу")}
      </summary>
      <p className="muted">
        {t(
          "Распечатайте документ, получите подписи и проверьте оригинал. Здесь сохраняется отметка руководителя о бумажном подписании; она не является ЭЦП.",
          "Құжатты басып шығарып, қолдарды жинап, түпнұсқаны тексеріңіз. Мұнда басшының қағаздағы қолдар туралы белгісі сақталады; бұл ЭЦҚ емес.",
        )}
      </p>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">
          {t(
            "Бумажные подписи сохранены. Обновите сведения о выпуске.",
            "Қағаздағы қолдар сақталды. Шығарылым мәліметтерін жаңартыңыз.",
          )}
        </Notice>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy || saved}>
          <label>
            {t("Дата подписания", "Қол қойылған күн")}
            <input
              required
              type="date"
              min={documentDate}
              value={signedAt}
              onChange={(event) => setSignedAt(event.target.value)}
            />
          </label>
          <label>
            {t(
              "ФИО директора, председателя и преподавателя — в этом порядке, по одному в строке",
              "Директордың, төрағаның және оқытушының аты-жөні — осы ретпен, әр жолға біреу",
            )}
            <textarea
              required
              rows={3}
              maxLength={900}
              value={names}
              onChange={(event) => setNames(event.target.value)}
            />
          </label>
          <label>
            {t("Основание проверки оригинала", "Түпнұсқаны тексеру негізі")}
            <textarea
              required
              minLength={3}
              maxLength={2000}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              required
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t(
              "Проверены все обязательные подписи на бумажном оригинале",
              "Қағаз түпнұсқадағы барлық міндетті қолдар тексерілді",
            )}
          </label>
        </fieldset>
        <button disabled={busy} type="submit">
          {busy
            ? t("Сохраняем…", "Сақталуда…")
            : saved
              ? t("Обновить сведения", "Мәліметтерді жаңарту")
              : t(
                  "Зафиксировать бумажные подписи",
                  "Қағаздағы қолдарды тіркеу",
                )}
        </button>
      </form>
    </details>
  );
}
