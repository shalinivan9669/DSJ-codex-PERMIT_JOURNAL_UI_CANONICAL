"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import type { AppContext } from "@/lib/types";
import type { Paged } from "@/lib/lms-api";
import { SanitarySettings } from "./sanitary-settings";
import {
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  type Translate,
} from "./common";

function deliveryReason(code: string, t: Translate) {
  const reasons: Record<string, [string, string]> = {
    OUTCOME_UNKNOWN: [
      "Ответ не получен. Проверьте приём у получателя перед повторной передачей.",
      "Жауап алынбады. Қайта жібермес бұрын алушының қабылдағанын тексеріңіз.",
    ],
    RECONCILIATION_REQUIRED: [
      "Уточните исход предыдущей передачи у получателя.",
      "Алдыңғы жіберілімнің нәтижесін алушыдан нақтылаңыз.",
    ],
    PROVIDER_REJECTED_REQUEST: [
      "Получатель отклонил передачу. Проверьте его ответ и исправьте причину.",
      "Алушы жіберілімді қабылдамады. Оның жауабын тексеріп, себебін түзетіңіз.",
    ],
    CORRECTION_ROUTE_UNAVAILABLE: [
      "Исправление через подключение недоступно. Согласуйте его с получателем.",
      "Қосылым арқылы түзету қолжетімсіз. Түзетуді алушымен келісіңіз.",
    ],
  };
  return reasons[code]
    ? t(...reasons[code])
    : t(
        "Передача требует проверки. Уточните состояние у получателя.",
        "Жіберілімді тексеру қажет. Күйін алушыдан нақтылаңыз.",
      );
}

type SanitaryItem = {
  id: string;
  resultId: string;
  signatureState: string;
  snapshot: {
    learner: { fullNameRu: string; fullNameKz?: string };
    employer?: { nameRu?: string };
    course: { titleRu: string; titleKz?: string };
    examAt: string;
    verdict: string;
  };
  delivery: {
    id: string;
    state: string;
    lmkState: string;
    lastError?: string | null;
  } | null;
};
type SanitaryBatch = {
  id: string;
  preparedAt: string;
  dueAt: string | null;
  dueDate: string | null;
  state: string;
  overdue: boolean;
  deliveryState?: string;
  deliveryCounts?: {
    total: number;
    accepted: number;
    rejected: number;
    unknown: number;
    pending: number;
  };
  connectionState: string;
  items: SanitaryItem[];
  evidence?: {
    id: string;
    deliveryId: string;
    source: string;
    reference: string;
    category: string;
    createdAt: string;
    sha256?: string | null;
    supersedesId?: string | null;
  }[];
  history?: {
    id: string;
    deliveryId: string;
    operation: string;
    outcome: string;
    createdAt: string;
  }[];
};
export function Sanitary({
  t,
  context,
}: {
  t: Translate;
  context: AppContext;
}) {
  const [data, setData] = useState<Paged<SanitaryBatch>>({
    items: [],
    total: 0,
  });
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [format, setFormat] = useState("CSV"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [active, setActive] = useState<SanitaryBatch | null>(null);
  const language = t("ru", "kz");
  useEffect(() => {
    let alive = true;
    setBusy(true);
    void api<Paged<SanitaryBatch>>(`/lms/sanitary?page=${page}`)
      .then((value) => {
        if (alive) {
          setData(value);
          setError("");
        }
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [page, refresh]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        `demo:lms:export:${context.tenant.id}:${context.user.id}`,
      );
      if (saved && ["CSV", "XLSX", "PDF"].includes(saved)) setFormat(saved);
    } catch {
      /* Optional preference. */
    }
  }, [context.tenant.id, context.user.id]);
  return (
    <>
      <LmsHeading title={t("Санитарное обучение", "Санитариялық оқыту")} />
      {error && (
        <Notice>
          {error}
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel" aria-busy={busy}>
        <div className="lms-toolbar">
          <h2>
            {t(
              "Списки подтверждённых результатов",
              "Расталған нәтижелер тізімдері",
            )}
          </h2>
          <label>
            {t("Формат", "Пішім")}
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                try {
                  localStorage.setItem(
                    `demo:lms:export:${context.tenant.id}:${context.user.id}`,
                    e.target.value,
                  );
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              <option>CSV</option>
              <option>XLSX</option>
              <option>PDF</option>
            </select>
          </label>
        </div>
        <div
          className="lms-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Санитарный журнал", "Санитариялық журнал")}
        >
          <table className="lms-table">
            <thead>
              <tr>
                <th>{t("Список", "Тізім")}</th>
                <th>{t("Слушателей", "Тыңдаушылар")}</th>
                <th>{t("Срок", "Мерзім")}</th>
                <th>{t("Состояние", "Күйі")}</th>
                <th>{t("Внутренний список", "Ішкі тізім")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setActive(batch)}
                    >
                      {new Intl.DateTimeFormat(
                        language === "kz" ? "kk-KZ" : "ru-KZ",
                        {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: context.tenant.timezone,
                        },
                      ).format(new Date(batch.preparedAt))}
                    </button>
                  </td>
                  <td>{batch.items.length}</td>
                  <td>
                    {batch.dueDate ||
                      batch.dueAt?.slice(0, 10) ||
                      t("Проверить календарь", "Күнтізбені тексеру")}
                    {batch.overdue && (
                      <p className="lms-error">
                        {t("Срок наступил", "Мерзімі келді")}
                      </p>
                    )}
                  </td>
                  <td>
                    <Status value={batch.deliveryState || batch.state} t={t} />
                    {batch.deliveryCounts && (
                      <span className="lms-list-meta">
                        {t("Принято", "Қабылданды")}:{" "}
                        {batch.deliveryCounts.accepted} /{" "}
                        {batch.deliveryCounts.total}
                      </span>
                    )}
                  </td>
                  <td>
                    <a
                      className="button"
                      href={`/api/lms/sanitary/${batch.id}/export?format=${format}&language=${language}`}
                      download
                    >
                      {t("Скачать", "Жүктеу")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.items.length && !busy && (
          <p className="lms-empty">
            {t(
              "Подтверждённых результатов пока нет.",
              "Расталған нәтижелер әлі жоқ.",
            )}
          </p>
        )}
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize || 50}
          onPage={setPage}
          t={t}
        />
        <details>
          <summary>
            {t("Подключение и передача", "Қосылым және жіберу")}
          </summary>
          <p>
            <Status
              value={data.items[0]?.connectionState || "NOT_CONNECTED"}
              t={t}
            />
          </p>
        </details>
      </section>
      {active && (
        <SanitaryDetails
          key={active.id}
          batch={active}
          t={t}
          format={format}
          onClose={() => setActive(null)}
        />
      )}
      {["SUPER_ADMIN", "ADMIN", "DIRECTOR"].includes(context.user.role) && (
        <SanitarySettings t={t} timezone={context.tenant.timezone} />
      )}
    </>
  );
}
function SanitaryDetails({
  batch,
  t,
  format,
  onClose,
}: {
  batch: SanitaryBatch;
  t: Translate;
  format: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState(batch),
    [error, setError] = useState("");
  const [activeItem, setActiveItem] = useState<SanitaryItem | null>(null);
  const [supersedesId, setSupersedesId] = useState<string | undefined>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<SanitaryBatch>(`/lms/sanitary/${batch.id}`)
      .then((value) => {
        if (alive) setDetail(value);
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      });
    return () => {
      alive = false;
    };
  }, [batch.id, refresh]);
  return (
    <section className="panel lms-panel">
      <div className="lms-toolbar">
        <h2>
          {t("Состав списка", "Тізім құрамы")} · {detail.items.length}
        </h2>
        <div className="lms-actions">
          <a
            className="button primary"
            href={`/api/lms/sanitary/${batch.id}/export?format=${format}&language=${t("ru", "kz")}`}
            download
          >
            {t("Скачать", "Жүктеу")}
          </a>
          <button onClick={onClose}>{t("Закрыть", "Жабу")}</button>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {detail.deliveryCounts && (
        <p>
          <Status value={detail.deliveryState || detail.state} t={t} /> ·{" "}
          {t("Принято", "Қабылданды")}: {detail.deliveryCounts.accepted} /{" "}
          {detail.deliveryCounts.total}
        </p>
      )}
      <div
        className="lms-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={t("Состав списка", "Тізім құрамы")}
      >
        <table className="lms-table">
          <thead>
            <tr>
              <th>{t("Слушатель", "Тыңдаушы")}</th>
              <th>{t("Программа", "Бағдарлама")}</th>
              <th>{t("Состояние", "Күйі")}</th>
              <th>{t("Подтверждение", "Растау")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {t(
                    item.snapshot.learner.fullNameRu,
                    item.snapshot.learner.fullNameKz ||
                      item.snapshot.learner.fullNameRu,
                  )}
                </td>
                <td>
                  {t(
                    item.snapshot.course.titleRu,
                    item.snapshot.course.titleKz ||
                      item.snapshot.course.titleRu,
                  )}
                </td>
                <td>
                  <Status value={item.delivery?.state || "PREPARED"} t={t} />
                  {item.delivery?.lastError && (
                    <p className="lms-error">
                      {deliveryReason(item.delivery.lastError, t)}
                    </p>
                  )}
                  {item.signatureState === "AWAITING_SIGNATURE" && (
                    <p>
                      <Status value={item.signatureState} t={t} />
                    </p>
                  )}
                </td>
                <td>
                  <button
                    disabled={!item.delivery}
                    onClick={() => {
                      setSupersedesId(undefined);
                      setActiveItem(item);
                    }}
                  >
                    {t("Добавить подтверждение", "Растауды қосу")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {activeItem && (
        <ManualEvidence
          key={activeItem.id + (supersedesId || "")}
          item={activeItem}
          supersedesId={supersedesId}
          t={t}
          onSaved={() => setRefresh((value) => value + 1)}
        />
      )}
      {!!detail.evidence?.length && (
        <details>
          <summary>
            {t("Подтверждения оператора", "Оператор растаулары")}
          </summary>
          <ul className="lms-list">
            {detail.evidence.map((entry) => (
              <li key={entry.id}>
                <span>
                  <Status value={entry.category} t={t} />
                  <br />
                  {entry.source}
                  {entry.supersedesId && (
                    <span>
                      {" "}
                      ·{" "}
                      {t(
                        "Исправление прежнего подтверждения",
                        "Алдыңғы растауды түзету",
                      )}
                    </span>
                  )}
                  {detail.evidence?.some(
                    (next) => next.supersedesId === entry.id,
                  ) && (
                    <span>
                      {" "}
                      · {t("Заменено исправлением", "Түзетумен ауыстырылған")}
                    </span>
                  )}
                  {entry.reference && <> · {entry.reference}</>}
                  <br />
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString(
                      t("ru-KZ", "kk-KZ"),
                    )}
                  </time>
                  {entry.sha256 && (
                    <p>
                      <a
                        href={`/api/lms/sanitary/evidence/${entry.id}/file`}
                        download
                      >
                        {t("Скачать подтверждение", "Растауды жүктеу")}
                      </a>
                    </p>
                  )}
                  {!detail.evidence?.some(
                    (next) => next.supersedesId === entry.id,
                  ) && (
                    <button
                      onClick={() => {
                        const item = detail.items.find(
                          (value) => value.delivery?.id === entry.deliveryId,
                        );
                        if (item) {
                          setSupersedesId(entry.id);
                          setActiveItem(item);
                        }
                      }}
                    >
                      {t("Исправить подтверждение", "Растауды түзету")}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!detail.history?.length && (
        <details>
          <summary>{t("История передачи", "Жіберу тарихы")}</summary>
          <ul className="lms-list">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString(
                    t("ru-KZ", "kk-KZ"),
                  )}
                </time>
                <Status value={entry.outcome} t={t} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
function ManualEvidence({
  item,
  t,
  onSaved,
  supersedesId,
}: {
  item: SanitaryItem;
  t: Translate;
  onSaved: () => void;
  supersedesId?: string;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [source, setSource] = useState(""),
    [reference, setReference] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !item.delivery) return;
    setBusy(true);
    setError("");
    const body = new FormData();
    if (file) body.set("file", file);
    body.set("source", source);
    body.set("reference", reference);
    body.set("requestKey", requestKey);
    if (supersedesId) body.set("supersedesId", supersedesId);
    try {
      await api(`/lms/sanitary/deliveries/${item.delivery.id}/evidence`, {
        method: "POST",
        body,
      });
      setSaved(true);
      onSaved();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>
        {t(
          item.snapshot.learner.fullNameRu,
          item.snapshot.learner.fullNameKz || item.snapshot.learner.fullNameRu,
        )}
      </h3>
      {error && <Notice>{error}</Notice>}
      {saved ? (
        <p role="status">
          <Status value="OPERATOR_ATTESTED" t={t} />
        </p>
      ) : (
        <form onSubmit={submit}>
          <div className="lms-fields">
            <label>
              {supersedesId
                ? t(
                    "Источник и причина исправления",
                    "Дереккөз және түзету себебі",
                  )
                : t("Источник подтверждения", "Растау дереккөзі")}
              <input
                required
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label>
              {t(
                "Номер или ссылка на подтверждение",
                "Растау нөмірі немесе сілтемесі",
              )}
              <input
                required={!file}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </div>
          <label>
            {t("Файл подтверждения, если есть", "Растау файлы, бар болса")}
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {t("Добавить подтверждение", "Растауды қосу")}
          </button>
        </form>
      )}
    </section>
  );
}
