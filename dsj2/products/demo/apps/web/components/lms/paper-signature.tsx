"use client";
import { useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { Status, lmsError, type Translate } from "./common";

type PaperRecord = {
  category: string;
  signedAt: string;
  signerNames: string[];
  reason: string;
};
type SigningDocument = {
  documentId: string;
  templateId: string;
  number: string;
  artifactId: string | null;
  legalForm: string | null;
  paperSignature: PaperRecord | null;
  requiredSigners: { displayName: string }[];
};
export function PaperSignature({
  requestId,
  documentType,
  number,
  t,
  onSaved,
}: {
  requestId: string;
  documentType?: string;
  number?: string | null;
  t: Translate;
  onSaved: () => void;
}) {
  const [document, setDocument] = useState<SigningDocument | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedAt, setSignedAt] = useState("");
  const [names, setNames] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function load() {
    try {
      const value = await api<{ documents: SigningDocument[] }>(
        `/print-requests/${requestId}/signing`,
      );
      const templateId = (
        {
          PROTOCOL: "lms-protocol",
          CERTIFICATE: "lms-certificate",
          CREDENTIAL: "lms-credential",
        } as Record<string, string>
      )[documentType || ""];
      const current = value.documents.find(
        (item) =>
          item.templateId === templateId && (!number || item.number === number),
      );
      if (current) {
        setDocument(current);
        if (!names)
          setNames(
            current.requiredSigners.map((item) => item.displayName).join("\n"),
          );
      }
      setError("");
    } catch (caught) {
      setError(lmsError(caught, t));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !document) return;
    setBusy(true);
    setError("");
    try {
      await api(`/print-requests/${requestId}/paper-signatures`, {
        method: "POST",
        body: json({
          documentIds: [document.documentId],
          signedAt,
          signerNames: names
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean),
          reason,
          allRequiredSignaturesPresent: confirmed,
        }),
      });
      await load();
      onSaved();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>
        {t("Подписи на бумажном оригинале", "Қағаз түпнұсқадағы қолдар")}
      </summary>
      {error && <Notice>{error}</Notice>}
      {document?.paperSignature ? (
        <p>
          <Status value={document.paperSignature.category} t={t} /> ·{" "}
          {document.paperSignature.signedAt}
          <br />
          {document.paperSignature.signerNames.join(", ")}
        </p>
      ) : document?.artifactId ? (
        <form onSubmit={submit}>
          <div className="lms-fields">
            <label>
              {t("Дата подписания", "Қол қойылған күн")}
              <input
                required
                type="date"
                value={signedAt}
                onChange={(event) => setSignedAt(event.target.value)}
              />
            </label>
            <label>
              {t(
                "ФИО подписавших, по одному в строке",
                "Қол қойғандардың аты-жөні, әр жолға біреу",
              )}
              <textarea
                required
                rows={3}
                value={names}
                onChange={(event) => setNames(event.target.value)}
              />
            </label>
          </div>
          <label>
            {t("Основание проверки оригинала", "Түпнұсқаны тексеру негізі")}
            <textarea
              required
              minLength={3}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="lms-inline-label">
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
          <button className="primary" disabled={busy}>
            {t("Зафиксировать бумажные подписи", "Қағаздағы қолдарды тіркеу")}
          </button>
        </form>
      ) : (
        <p>
          {t(
            "Сначала дождитесь подготовки документа.",
            "Алдымен құжаттың дайындалуын күтіңіз.",
          )}
        </p>
      )}
    </details>
  );
}
