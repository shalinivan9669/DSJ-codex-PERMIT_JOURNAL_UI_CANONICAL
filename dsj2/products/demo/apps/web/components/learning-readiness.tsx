"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Notice } from "@demo/ui";
import type { LmsDeploymentReadiness } from "@demo/contracts/src/lms/deployment-gates";
import { api } from "@/lib/api";
import { LmsErrorDiagnostic, lmsError, type Translate } from "./lms/common";

const reasons: Record<LmsDeploymentReadiness["reason"], [string, string]> = {
  SYNTHETIC: [
    "Обучение доступно в учебном режиме с тестовыми данными.",
    "Оқу сынақ деректері бар оқу режимінде қолжетімді.",
  ],
  READY: [
    "Обучение доступно: серверная настройка центра прошла проверку.",
    "Оқу қолжетімді: орталықтың серверлік баптауы тексеруден өтті.",
  ],
  NOT_CONFIGURED: [
    "На сервере не подключён документ настройки работы с данными центра.",
    "Серверде орталық деректерімен жұмыс істеу баптауының құжаты қосылмаған.",
  ],
  UNREADABLE: [
    "Сервер не может прочитать документ настройки. Специалисту нужно проверить подключение файла и доступ к нему.",
    "Сервер баптау құжатын оқи алмайды. Маман файлдың қосылуын және оған қолжетімділікті тексеруі керек.",
  ],
  INVALID_DOCUMENT: [
    "Документ настройки имеет неверный формат или превышает допустимый размер.",
    "Баптау құжатының пішімі қате немесе рұқсат етілген өлшемнен асады.",
  ],
  TENANT_MISSING: [
    "В документе настройки нет подтверждения для этого центра.",
    "Баптау құжатында осы орталыққа арналған растау жоқ.",
  ],
  INCOMPLETE: [
    "Подтверждение для центра заполнено не полностью. Нужно проверить ответственных, основания и перечень хранилищ.",
    "Орталыққа арналған растау толық толтырылмаған. Жауапты адамдарды, негіздерді және сақтау орындарының тізімін тексеру қажет.",
  ],
  PLACEMENT_UNCONFIRMED: [
    "В документе не подтверждено размещение всех используемых хранилищ данных в Казахстане.",
    "Құжатта пайдаланылатын барлық деректер сақтау орындарының Қазақстанда орналасуы расталмаған.",
  ],
};

export function LearningReadiness({
  t,
  tenantId,
  children,
}: {
  t: Translate;
  tenantId: string;
  children: (onBusyChange: (pending: boolean) => void) => ReactNode;
}) {
  const [readiness, setReadiness] = useState<LmsDeploymentReadiness | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [policyBusy, setPolicyBusy] = useState(false);
  const policyPending = useRef(false);
  const onPolicyBusyChange = useCallback((pending: boolean) => {
    policyPending.current = pending;
    setPolicyBusy(pending);
  }, []);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const instructions = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setReadiness(null);
    setError(null);
    setCopied("idle");
    void api<LmsDeploymentReadiness>("/settings/learning-readiness")
      .then((value) => {
        if (active) setReadiness(value);
      })
      .catch((caught) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [reload, tenantId]);
  const reason = readiness ? t(...reasons[readiness.reason]) : "";
  const task = [
    t(
      "Проверьте настройку доступа к обучению.",
      "Оқуға қолжетімділік баптауын тексеріңіз.",
    ),
    `${t("Центр", "Орталық")}: ${tenantId}`,
    reason,
    t(
      "Ответственный за данные подтверждает размещение хранилищ и копий, основания обработки, доступ и сроки хранения. Специалист сервера подключает подтверждённый документ к сервису API через DEMO_LMS_DEPLOYMENT_EVIDENCE.",
      "Деректерге жауапты адам сақтау орындары мен көшірмелердің орналасуын, өңдеу негіздерін, қолжетімділікті және сақтау мерзімдерін растайды. Сервер маманы расталған құжатты DEMO_LMS_DEPLOYMENT_EVIDENCE арқылы API сервисіне қосады.",
    ),
    t(
      "Порядок проверки: docs/LMS_DEPLOYMENT_RECOVERY_RU.md. После настройки повторите проверку в Настройки → Пользователи → Доступ к обучению.",
      "Тексеру тәртібі: docs/LMS_DEPLOYMENT_RECOVERY_RU.md. Баптағаннан кейін Баптаулар → Пайдаланушылар → Оқуға қолжетімділік бөлімінде қайта тексеріңіз.",
    ),
  ].join("\n\n");
  async function copyTask() {
    try {
      await navigator.clipboard.writeText(task);
      setCopied("done");
    } catch {
      setCopied("failed");
      if (instructions.current) instructions.current.open = true;
    }
  }
  return (
    <>
      <section
        id="learning-readiness"
        aria-labelledby="learning-readiness-title"
        aria-busy={busy}
      >
        <h2 id="learning-readiness-title">
          {t("Доступ к обучению", "Оқуға қолжетімділік")}
        </h2>
        {busy && (
          <p role="status">
            {t(
              "Проверяем настройку центра…",
              "Орталық баптауын тексеріп жатырмыз…",
            )}
          </p>
        )}
        {!!error && (
          <Notice>
            {lmsError(error, t)}
            <LmsErrorDiagnostic error={error} t={t} />
          </Notice>
        )}
        {readiness && (
          <>
            {!readiness.available && (
              <p>
                <strong>
                  {t("Обучение пока недоступно", "Оқу әзірге қолжетімсіз")}
                </strong>
              </p>
            )}
            <p>{reason}</p>
            {!readiness.available && (
              <>
                <p>
                  {t(
                    "Передайте задание специалисту, который обслуживает сервер центра. После исправления настройки проверьте доступ здесь.",
                    "Тапсырманы орталық серверіне қызмет көрсететін маманға беріңіз. Баптау түзетілгеннен кейін қолжетімділікті осы жерден тексеріңіз.",
                  )}
                </p>
                <details ref={instructions}>
                  <summary>
                    {t("Задание для специалиста", "Маманға арналған тапсырма")}
                  </summary>
                  {task.split("\n\n").map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </details>
              </>
            )}
          </>
        )}
        <div className="toolbar-actions">
          {readiness && !readiness.available && (
            <button type="button" onClick={() => void copyTask()}>
              {t("Скопировать задание", "Тапсырманы көшіру")}
            </button>
          )}
          <button
            type="button"
            disabled={busy || policyBusy}
            onClick={() => {
              if (busy || policyPending.current) return;
              setBusy(true);
              setReload((value) => value + 1);
            }}
          >
            {t("Проверить настройку", "Баптауды тексеру")}
          </button>
        </div>
        {copied !== "idle" && (
          <p role="status">
            {copied === "done"
              ? t("Задание скопировано.", "Тапсырма көшірілді.")
              : t(
                  "Не удалось скопировать. Выделите текст задания и скопируйте его вручную.",
                  "Көшіру мүмкін болмады. Тапсырма мәтінін таңдап, қолмен көшіріңіз.",
                )}
          </p>
        )}
      </section>
      {readiness?.available && !busy && !error && children(onPolicyBusyChange)}
    </>
  );
}
