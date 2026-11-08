"use client";

import { useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { ApiError, api, json } from "@/lib/api";
import {
  paperSignerDefaults,
  signingRole,
  type SigningPerson,
} from "@/lib/signing-flow";
import { useCabinetError, useCabinetLanguage } from "./cabinet-language";

/** Observed paper signatures are recorded separately from verified digital signatures. */
export function PaperDocumentSignature({
  requestId,
  documentId,
  documentDate,
  requiredSigners = [],
  disabled = false,
  onSaved,
}: {
  requestId: string;
  documentId: string;
  documentDate?: string;
  requiredSigners?: SigningPerson[];
  disabled?: boolean;
  onSaved: () => Promise<void>;
}) {
  const t = useCabinetLanguage();
  const [signedAt, setSignedAt] = useState("");
  const [names, setNames] = useState(() =>
    paperSignerDefaults(requiredSigners),
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useCabinetError();
  const submitting = useRef(false);
  const pendingBody = useRef<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || disabled) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!saved) {
        pendingBody.current ||= json({
          documentIds: [documentId],
          signedAt,
          signerNames: names.map((value) => value.trim()),
          reason,
          allRequiredSignaturesPresent: confirmed,
        });
        try {
          await api(`/print-requests/${requestId}/paper-signatures`, {
            method: "POST",
            body: pendingBody.current,
          });
        } catch (caught) {
          if (
            caught instanceof ApiError &&
            (caught.status === 0 || caught.status >= 500)
          )
            setUncertain(true);
          else {
            pendingBody.current = null;
            setUncertain(false);
          }
          throw caught;
        }
        setSaved(true);
        setUncertain(false);
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
          "Подтвердите подписи на бумажном оригинале. Это не ЭЦП.",
          "Қағаз түпнұсқадағы қолдарды растаңыз. Бұл ЭЦҚ емес.",
        )}
      </p>
      {error && <Notice>{error}</Notice>}
      {uncertain && (
        <p>
          {t(
            "Сохранение не подтверждено. Нажмите «Проверить сохранение».",
            "Сақтау расталмады. «Сақталуын тексеру» түймесін басыңыз.",
          )}
        </p>
      )}
      {saved && (
        <Notice kind="success">
          {t(
            "Бумажные подписи сохранены. Обновите сведения о выпуске.",
            "Қағаздағы қолдар сақталды. Шығарылым мәліметтерін жаңартыңыз.",
          )}
        </Notice>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy || saved || uncertain || disabled}>
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

          {["DIRECTOR", "CHAIR", "TEACHER"].map((kind, index) => (
            <label key={kind}>
              {t(
                signingRole(kind),
                ["Директор", "Комиссия төрағасы", "Оқытушы"][index],
              )}{" "}
              — {t("ФИО на оригинале", "Түпнұсқадағы аты-жөні")}
              <input
                required
                minLength={2}
                maxLength={300}
                value={names[index]}
                onChange={(event) =>
                  setNames((current) =>
                    current.map((name, slot) =>
                      slot === index ? event.target.value : name,
                    ),
                  )
                }
              />
            </label>
          ))}
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
        <button disabled={busy || disabled} type="submit">
          {busy
            ? t("Сохраняем…", "Сақталуда…")
            : saved
              ? t("Обновить сведения", "Мәліметтерді жаңарту")
              : uncertain
                ? t("Проверить сохранение", "Сақталуын тексеру")
                : t(
                    "Зафиксировать бумажные подписи",
                    "Қағаздағы қолдарды тіркеу",
                  )}
        </button>
      </form>
    </details>
  );
}
