"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import { Status, lmsError, type Translate } from "./common";
import { PaperSignature } from "./paper-signature";

type DocumentView = {
  link: {
    id: string;
    legalForm: string;
    requestId: string;
    status: string;
    documentType?: string;
    number?: string | null;
  };
  artifacts: { id: string; kind: string; fileName: string; mimeType: string }[];
  status: string;
  reason?: string;
};
export function LmsDocument({
  id,
  learner = false,
  canPrepare = !learner,
  canAttest = false,
  onChanged,
  t,
}: {
  id: string;
  learner?: boolean;
  canPrepare?: boolean;
  canAttest?: boolean;
  onChanged?: () => void;
  t: Translate;
}) {
  const [data, setData] = useState<DocumentView | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const base = learner ? "learn" : "lms";
  useEffect(() => {
    let alive = true;
    void api<DocumentView>(`/${base}/documents/${id}`)
      .then((value) => {
        if (alive) {
          setData(value);
          setError("");
        }
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      });
    return () => {
      alive = false;
    };
  }, [id, base, refresh]);
  if (error)
    return (
      <Notice>
        {error}
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
      <div className="lms-actions">
        {data.artifacts.map((artifact) => (
          <a
            className="button"
            key={artifact.id}
            href={`/api/${base}/artifacts/${artifact.id}`}
            download
          >
            {t("Скачать", "Жүктеу")}{" "}
            {artifact.mimeType.includes("pdf")
              ? "PDF"
              : artifact.fileName.split(".").pop()?.toUpperCase()}
          </a>
        ))}
        {canPrepare && !data.artifacts.length && (
          <Link className="button" href={`/requests/${data.link.requestId}`}>
            {t("Открыть подготовку", "Дайындауды ашу")}
          </Link>
        )}
      </div>
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
