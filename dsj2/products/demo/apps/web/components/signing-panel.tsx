"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, downloadArtifact, errorText, json } from "@/lib/api";
import { documentTitle, type Issuance } from "@/lib/types";
import { signWithNCALayer } from "@/lib/ncalayer";

type Provider = "EGOV_QR" | "NCALAYER";
type SigningState = {
  issuanceId?: string;
  status: string | null;
  archived: boolean;
  providers: Record<Provider, { available: boolean; reason?: string | null }>;
  documents: {
    documentId: string;
    templateId: string;
    rowId?: string | null;
    groupEventId?: string | null;
    number: string;
    artifactId: string | null;
    complete: boolean;
    requiredSigners: {
      kind: string;
      displayName: string;
      canSign: boolean;
      signed: boolean;
    }[];
  }[];
  missingBindings: string[];
};
type Session = {
  id: string;
  provider: Provider;
  dataBase64?: string;
  signingUrl?: string;
  qrUrl?: string;
  qrDataUrl?: string;
  ncalayerRequest?: { args: { signerParams: { iin?: string; bin?: string } } };
};

export function SigningPanel({
  requestId,
  issuances = [],
  role,
  onChanged,
}: {
  requestId: string;
  issuances?: Pick<Issuance, "id" | "createdAt">[];
  role: string;
  onChanged: () => void;
}) {
  const [state, setState] = useState<SigningState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [success, setSuccess] = useState("");
  const [selectedIssuanceId, setSelectedIssuanceId] = useState("");
  const loadScope = useRef(0);
  const stages = useMemo(
    () => [...issuances].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [issuances],
  );
  const latestIssuanceId = stages[0]?.id;
  const signingPath = `/print-requests/${requestId}/signing${selectedIssuanceId ? `?issuanceId=${encodeURIComponent(selectedIssuanceId)}` : ""}`;
  const load = useCallback(async () => {
    const scope = loadScope.current;
    const value = await api<SigningState>(signingPath);
    if (scope === loadScope.current) setState(value);
  }, [signingPath]);
  useEffect(() => {
    let active = true;
    const scope = ++loadScope.current;
    setState(null);
    setError("");
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api<SigningState>(signingPath);
        if (!active || scope !== loadScope.current) return;
        setState(value);
        if (
          value.status === "RENDERING" ||
          value.status === "AWAITING_SIGNATURE"
        )
          timer = setTimeout(() => void poll(), 10000);
      } catch (caught) {
        if (active && scope === loadScope.current) setError(errorText(caught));
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      if (scope === loadScope.current) loadScope.current++;
    };
  }, [signingPath, latestIssuanceId]);
  async function complete(value: Session, signatureBase64?: string) {
    await api(`/signing/${value.id}/complete`, {
      method: "POST",
      body: json(signatureBase64 ? { signatureBase64 } : {}),
    });
    setSession(null);
    setSuccess("ЭЦП проверена и сохранена для этого документа.");
    await load();
    onChanged();
  }
  async function start(artifactId: string, provider: Provider) {
    setBusy(artifactId);
    setError("");
    setSuccess("");
    try {
      const value = await api<Session>(
        `/print-requests/${requestId}/signing/start`,
        { method: "POST", body: json({ artifactId, provider }) },
      );
      if (provider === "NCALAYER") {
        if (!value.dataBase64)
          throw new Error("Сервер не передал документ для подписания.");
        const signature = await signWithNCALayer({
          dataBase64: value.dataBase64,
          ...value.ncalayerRequest?.args.signerParams,
        });
        await complete(value, signature);
      } else setSession(value);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel signing-panel">
      <div className="section-heading">
        <h2>Подписание документов</h2>
        <button
          disabled={!!busy || !!session}
          onClick={() =>
            void load().catch((caught) => setError(errorText(caught)))
          }
        >
          Обновить
        </button>
      </div>
      {stages.length > 1 && (
        <label>
          Выпуск для подписания
          <select
            value={selectedIssuanceId || latestIssuanceId}
            disabled={!!busy || !!session}
            onChange={(event) => {
              loadScope.current++;
              setState(null);
              setError("");
              setSuccess("");
              setSelectedIssuanceId(event.target.value);
            }}
          >
            {stages.map((stage, index) => (
              <option key={stage.id} value={stage.id}>
                Выпуск {stages.length - index}
                {stage.createdAt
                  ? ` · ${new Date(stage.createdAt).toLocaleString("ru-RU")}`
                  : ""}
                {index === 0 ? " · последний" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {!state && <p role="status">Проверяем готовность документов…</p>}
      {state?.status === "LEGACY_ISSUED" && (
        <p>
          Ранее оформленный комплект. Сведения о проверенной ЭЦП в этой версии
          системы отсутствуют.
        </p>
      )}
      {state?.status === "RENDERING" && (
        <p role="status">
          Готовятся окончательные файлы с присвоенными номерами. Подписание
          станет доступно после подготовки.
        </p>
      )}
      {state?.status === "FAILED" && (
        <Notice>
          Часть файлов не подготовлена. Проверьте задания в разделе файлов и
          повторите неудавшееся формирование.
        </Notice>
      )}
      {state?.status === "ISSUED" && (
        <Notice kind="success">
          {state.archived
            ? "Все необходимые подписи проверены. Комплект выдан и автоматически помещён в архив."
            : "Все необходимые подписи этого выпуска проверены. Заявка остаётся доступной до завершения всех её выпусков и обучений."}
        </Notice>
      )}
      {state && !["LEGACY_ISSUED", "ISSUED"].includes(state.status || "") && (
        <>
          <p>
            Каждый подписант подписывает окончательный PDF своим ключом. После
            проверки всех подписей этот выпуск будет выдан. Заявка попадёт в
            архив после завершения всех её обучений и выпусков.
          </p>
          {!state.providers.EGOV_QR.available && (
            <p className="muted">
              eGov Mobile: {state.providers.EGOV_QR.reason}
            </p>
          )}
          {!state.providers.NCALAYER.available && (
            <p className="muted">NCALayer: {state.providers.NCALAYER.reason}</p>
          )}
          {state.missingBindings.length > 0 && (
            <Notice>
              Директору нужно настроить подписантов ЭЦП:{" "}
              {[...new Set(state.missingBindings)].join(", ")}.
            </Notice>
          )}
        </>
      )}
      <div className="signing-documents">
        {state?.documents.map((document) => (
          <article key={document.documentId} className="signing-document">
            <h3>
              {documentTitle(
                document.templateId,
                document.groupEventId
                  ? true
                  : document.rowId
                    ? false
                    : undefined,
              )}{" "}
              · № {document.number}
            </h3>
            <ul>
              {document.requiredSigners.map((signer, index) => (
                <li key={`${signer.kind}-${index}`}>
                  {signer.displayName} —{" "}
                  {signer.signed ? "подпись проверена" : "ожидает подписи"}
                  {signer.canSign && !signer.signed ? " (ваша подпись)" : ""}
                </li>
              ))}
            </ul>
            <div className="button-row">
              {document.artifactId && (
                <button
                  disabled={!!busy}
                  onClick={() =>
                    void downloadArtifact(
                      document.artifactId!,
                      `${document.number}.pdf`,
                    ).catch((caught) => setError(errorText(caught)))
                  }
                >
                  Скачать PDF
                </button>
              )}
              {role !== "VIEWER" &&
                document.artifactId &&
                document.requiredSigners.some(
                  (signer) => signer.canSign && !signer.signed,
                ) &&
                state.status === "AWAITING_SIGNATURE" && (
                  <>
                    <button
                      className="primary"
                      disabled={!!busy || !state.providers.EGOV_QR.available}
                      onClick={() =>
                        void start(document.artifactId!, "EGOV_QR")
                      }
                    >
                      {busy === document.artifactId
                        ? "Подписание…"
                        : "Подписать через eGov Mobile"}
                    </button>
                    <button
                      disabled={!!busy || !state.providers.NCALAYER.available}
                      onClick={() =>
                        void start(document.artifactId!, "NCALAYER")
                      }
                    >
                      Подписать через NCALayer
                    </button>
                  </>
                )}
            </div>
          </article>
        ))}
      </div>
      {session && (
        <Modal
          title="Подпись через eGov Mobile"
          onClose={() => {
            if (!busy) setSession(null);
          }}
        >
          <p>
            Откройте eGov Mobile и отсканируйте QR подписания. Затем проверьте
            результат.
          </p>
          {session.qrDataUrl && (
            <img
              className="signing-qr"
              width={240}
              height={240}
              src={session.qrDataUrl}
              alt="QR для подписания документа в eGov Mobile"
            />
          )}
          {(session.signingUrl || session.qrUrl) && (
            <p>
              <a
                href={session.signingUrl || session.qrUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть сервис подписания
              </a>
            </p>
          )}
          <p className="muted">
            QR предназначен для подписания этого документа и действует
            ограниченное время.
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button disabled={!!busy} onClick={() => setSession(null)}>
              Закрыть
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={async () => {
                setBusy(session.id);
                setError("");
                try {
                  await complete(session);
                } catch (caught) {
                  setError(errorText(caught));
                } finally {
                  setBusy("");
                }
              }}
            >
              {busy ? "Проверяем…" : "Проверить подпись"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
