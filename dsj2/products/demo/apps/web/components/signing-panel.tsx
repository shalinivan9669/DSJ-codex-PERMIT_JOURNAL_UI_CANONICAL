"use client";
import {
  useCabinetText,
  useCabinetError,
  useCabinetLanguage,
} from "./cabinet-language";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { canManageSystem } from "@demo/contracts";
import { ApiError, api, downloadArtifact, json } from "@/lib/api";
import { documentTitle, type Issuance } from "@/lib/types";
import { signWithNCALayer } from "@/lib/ncalayer";
import {
  attestedSignerName,
  signingRole,
  type SigningPerson,
} from "@/lib/signing-flow";
import { PaperDocumentSignature } from "./paper-document-signature";
import { OperatorError } from "./operator-error";

type Provider = "EGOV_QR" | "NCALAYER";
type SigningState = {
  issuanceId?: string;
  status: string | null;
  archived: boolean;
  invalidatedBy?: string | null;
  failureReason?: string | null;
  unavailableSigners?: {
    kind: string;
    displayName: string;
    bindingState: "MISSING" | "REVOKED";
  }[];
  providers: Record<Provider, { available: boolean; reason?: string | null }>;
  documents: {
    documentId: string;
    templateId: string;
    rowId?: string | null;
    groupEventId?: string | null;
    number: string;
    artifactId: string | null;
    complete: boolean;
    documentDate?: string;
    paperAllowed?: boolean;
    canAttestPaper?: boolean;
    signatureExempt?: boolean;
    paperSignature?: {
      signedAt: string;
      signerNames: string[];
      reason: string;
    } | null;
    requiredSigners: SigningPerson[];
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
  commissionIssuanceId,
}: {
  requestId: string;
  issuances?: Pick<Issuance, "id" | "createdAt">[];
  role: string;
  onChanged: () => void;
  commissionIssuanceId?: string;
}) {
  const tr = useCabinetText();
  const t = useCabinetLanguage();
  const [state, setState] = useState<SigningState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useCabinetError();
  const [loadError, setLoadError] = useCabinetError();
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [success, setSuccess] = useState("");
  const [selectedIssuanceId, setSelectedIssuanceId] = useState("");
  const [pendingSignature, setPendingSignature] = useState<{
    session: Session;
    signature: string;
  } | null>(null);
  const loadScope = useRef(0);
  const loadRequest = useRef(0);
  const pendingLoads = useRef(0);
  const failedLoad = useRef(false);
  const acting = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const previousStatus = useRef<string | null>(null);
  const stages = useMemo(
    () => [...issuances].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [issuances],
  );
  const latestIssuanceId = stages[0]?.id;
  const effectiveIssuanceId = selectedIssuanceId || latestIssuanceId;
  const signingPath = commissionIssuanceId
    ? `/lms/commission/${commissionIssuanceId}/signing`
    : `/print-requests/${requestId}/signing${effectiveIssuanceId ? `?issuanceId=${encodeURIComponent(effectiveIssuanceId)}` : ""}`;
  const currentPath = useRef(signingPath);
  currentPath.current = signingPath;
  const load = useCallback(async () => {
    const scope = loadScope.current;
    const sequence = ++loadRequest.current;
    pendingLoads.current++;
    let value: SigningState;
    try {
      value = await api<SigningState>(signingPath);
    } catch (caught) {
      if (
        signingPath !== currentPath.current ||
        scope !== loadScope.current ||
        sequence !== loadRequest.current
      )
        return;
      failedLoad.current = true;
      throw caught;
    } finally {
      pendingLoads.current--;
    }
    if (
      signingPath === currentPath.current &&
      scope === loadScope.current &&
      sequence === loadRequest.current
    ) {
      setState(value);
      setLoadError("");
      failedLoad.current = false;
      if (value.status === "ISSUED") {
        setError("");
        setSession(null);
        setPendingSignature(null);
      }
      if (
        previousStatus.current &&
        previousStatus.current !== "ISSUED" &&
        value.status === "ISSUED"
      )
        changed.current();
      previousStatus.current = value.status;
    }
    return value;
  }, [signingPath]);
  useEffect(() => {
    let active = true;
    const scope = ++loadScope.current;
    setState(null);
    setError("");
    setLoadError("");
    setSuccess("");
    setSession(null);
    setPendingSignature(null);
    setBusy("");
    setRefreshing(false);
    acting.current = false;
    previousStatus.current = null;
    failedLoad.current = false;
    async function poll() {
      try {
        await load();
      } catch (caught) {
        if (active && scope === loadScope.current) {
          setLoadError(caught);
        }
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (
        !pendingLoads.current &&
        (failedLoad.current ||
          ["RENDERING", "AWAITING_SIGNATURE"].includes(
            previousStatus.current || "",
          ))
      )
        void poll();
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
      if (scope === loadScope.current) loadScope.current++;
    };
  }, [load]);
  useEffect(() => {
    if (window.location.hash !== "#signing") return;
    const panel = document.getElementById("signing");
    let parent = panel?.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    panel?.scrollIntoView({ block: "start" });
  }, [requestId]);
  const operationScope = () => ({
    path: currentPath.current,
    sequence: loadScope.current,
  });
  const isCurrent = (scope: ReturnType<typeof operationScope>) =>
    scope.path === currentPath.current && scope.sequence === loadScope.current;
  async function complete(
    value: Session,
    signatureBase64?: string,
    scope = operationScope(),
  ) {
    await api(
      commissionIssuanceId
        ? `/lms/commission/${commissionIssuanceId}/signatures`
        : `/signing/${value.id}/complete`,
      {
        method: "POST",
        body: json({
          ...(commissionIssuanceId ? { sessionId: value.id } : {}),
          ...(signatureBase64 ? { signatureBase64 } : {}),
        }),
      },
    );
    if (!isCurrent(scope)) return;
    setSession(null);
    setPendingSignature(null);
    setSuccess(tr("Подпись проверена."));
    await load().catch((caught) => setLoadError(caught));
    if (isCurrent(scope)) changed.current();
  }
  async function start(artifactId: string, provider: Provider) {
    if (acting.current) return;
    acting.current = true;
    if (effectiveIssuanceId) setSelectedIssuanceId(effectiveIssuanceId);
    const scope = operationScope();
    setBusy(artifactId);
    setError("");
    setSuccess("");
    try {
      const value = await api<Session>(
        commissionIssuanceId
          ? `/lms/commission/${commissionIssuanceId}/signing`
          : `/print-requests/${requestId}/signing/start`,
        { method: "POST", body: json({ artifactId, provider }) },
      );
      if (!isCurrent(scope)) return;
      if (provider === "NCALAYER") {
        if (!value.dataBase64)
          throw new Error(tr("Сервер не передал документ для подписания."));
        const signature = await signWithNCALayer({
          dataBase64: value.dataBase64,
          ...value.ncalayerRequest?.args.signerParams,
        });
        if (!isCurrent(scope)) return;
        setPendingSignature({ session: value, signature });
        await complete(value, signature, scope);
      } else setSession(value);
    } catch (caught) {
      if (isCurrent(scope)) {
        setError(caught);
        if (
          caught instanceof ApiError &&
          caught.status > 0 &&
          caught.status < 500
        )
          setPendingSignature(null);
      }
    } finally {
      if (isCurrent(scope)) {
        setBusy("");
        acting.current = false;
      }
    }
  }
  const awaiting = state?.status === "AWAITING_SIGNATURE";
  const paperAvailable = !!state?.documents.some(
    (document) =>
      document.paperAllowed &&
      !document.complete &&
      !document.templateId.startsWith("lms-"),
  );
  const canRecordPaper = !!state?.documents.some(
    (document) =>
      document.canAttestPaper &&
      !document.complete &&
      !document.templateId.startsWith("lms-"),
  );
  const electronicAvailable =
    !!state &&
    Object.values(state.providers).some((provider) => provider.available);
  const needsSignerSetup =
    !!state &&
    (state.unavailableSigners
      ? state.unavailableSigners.length > 0
      : state.missingBindings.length > 0);
  const locked = !!busy || !!session || !!pendingSignature;
  return (
    <section className="panel signing-panel" id="signing">
      <div className="section-heading">
        <h2>{tr("Подписание документов")}</h2>
        <button
          disabled={locked || refreshing}
          onClick={async () => {
            const scope = operationScope();
            setRefreshing(true);
            try {
              await load();
              if (isCurrent(scope)) setError("");
            } catch (caught) {
              if (isCurrent(scope)) setLoadError(caught);
            } finally {
              if (isCurrent(scope)) setRefreshing(false);
            }
          }}
        >
          {refreshing ? tr("Проверяем…") : tr("Обновить")}
        </button>
      </div>
      {stages.length > 1 && (
        <label>
          {tr("Выпуск для подписания")}
          <select
            value={selectedIssuanceId || latestIssuanceId}
            disabled={locked}
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
                {tr("Выпуск")} {stages.length - index}
                {stage.createdAt
                  ? ` · ${new Date(stage.createdAt).toLocaleString(tr("Настройки") === "Настройки" ? "ru-KZ" : "kk-KZ")}`
                  : ""}
                {index === 0 ? tr(" · последний") : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <Notice>
          <OperatorError text={error} />
        </Notice>
      )}
      {loadError && (
        <Notice>
          <OperatorError text={loadError} />
        </Notice>
      )}
      {success && <Notice kind="success">{success}</Notice>}
      {!state && !loadError && (
        <p role="status">{tr("Проверяем готовность документов…")}</p>
      )}
      {state && !state.status && (
        <p>
          {t(
            "Передайте заявку директору. После согласования сформируйте документы.",
            "Өтінімді директорға жіберіңіз. Келісілгеннен кейін құжаттарды дайындаңыз.",
          )}
        </p>
      )}
      {state?.status === "LEGACY_ISSUED" && (
        <p>
          {tr(
            "Ранее выданный комплект. Проверенная ЭЦП не зарегистрирована.",
          )}
        </p>
      )}
      {state?.status === "RENDERING" && (
        <p role="status">
          {tr(
            "Готовим документы для подписания…",
          )}
        </p>
      )}
      {state?.status === "FAILED" && (
        <Notice>
          {state.invalidatedBy
            ? t(
                "Выпуск отменён или заменён. Откройте действующий выпуск.",
                "Шығарылым жойылған немесе ауыстырылған. Қолданыстағы шығарылымды ашыңыз.",
              )
            : state.failureReason === "REQUEST_INELIGIBLE"
              ? t(
                  "Проверьте состояние заявки у директора.",
                  "Өтінімнің күйін директордан тексеріңіз.",
                )
              : state.failureReason === "ARTIFACT_INTEGRITY_FAILED"
                ? t(
                    "Не удалось проверить файл. Обратитесь к администратору.",
                    "Файлды тексеру мүмкін болмады. Әкімшіге хабарласыңыз.",
                  )
                : tr(
                    "Не все файлы готовы. Повторите формирование документов.",
                  )}
        </Notice>
      )}
      {state?.status === "ISSUED" && (
        <Notice kind="success">
          {state.documents.some((document) => document.paperSignature)
            ? tr(
                "Выпуск оформлен. Способ подписания указан у каждого документа.",
              )
            : state.archived
              ? tr(
                  "Подписи проверены. Комплект выдан и помещён в архив.",
                )
              : tr(
                  "Подписи проверены. Выпуск оформлен.",
                )}
        </Notice>
      )}
      {state && awaiting && (
        <>
          <p role="status">
            {t("Готово к выдаче документов", "Беруге дайын құжаттар")}:{" "}
            {state.documents.filter((document) => document.complete).length}{" "}
            {t("из", "барлығы")} {state.documents.length}.{" "}
          </p>
          {!electronicAvailable && (
            <Notice kind="info">
              {t(
                "ЭЦП недоступна. Подключение настраивает администратор.",
                "ЭЦҚ қолжетімсіз. Қосылуды әкімші баптайды.",
              )}
              {paperAvailable && (
                <>
                  {" "}
                  {t(
                    "Можно оформить документы с подписями на бумаге.",
                    "Құжаттарды қағаздағы қолдармен рәсімдеуге болады.",
                  )}
                </>
              )}
            </Notice>
          )}
          {paperAvailable && (
            <p>
              {canRecordPaper
                ? t(
                    "Проверьте оригиналы и подтвердите бумажные подписи.",
                    "Түпнұсқаларды тексеріп, қағаздағы қолдарды растаңыз.",
                  )
                : t(
                    "Соберите бумажные подписи и передайте оригиналы директору.",
                    "Қағаздағы қолдарды жинап, түпнұсқаларды директорға беріңіз.",
                  )}
            </p>
          )}
          <details>
            <summary>
              {t(
                "ЭЦП: доступность и подписанты",
                "ЭЦҚ: қолжетімділік және қол қоюшылар",
              )}
            </summary>
            <p>
              {t(
                "Каждый подписант входит в свой аккаунт и подписывает окончательный PDF своим ключом.",
                "Әр қол қоюшы өз аккаунтына кіріп, түпкілікті PDF файлына өз кілтімен қол қояды.",
              )}
            </p>
            {(["EGOV_QR", "NCALAYER"] as const).map((provider) => (
              <p key={provider}>
                {provider === "EGOV_QR" ? "eGov Mobile" : "NCALayer"}:{" "}
                {state.providers[provider].available
                  ? t("подключён", "қосылған")
                  : tr(
                      state.providers[provider].reason ||
                        t("не подключён", "қосылмаған"),
                    )}
              </p>
            ))}
            {needsSignerSetup && (
              <>
                <p>
                  {t(
                    "Нет действующих полномочий ЭЦП для этого выпуска",
                    "Бұл шығарылым үшін қолданыстағы ЭЦҚ өкілеттіктері жоқ",
                  )}
                  :{" "}
                  {state.unavailableSigners?.length
                    ? state.unavailableSigners
                        .map(
                          (signer) =>
                            `${tr(signingRole(signer.kind))}: ${signer.displayName}`,
                        )
                        .join("; ")
                    : [...new Set(state.missingBindings)].join(", ")}
                </p>
                <p>
                  {commissionIssuanceId || role === "VIEWER"
                    ? t(
                        "Обратитесь к директору или оператору для подготовки исправленного выпуска с действующими подписантами.",
                        "Қолданыстағы қол қоюшылары бар түзетілген шығарылымды дайындау үшін директорға немесе операторға хабарласыңыз.",
                      )
                    : t(
                        "Для ЭЦП создайте исправление с действующими подписантами. Если изменились ФИО, обновите реквизиты и передайте заявку директору.",
                        "ЭЦҚ үшін қолданыстағы қол қоюшылармен түзету жасаңыз. Аты-жөндері өзгерсе, деректемелерді жаңартып, өтінімді директорға жіберіңіз.",
                      )}
                </p>
                {!commissionIssuanceId && role !== "VIEWER" && (
                  <p>
                    <a href="#issuance-history-actions">
                      {t(
                        "Перейти к исправлению выпуска",
                        "Шығарылымды түзетуге өту",
                      )}
                    </a>
                  </p>
                )}
                <p>
                  {t(
                    "Настройки подписантов действуют только для новых выпусков.",
                    "Қол қоюшы баптаулары тек жаңа шығарылымдарға қолданылады.",
                  )}
                </p>
                {canManageSystem(role) && (
                  <a
                    href={`/settings?tab=signatories&focus=signatories&returnTo=${encodeURIComponent(`/requests/${requestId}#signing`)}#signatory-settings`}
                  >
                    {t(
                      "Настроить подписантов ЭЦП",
                      "ЭЦҚ қол қоюшыларын баптау",
                    )}
                  </a>
                )}
              </>
            )}
          </details>
          {electronicAvailable && needsSignerSetup && (
            <Notice kind="info">
              {t(
                "Нужны подписанты ЭЦП. Откройте «ЭЦП: доступность и подписанты».",
                "ЭЦҚ қол қоюшылары қажет. «ЭЦҚ: қолжетімділік және қол қоюшылар» бөлімін ашыңыз.",
              )}
            </Notice>
          )}
        </>
      )}
      {pendingSignature && (
        <Notice kind="info">
          <p>
            {t(
              "Не удалось проверить полученную подпись. Повторите проверку.",
              "Алынған қолтаңбаны тексеру мүмкін болмады. Тексеруді қайталаңыз.",
            )}
          </p>
          <button
            disabled={!!busy}
            onClick={async () => {
              if (acting.current) return;
              acting.current = true;
              const scope = operationScope();
              setBusy(pendingSignature.session.id);
              setError("");
              try {
                await complete(
                  pendingSignature.session,
                  pendingSignature.signature,
                  scope,
                );
              } catch (caught) {
                if (isCurrent(scope)) {
                  setError(caught);
                  if (
                    caught instanceof ApiError &&
                    caught.status > 0 &&
                    caught.status < 500
                  )
                    setPendingSignature(null);
                }
              } finally {
                if (isCurrent(scope)) {
                  setBusy("");
                  acting.current = false;
                }
              }
            }}
          >
            {tr("Проверить подпись")}
          </button>
          <button
            disabled={!!busy}
            onClick={() => {
              setPendingSignature(null);
              setError("");
              void load().catch((caught) => setLoadError(caught));
            }}
          >
            {tr("Закрыть")}
          </button>
        </Notice>
      )}
      <div className="signing-documents">
        {state?.documents.map((document) => (
          <article key={document.documentId} className="signing-document">
            <h3>
              {tr(
                documentTitle(
                  document.templateId,
                  document.groupEventId
                    ? true
                    : document.rowId
                      ? false
                      : undefined,
                ),
              )}{" "}
              · № {document.number}
            </h3>
            <ul>
              {document.requiredSigners.map((signer, index) => (
                <li key={`${signer.kind}-${index}`}>
                  <strong>{tr(signingRole(signer.kind))}</strong>:{" "}
                  {(!signer.signed &&
                    !document.templateId.startsWith("lms-") &&
                    attestedSignerName(
                      signer.kind,
                      document.paperSignature?.signerNames,
                    )) ||
                    signer.displayName}{" "}
                  —{" "}
                  {signer.signed
                    ? tr("ЭЦП проверена")
                    : document.paperSignature
                      ? tr("оформлено на бумаге")
                      : state.status === "FAILED"
                        ? t("подписание недоступно", "қол қою қолжетімсіз")
                        : signer.bindingState === "REVOKED"
                          ? t(
                              "полномочие ЭЦП отозвано",
                              "ЭЦҚ өкілеттігі қайтарып алынған",
                            )
                          : signer.bindingState === "MISSING" ||
                              signer.bindingId === null
                            ? t("ЭЦП не назначена", "ЭЦҚ тағайындалмаған")
                            : tr("ожидает подписи")}
                  {signer.canSign && !signer.signed && !document.paperSignature
                    ? tr(" (ваша подпись)")
                    : ""}
                </li>
              ))}
            </ul>
            {document.signatureExempt && (
              <p>
                {t(
                  "Для этой формы подписи не требуются.",
                  "Бұл нысан үшін қол қою қажет емес.",
                )}
              </p>
            )}
            {awaiting &&
              document.requiredSigners.some(
                (signer) => signer.canSign && !signer.signed,
              ) &&
              !document.paperSignature &&
              electronicAvailable && (
                <p className="fine-print">
                  {t("Сейчас вы подписываете как", "Қазір қол қоятын рөліңіз")}:{" "}
                  {tr(
                    signingRole(
                      document.requiredSigners.find(
                        (signer) => signer.canSign && !signer.signed,
                      )!.kind,
                    ),
                  )}
                  .
                </p>
              )}
            <div className="button-row">
              {document.artifactId &&
                (commissionIssuanceId ? (
                  <a
                    className="button"
                    href={`/api/lms/commission/${commissionIssuanceId}/artifacts/${document.artifactId}`}
                  >
                    {tr("Скачать PDF")}
                  </a>
                ) : (
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void downloadArtifact(
                        document.artifactId!,
                        `${document.number}.pdf`,
                      ).catch((caught) => setError(caught))
                    }
                  >
                    {tr("Скачать PDF")}
                  </button>
                ))}
              {role !== "VIEWER" &&
                !document.paperSignature &&
                document.artifactId &&
                document.requiredSigners.some(
                  (signer) => signer.canSign && !signer.signed,
                ) &&
                state.status === "AWAITING_SIGNATURE" && (
                  <>
                    <button
                      className="primary"
                      disabled={locked || !state.providers.EGOV_QR.available}
                      onClick={() =>
                        void start(document.artifactId!, "EGOV_QR")
                      }
                    >
                      {busy === document.artifactId
                        ? tr("Подписание…")
                        : tr("Подписать через eGov Mobile")}
                    </button>
                    <button
                      disabled={locked || !state.providers.NCALAYER.available}
                      onClick={() =>
                        void start(document.artifactId!, "NCALAYER")
                      }
                    >
                      {tr("Подписать через NCALayer")}
                    </button>
                  </>
                )}
            </div>
            {document.paperSignature && (
              <div>
                <p>
                  {tr("Бумажные подписи подтверждены руководителем")}:{" "}
                  {document.paperSignature.signedAt}.
                </p>
                {(document.templateId.startsWith("lms-") ||
                  document.requiredSigners.some((signer) => signer.signed)) && (
                  <p>
                    {t("На бумажном оригинале", "Қағаз түпнұсқасында")}:{" "}
                    {document.paperSignature.signerNames.join(", ")}
                  </p>
                )}
                <p className="muted">{document.paperSignature.reason}</p>
              </div>
            )}
            {!commissionIssuanceId &&
              !document.templateId.startsWith("lms-") &&
              document.canAttestPaper &&
              !document.complete &&
              !document.paperSignature && (
                <PaperDocumentSignature
                  key={document.documentId}
                  requestId={requestId}
                  documentId={document.documentId}
                  documentDate={document.documentDate}
                  requiredSigners={document.requiredSigners}
                  disabled={locked}
                  onSaved={async () => {
                    await load();
                    onChanged();
                  }}
                />
              )}
          </article>
        ))}
      </div>
      {session && (
        <Modal
          title={tr("Подпись через eGov Mobile")}
          onClose={() => {
            if (!busy) setSession(null);
          }}
        >
          <p>
            {tr(
              "Откройте eGov Mobile и отсканируйте QR подписания. Затем проверьте результат.",
            )}
          </p>
          {session.qrDataUrl && (
            <img
              className="signing-qr"
              width={240}
              height={240}
              src={session.qrDataUrl}
              alt={tr("QR для подписания документа в eGov Mobile")}
            />
          )}
          {(session.signingUrl || session.qrUrl) && (
            <p>
              <a
                href={session.signingUrl || session.qrUrl}
                target="_blank"
                rel="noreferrer"
              >
                {tr("Открыть сервис подписания")}
              </a>
            </p>
          )}

          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button disabled={!!busy} onClick={() => setSession(null)}>
              {tr("Закрыть")}
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={async () => {
                if (acting.current) return;
                acting.current = true;
                const scope = operationScope();
                setBusy(session.id);
                setError("");
                try {
                  await complete(session, undefined, scope);
                } catch (caught) {
                  if (isCurrent(scope)) setError(caught);
                } finally {
                  if (isCurrent(scope)) {
                    setBusy("");
                    acting.current = false;
                  }
                }
              }}
            >
              {busy ? tr("Проверяем…") : tr("Проверить подпись")}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
