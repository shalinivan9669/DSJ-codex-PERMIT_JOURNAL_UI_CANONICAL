"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import {
  dataAccessPolicySchema,
  type DataAccessPolicy,
} from "@demo/contracts/src/regulatory-results";
import { api, json } from "@/lib/api";
import { lmsError, Status, type Translate } from "./common";

export type CalendarVersion = {
  id: string;
  name: string;
  version: number;
  timezone: string;
  coverageFrom: string;
  coverageUntil: string;
  definition: {
    weekendDays: number[];
    nonWorkingDates: string[];
    workingDates: string[];
    sources: string[];
    synthetic: boolean;
  };
};
type Settings = {
  connection: string;
  dataAccessPolicy: DataAccessPolicy;
  connections: { destination: string; dataAccessPolicy: DataAccessPolicy }[];
  calendarVersions: CalendarVersion[];
};
type Subjects = {
  operatorName: string;
  confirmedUniqueLearnerSubjects: number;
  recipientRecords: number;
  unlinkedRecipientRecords: number;
};

export function SanitarySettings({
  t,
  timezone,
}: {
  t: Translate;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [subjects, setSubjects] = useState<Subjects | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([
      api<Settings>("/lms/sanitary/settings"),
      api<Subjects>("/lms/sanitary/subjects"),
    ])
      .then(([value, counts]) => {
        if (alive) {
          setSettings(value);
          setSubjects(counts);
          setError("");
        }
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      });
    return () => {
      alive = false;
    };
  }, [open, refresh]);
  return (
    <details
      className="panel lms-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("Параметры центра", "Орталық параметрлері")}</summary>
      {error && (
        <Notice>
          {error}
          <button onClick={() => setRefresh((value) => value + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {settings && (
        <>
          <p>
            <Status value={settings.connection} t={t} />
          </p>
          <details>
            <summary>
              {t("Производственный календарь", "Өндірістік күнтізбе")}
            </summary>
            <ul className="lms-list">
              {settings.calendarVersions.map((calendar) => (
                <li key={calendar.id}>
                  <span>
                    <strong>
                      {calendar.name} · {t("версия", "нұсқа")}{" "}
                      {calendar.version}
                    </strong>
                    <br />
                    {calendar.coverageFrom.slice(0, 10)} —{" "}
                    {calendar.coverageUntil.slice(0, 10)} · {calendar.timezone}
                    {calendar.definition.synthetic && (
                      <> · {t("Учебный", "Оқу")}</>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <CalendarForm
              t={t}
              timezone={timezone}
              onCreated={() => setRefresh((value) => value + 1)}
            />
          </details>
          <details>
            <summary>
              {t(
                "Основания доступа и передачи",
                "Қолжетімділік пен жіберу негіздері",
              )}
            </summary>
            <AccessPolicy t={t} settings={settings} />
          </details>
          {subjects && (
            <details>
              <summary>
                {t(
                  "Учёт субъектов данных",
                  "Деректер субъектілерін есепке алу",
                )}
              </summary>
              <p>
                <strong>{subjects.operatorName}</strong>
              </p>
              <dl className="lms-fields">
                <div>
                  <dt>
                    {t("Связанных слушателей", "Байланыстырылған тыңдаушылар")}
                  </dt>
                  <dd>{subjects.confirmedUniqueLearnerSubjects}</dd>
                </div>
                <div>
                  <dt>{t("Записей получателей", "Алушы жазбалары")}</dt>
                  <dd>{subjects.recipientRecords}</dd>
                </div>
                <div>
                  <dt>
                    {t(
                      "Записей без связи с учётной записью",
                      "Тіркелгімен байланыспаған жазбалар",
                    )}
                  </dt>
                  <dd>{subjects.unlinkedRecipientRecords}</dd>
                </div>
              </dl>
              <p className="muted">
                {t(
                  "Общее число субъектов по всем базам оператора подтверждает владелец. Число записей не определяет категорию системы.",
                  "Оператордың барлық базаларындағы субъектілердің жалпы санын иесі растайды. Жазбалар саны жүйе санатын анықтамайды.",
                )}
              </p>
            </details>
          )}
        </>
      )}
    </details>
  );
}

function CalendarForm({
  t,
  timezone,
  onCreated,
}: {
  t: Translate;
  timezone: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [zone, setZone] = useState(timezone);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [sources, setSources] = useState("");
  const [nonWorking, setNonWorking] = useState("");
  const [working, setWorking] = useState("");
  const [weekend, setWeekend] = useState([0, 6]);
  const [synthetic, setSynthetic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const lines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/lms/sanitary/calendars", {
        method: "POST",
        body: json({
          name,
          timezone: zone,
          coverageFrom: from,
          coverageUntil: until,
          definition: {
            weekendDays: weekend,
            nonWorkingDates: lines(nonWorking),
            workingDates: lines(working),
            sources: lines(sources),
            synthetic,
          },
        }),
      });
      setSaved(true);
      onCreated();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        {t("Добавить версию календаря", "Күнтізбе нұсқасын қосу")}
      </summary>
      <form onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        {saved && (
          <p role="status">
            {t(
              "Версия сохранена. Её можно выбрать в программе курса.",
              "Нұсқа сақталды. Оны курс бағдарламасында таңдауға болады.",
            )}
          </p>
        )}
        <div className="lms-fields">
          <label>
            {t("Название календаря", "Күнтізбе атауы")}
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {t("Часовой пояс", "Уақыт белдеуі")}
            <input
              required
              value={zone}
              onChange={(event) => setZone(event.target.value)}
            />
          </label>
          <label>
            {t("Начало периода", "Кезеңнің басы")}
            <input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            {t("Конец периода", "Кезеңнің соңы")}
            <input
              required
              type="date"
              min={from}
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
        </div>
        <fieldset>
          <legend>{t("Выходные дни", "Демалыс күндері")}</legend>
          {[
            [1, "Пн", "Дс"],
            [2, "Вт", "Сс"],
            [3, "Ср", "Ср"],
            [4, "Чт", "Бс"],
            [5, "Пт", "Жм"],
            [6, "Сб", "Сб"],
            [0, "Вс", "Жс"],
          ].map(([day, ru, kz]) => (
            <label className="lms-inline-label" key={day}>
              <input
                type="checkbox"
                checked={weekend.includes(Number(day))}
                onChange={(event) =>
                  setWeekend((value) =>
                    event.target.checked
                      ? [...value, Number(day)]
                      : value.filter((v) => v !== day),
                  )
                }
              />
              {t(String(ru), String(kz))}
            </label>
          ))}
        </fieldset>
        <div className="lms-fields">
          <label>
            {t(
              "Нерабочие даты · ГГГГ-ММ-ДД, по одной в строке",
              "Жұмыс емес күндер · ЖЖЖЖ-АА-КК, әр жолға біреу",
            )}
            <textarea
              rows={4}
              value={nonWorking}
              onChange={(event) => setNonWorking(event.target.value)}
            />
          </label>
          <label>
            {t(
              "Рабочие переносы · ГГГГ-ММ-ДД, по одному в строке",
              "Ауыстырылған жұмыс күндері · ЖЖЖЖ-АА-КК, әр жолға біреу",
            )}
            <textarea
              rows={4}
              value={working}
              onChange={(event) => setWorking(event.target.value)}
            />
          </label>
        </div>
        <label>
          {t(
            "Источники календаря, по одному в строке",
            "Күнтізбе дереккөздері, әр жолға біреу",
          )}
          <textarea
            required
            rows={3}
            value={sources}
            onChange={(event) => setSources(event.target.value)}
          />
        </label>
        <label className="lms-inline-label">
          <input
            type="checkbox"
            checked={synthetic}
            onChange={(event) => setSynthetic(event.target.checked)}
          />
          {t(
            "Учебный календарь для проверки",
            "Тексеруге арналған оқу күнтізбесі",
          )}
        </label>
        <button className="primary" disabled={busy}>
          {t("Сохранить версию", "Нұсқаны сақтау")}
        </button>
      </form>
    </details>
  );
}

function AccessPolicy({ t, settings }: { t: Translate; settings: Settings }) {
  const [destination, setDestination] = useState(
    settings.connections[0]?.destination || "",
  );
  const [policy, setPolicy] = useState<DataAccessPolicy>(() =>
    dataAccessPolicySchema.parse(
      settings.connections[0]?.dataAccessPolicy || settings.dataAccessPolicy,
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  function change(key: keyof DataAccessPolicy, value: string) {
    setPolicy((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/lms/sanitary/settings", {
        method: "PUT",
        body: json({ destination, dataAccessPolicy: policy }),
      });
      setSaved(true);
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <p role="status">{t("Параметры сохранены", "Параметрлер сақталды")}</p>
      )}
      <label>
        {t("Получатель сведений", "Мәліметтер алушысы")}
        <input
          required
          value={destination}
          onChange={(event) => {
            setDestination(event.target.value);
            const current = settings.connections.find(
              (value) => value.destination === event.target.value,
            );
            if (current)
              setPolicy(dataAccessPolicySchema.parse(current.dataAccessPolicy));
            setSaved(false);
          }}
          list="lms-destinations"
        />
      </label>
      <datalist id="lms-destinations">
        {settings.connections.map((value) => (
          <option value={value.destination} key={value.destination} />
        ))}
      </datalist>
      <div className="lms-fields">
        {(
          [
            ["legalBasis", "Правовое основание", "Құқықтық негіз"],
            ["consentEvidence", "Подтверждение согласия", "Келісім растауы"],
            [
              "accessControlEvidence",
              "Подтверждение контроля доступа",
              "Қолжетімділікті бақылау растауы",
            ],
            [
              "operatorAuthorization",
              "Полномочия оператора",
              "Оператор өкілеттіктері",
            ],
            [
              "storageInventoryEvidence",
              "Подтверждение размещения хранилищ",
              "Қоймаларды орналастыру растауы",
            ],
          ] as const
        ).map(([key, ru, kz]) => (
          <label key={key}>
            {t(ru, kz)}
            <textarea
              rows={2}
              value={policy[key]}
              onChange={(event) => change(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="lms-fields">
        <label>
          {t("Контроль доступа", "Қолжетімділікті бақылау")}
          <select
            value={policy.accessControl}
            onChange={(event) => change("accessControl", event.target.value)}
          >
            <option value="UNKNOWN">
              {t("Требует проверки", "Тексеру қажет")}
            </option>
            <option value="REQUIRED">{t("Обязателен", "Міндетті")}</option>
            <option value="NOT_APPLICABLE">
              {t("Не применяется по основанию", "Негіз бойынша қолданылмайды")}
            </option>
          </select>
        </label>
        <label>
          {t("Страна размещения хранилищ", "Қоймалар орналасқан ел")}
          <select
            value={policy.storageCountry}
            onChange={(event) => change("storageCountry", event.target.value)}
          >
            <option value="">{t("Не подтверждена", "Расталмаған")}</option>
            <option value="KZ">{t("Казахстан", "Қазақстан")}</option>
          </select>
        </label>
      </div>
      <button className="primary" disabled={busy}>
        {t("Сохранить параметры", "Параметрлерді сақтау")}
      </button>
    </form>
  );
}
