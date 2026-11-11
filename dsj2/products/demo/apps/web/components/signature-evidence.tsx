"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import { documentTitle } from "@/lib/types";
import { signingRole } from "@/lib/signing-flow";
import { isTestSigning } from "@/lib/signing-mode";
import {
  signatureEvidenceOriginalUrl,
  signatureEvidenceReceivedAt,
  type SignatureEvidenceRecord,
} from "@/lib/signature-evidence";
import {
  useCabinetError,
  useCabinetLanguage,
  useCabinetText,
} from "./cabinet-language";

export function SignatureEvidence({
  artifactId,
  timezone,
}: {
  artifactId: string;
  timezone: string;
}) {
  const t = useCabinetLanguage();
  const tr = useCabinetText();
  const [record, setRecord] = useState<SignatureEvidenceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useCabinetError();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setRecord(null);
    setLoading(true);
    setError(null);
    void api<SignatureEvidenceRecord>(
      `/artifacts/${encodeURIComponent(artifactId)}/signature-evidence`,
    )
      .then((value) => {
        if (active) setRecord(value);
      })
      .catch((caught) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifactId, reload, setError]);
  const roleName = (role: string) =>
    ["DIRECTOR", "CHAIR", "MEMBER", "TEACHER"].includes(role)
      ? tr(signingRole(role))
      : role;
  const originalUrl = record
    ? signatureEvidenceOriginalUrl(record.originalDownloadUrl)
    : null;
  return (
    <section className="panel workbench-detail" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h1>{t("Сведения об ЭЦП", "ЭЦҚ туралы мәліметтер")}</h1>
          {record && (
            <p>
              {tr(documentTitle(record.templateId))} · № {record.documentNumber}
            </p>
          )}
        </div>
        <button
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          {t("Обновить", "Жаңарту")}
        </button>
      </div>
      {loading && (
        <p role="status">
          {t(
            "Загружаем сведения о подписях…",
            "Қолтаңбалар туралы мәліметтер жүктелуде…",
          )}
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      {record && (
        <>
          {isTestSigning(record) && (
            <Notice>
              {t(
                "Тестовая ЭЦП. Имена прочитаны из сертификатов в CMS. Проверка НУЦ, сертификатов и личности владельцев не выполнялась.",
                "Тестілік ЭЦҚ. Есімдер CMS ішіндегі сертификаттардан оқылды. ҰКО, сертификаттар және иелерінің жеке басы тексерілмеген.",
              )}
            </Notice>
          )}
          {record.signers.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Подписант", "Қол қоюшы")}</th>
                    <th>{t("Роль", "Рөлі")}</th>
                    <th>
                      {t("Получено системой", "Жүйеге қабылданған уақыт")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {record.signers.map((signer, index) => (
                    <tr key={`${signer.role}:${signer.receivedAt}:${index}`}>
                      <td>
                        <strong>{signer.displayName}</strong>
                        {signer.identityNote && <p>{signer.identityNote}</p>}
                      </td>
                      <td>{roleName(signer.role)}</td>
                      <td>
                        <time dateTime={signer.receivedAt}>
                          {signatureEvidenceReceivedAt(
                            signer.receivedAt,
                            timezone,
                          )}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>
              {t(
                "Электронные подписи ещё не получены.",
                "Электрондық қолтаңбалар әлі алынған жоқ.",
              )}
            </p>
          )}
          {record.pendingRoles.length > 0 && (
            <p>
              <strong>
                {t("Ожидаются подписи", "Күтілетін қолтаңбалар")}:
              </strong>{" "}
              {record.pendingRoles.map(roleName).join(", ")}.
            </p>
          )}
          <p className="fine-print">
            {t(
              "Указано время получения подписи сервером учебного центра.",
              "Оқу орталығының сервері қолтаңбаны алған уақыт көрсетілген.",
            )}
          </p>
          <div className="button-row">
            {originalUrl && (
              <a className="button" href={originalUrl} download>
                {t("Скачать оригинал PDF", "PDF түпнұсқасын жүктеу")}
              </a>
            )}
            <Link href={`/requests/${encodeURIComponent(record.requestId)}`}>
              {t("Открыть документы заявки", "Өтінім құжаттарын ашу")}
            </Link>
          </div>
          <details>
            <summary>{t("Контрольные суммы", "Бақылау сомалары")}</summary>
            <p>
              {t("Оригинал PDF", "PDF түпнұсқасы")} · SHA-256:{" "}
              <span className="hash">{record.sourcePdfSha256}</span>
            </p>
            <p>
              {t("Набор подписей", "Қолтаңбалар жиынтығы")} · SHA-256:{" "}
              <span className="hash">{record.signatureSetHash}</span>
            </p>
          </details>
        </>
      )}
    </section>
  );
}
