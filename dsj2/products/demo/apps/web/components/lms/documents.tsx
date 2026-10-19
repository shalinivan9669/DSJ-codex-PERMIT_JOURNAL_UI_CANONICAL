"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { LmsErrorDiagnostic, Status, lmsError, type Translate } from "./common";
import { PaperSignature } from "./paper-signature";

type DocumentView = {
  link: {
    id: string;
    legalForm: string;
    requestId: string;
    status: string;
    documentType?: string;
    number?: string | null;
    verificationRevokedAt?: string | null;
    verificationExpiresAt?: string | null;
    verificationManaged?: boolean;
  };
  artifacts: { id: string; kind: string; fileName: string; mimeType: string }[];
  status: string;
  reason?: string;
  verification?: { url: string; qrDataUrl: string } | null;
  origin?: {
    enrollmentId: string;
    groupId: string | null;
    sourceOrderId: string | null;
    sourceRequestId: string | null;
  };
};
function documentNextStep(status: string, t: Translate) {
  const steps: Record<string, [string, string]> = {
    AWAITING_APPROVAL: [
      "Директору нужно согласовать подготовку документа.",
      "Директор құжат дайындауды келісуі керек.",
    ],
    AWAITING_SIGNATURE: [
      "Уполномоченному подписанту нужно подтвердить требуемую подпись.",
      "Уәкілетті қол қоюшы қажетті қолтаңбаны растауы керек.",
    ],
    PREPARING: [
      "Файлы формируются. Готовый документ появится здесь.",
      "Файлдар жасалуда. Дайын құжат осы жерде пайда болады.",
    ],
    NEEDS_REVIEW: [
      "Центру нужно устранить ошибку подготовки в карточке документа.",
      "Орталық құжат картасындағы дайындау қатесін түзетуі керек.",
    ],
    REJECTED: [
      "Центру нужно исправить причину отказа и повторно передать документ на согласование.",
      "Орталық бас тарту себебін түзетіп, құжатты келісуге қайта жіберуі керек.",
    ],
    VOIDED: [
      "Документ аннулирован. Центр рассматривает основание нового выпуска.",
      "Құжаттың күші жойылды. Орталық жаңадан беру негізін қарайды.",
    ],
    SUPERSEDED: [
      "Документ заменён. Откройте текущий результат обучения.",
      "Құжат ауыстырылды. Ағымдағы оқу нәтижесін ашыңыз.",
    ],
  };
  return steps[status] ? t(...steps[status]) : null;
}
export function LmsDocument({
  id,
  learner = false,
  canPrepare = !learner,
  canAttest = false,
  revision = 0,
  onChanged,
  t,
}: {
  id: string;
  learner?: boolean;
  canPrepare?: boolean;
  canAttest?: boolean;
  revision?: number;
  onChanged?: () => void;
  t: Translate;
}) {
  const [data, setData] = useState<DocumentView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationExpiry, setPublicationExpiry] = useState("");
  async function changePublication(action: "REVOKE" | "SET_EXPIRY") {
    setPublicationBusy(true);
    try {
      await api(`/lms/documents/${id}/verification`, {
        method: "POST",
        body: json({
          action,
          ...(action === "SET_EXPIRY"
            ? {
                expiresAt: publicationExpiry
                  ? new Date(publicationExpiry).toISOString()
                  : null,
              }
            : {}),
        }),
      });
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setPublicationBusy(false);
    }
  }
  const base = learner ? "learn" : "lms";
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setRefresh((value) => value + 1);
    };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  useEffect(() => {
    let alive = true;
    void api<DocumentView>(`/${base}/documents/${id}`)
      .then((value) => {
        if (alive) {
          setData(value);
          const expiry = value.link.verificationExpiresAt;
          if (expiry) {
            const date = new Date(expiry);
            setPublicationExpiry(
              new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16),
            );
          } else setPublicationExpiry("");
          setError(null);
        }
      })
      .catch((caught) => {
        if (alive) setError(caught);
      });
    return () => {
      alive = false;
    };
  }, [id, base, refresh, revision]);
  if (error)
    return (
      <Notice>
        {lmsError(error, t)}
        <LmsErrorDiagnostic error={error} t={t} />
        <button onClick={() => setRefresh((v) => v + 1)}>
          {t("Повторить", "Қайталау")}
        </button>
      </Notice>
    );
  if (!data)
    return <p aria-busy="true">{t("Открываем документ…", "Құжат ашылуда…")}</p>;
  return (
    <article className="lms-panel">
      {data.link.documentType && (
        <h3>
          <Status value={data.link.documentType} t={t} />
          {data.link.number && <> · {data.link.number}</>}
        </h3>
      )}
      <p>
        <Status value={data.link.legalForm} t={t} /> ·{" "}
        <Status value={data.status || data.link.status} t={t} />
      </p>
      {data.reason && <p>{data.reason}</p>}
      {data.verification && (
        <details>
          <summary>
            {t("Показать QR документа", "Құжаттың QR кодын көрсету")}
          </summary>
          {/* The local API supplies the QR for this authorized immutable URL. */}
          <img
            src={data.verification.qrDataUrl}
            width={240}
            height={240}
            style={{ maxWidth: "100%", height: "auto" }}
            alt={t(
              "QR для проверки документа",
              "Құжатты тексеруге арналған QR",
            )}
          />
          <p>
            <a href={data.verification.url} target="_blank" rel="noreferrer">
              {t("Проверить запись в реестре", "Тізілімдегі жазбаны тексеру")}
            </a>
          </p>
        </details>
      )}
      {canPrepare &&
        data.link.verificationManaged &&
        data.status === "ISSUED" &&
        !data.link.verificationRevokedAt && (
          <details>
            <summary>{t("Доступ по QR", "QR арқылы қолжетімділік")}</summary>
            <label>
              {t("Действует до", "Қолданылу мерзімі")}
              <input
                type="datetime-local"
                value={publicationExpiry}
                onChange={(event) => setPublicationExpiry(event.target.value)}
              />
            </label>
            <div className="lms-actions">
              <button
                disabled={publicationBusy}
                onClick={() => void changePublication("SET_EXPIRY")}
              >
                {t("Сохранить срок", "Мерзімді сақтау")}
              </button>
              <button
                disabled={publicationBusy}
                onClick={() => void changePublication("REVOKE")}
              >
                {t("Закрыть публичный доступ", "Жалпы қолжетімділікті жабу")}
              </button>
            </div>
          </details>
        )}
      {canPrepare && data.link.verificationRevokedAt && (
        <p>
          {t(
            "Публичный доступ по QR закрыт",
            "QR арқылы жалпы қолжетімділік жабық",
          )}
        </p>
      )}
      {documentNextStep(data.status, t) && (
        <p>{documentNextStep(data.status, t)}</p>
      )}
      <div className="lms-actions">
        {data.artifacts.map((artifact) => (
          <a
            className="button"
            key={artifact.id}
            href={`/api/${base}/artifacts/${artifact.id}`}
            download
          >
            {data.status === "ISSUED"
              ? t("Скачать", "Жүктеу")
              : t("Скачать проект / архив", "Жобаны / мұрағатты жүктеу")}{" "}
            {artifact.mimeType.includes("pdf")
              ? "PDF"
              : artifact.fileName.split(".").pop()?.toUpperCase()}
          </a>
        ))}
        {data.artifacts
          .filter((artifact) => artifact.mimeType.includes("pdf"))
          .map((artifact) => (
            <a
              key={`preview-${artifact.id}`}
              href={`/api/${base}/artifacts/${artifact.id}?inline=1`}
              target="_blank"
              rel="noreferrer"
            >
              {t("Просмотр и печать PDF", "PDF қарау және басып шығару")}
            </a>
          ))}
        {canPrepare && (
          <Link className="button" href={`/requests/${data.link.requestId}`}>
            {data.status === "ISSUED"
              ? t("Карточка документа", "Құжат картасы")
              : t("Открыть подготовку", "Дайындауды ашу")}
          </Link>
        )}
      </div>
      {data.origin && (
        <div className="lms-actions">
          <Link
            href={
              learner
                ? `/learn/${data.origin.enrollmentId}`
                : `/lms/results?enrollmentId=${data.origin.enrollmentId}`
            }
          >
            {t("К результату обучения", "Оқу нәтижесіне")}
          </Link>
          {canPrepare && data.origin.sourceOrderId && (
            <Link href={`/workbench?orderId=${data.origin.sourceOrderId}`}>
              {t("К заказу", "Тапсырысқа")}
            </Link>
          )}
        </div>
      )}
      {canAttest &&
        data.link.legalForm === "PAPER_ORIGINAL" &&
        !["VOIDED", "SUPERSEDED"].includes(data.status) && (
          <PaperSignature
            requestId={data.link.requestId}
            documentType={data.link.documentType}
            number={data.link.number}
            t={t}
            onSaved={() => {
              setRefresh((value) => value + 1);
              onChanged?.();
            }}
          />
        )}
    </article>
  );
}
