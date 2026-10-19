"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import {
  teachingApi,
  type CalendarPage,
  type TeachingEvent,
  type TeachingDetail,
  type TeachingList,
  type AttendanceRow,
  type LearningNotification,
} from "@/lib/learning-api";
import {
  isoToZonedInput as teachingLocalTime,
  zonedInputToIso as teachingUtcTime,
} from "@/lib/learning-time";
import {
  LmsErrorDiagnostic,
  LmsHeading,
  PageControls,
  lmsError,
  type Translate,
} from "./common";
import "./learning.css";
import { PracticeEditor } from "./practice-editor";

function ErrorNotice({
  error,
  t,
  retry,
}: {
  error: unknown;
  t: Translate;
  retry?: () => void;
}) {
  return error == null ? null : (
    <Notice>
      {error instanceof Error && error.message.startsWith("EVENT_LOCAL_TIME")
        ? t(
            "Проверьте дату и часовой пояс. Выбранное местное время не существует или неоднозначно при переводе часов.",
            "Күн мен уақыт белдеуін тексеріңіз. Сағат ауыстырылғанда таңдалған жергілікті уақыт жоқ немесе екіұшты.",
          )
        : lmsError(error, t)}
      <LmsErrorDiagnostic error={error} t={t} />
      {retry && (
        <button type="button" onClick={retry}>
          {t("Повторить", "Қайталау")}
        </button>
      )}
    </Notice>
  );
}
function eventDate(
  event: Pick<TeachingEvent, "startsAt" | "endsAt" | "timezone">,
  t: Translate,
) {
  return (
    new Intl.DateTimeFormat(t("ru-RU", "kk-KZ"), {
      timeZone: event.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(event.startsAt)) + ` (${event.timezone})`
  );
}
function EventLinks({ event, t }: { event: TeachingEvent; t: Translate }) {
  return (
    <div className="lms-actions">
      {event.status === "SCHEDULED" && event.joinUrl && (
        <a
          className="primary lms-primary"
          href={event.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Открыть занятие", "Сабақты ашу")}
        </a>
      )}
      {event.status !== "CANCELLED" && Date.parse(event.endsAt) <= Date.now() && (event.recordingUrl || event.recordingMaterialId) && (
        event.recordingMaterialId ? <details style={{ width: "100%" }}>
          <summary>{t("Посмотреть запись", "Жазбаны көру")}</summary>
          <video controls playsInline preload="metadata" style={{ width: "100%", maxWidth: 960 }} src={`/api/lms/materials/${event.recordingMaterialId}`} aria-label={t("Запись занятия", "Сабақ жазбасы")} />
          <p><a href={`/api/lms/materials/${event.recordingMaterialId}`} download>{t("Скачать запись", "Жазбаны жүктеп алу")}</a></p>
        </details> : <a href={event.recordingUrl!} target="_blank" rel="noopener noreferrer">
          {t("Посмотреть запись", "Жазбаны көру")}
        </a>
      )}
    </div>
  );
}

export function LearnerSession({
  enrollmentId,
  lessonId,
  t,
}: {
  enrollmentId: string;
  lessonId: string;
  t: Translate;
}) {
  const [data, setData] = useState<TeachingList | null>(null),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    void api<TeachingList>(
      `/lms/teaching-events?enrollmentId=${encodeURIComponent(enrollmentId)}&requirementId=${encodeURIComponent(lessonId)}`,
    )
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((caught) => {
        if (alive) setError(caught);
      });
    return () => {
      alive = false;
    };
  }, [enrollmentId, lessonId]);
  return (
    <div className="lms-panel">
      <ErrorNotice error={error} t={t} />
      {data?.items.map((event) => (
        <article key={event.id}>
          <strong>{t(event.titleRu, event.titleKz)}</strong>
          <p>
            {eventDate(event, t)} ·{" "}
            {event.status === "CANCELLED"
              ? t("Отменено", "Бас тартылды")
              : t("По расписанию", "Кесте бойынша")}
          </p>
          <EventLinks event={event} t={t} />
          {event.location && <p>{t("Место", "Орын")}: {event.location}</p>}
          {event.ownPractice && <p><strong>{event.ownPractice.decision === "ACCEPTED" ? t("Практика зачтена", "Практика қабылданды") : t("Практику нужно повторить", "Практиканы қайталау қажет")}</strong> · {event.ownPractice.feedback}</p>}
          {event.ownAttendance && (
            <p>
              {event.ownAttendance.status === "PRESENT"
                ? t(
                    "Преподаватель подтвердил ваше участие",
                    "Оқытушы қатысуыңызды растады",
                  )
                : t(
                    "Преподаватель отметил отсутствие",
                    "Оқытушы қатыспағаныңызды белгіледі",
                  )}
            </p>
          )}
        </article>
      ))}
      {data && !data.items.length && (
        <p>
          {t(
            "Занятие ещё не назначено. Преподаватель добавит дату в календарь.",
            "Сабақ әлі тағайындалмады. Оқытушы күнді күнтізбеге қосады.",
          )}
        </p>
      )}
      <p className="lms-save-state">
        {t(
          "Участие подтверждает преподаватель. Открытие ссылки не отмечает посещение.",
          "Қатысуды оқытушы растайды. Сілтемені ашу қатысу белгісі болмайды.",
        )}
      </p>
    </div>
  );
}

export function TeachingGroupEvents({
  groupId,
  t,
}: {
  groupId: string;
  t: Translate;
}) {
  const [data, setData] = useState<TeachingList | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState<unknown>(null),
    [editing, setEditing] = useState<TeachingEvent | "new" | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  async function load() {
    try {
      setData(await teachingApi.list(groupId, page));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }
  useEffect(() => {
    void load();
  }, [groupId, page]);
  return (
    <section className="panel lms-panel">
      <div className="lms-toolbar">
        <h2>{t("Занятия группы", "Топ сабақтары")}</h2>
        {data?.canSchedule && (
          <button
            className="primary lms-primary"
            onClick={() => setEditing("new")}
          >
            {t("Назначить занятие", "Сабақ тағайындау")}
          </button>
        )}
      </div>
      <ErrorNotice error={error} t={t} retry={() => void load()} />
      {editing && data && (
        <TeachingEventEditor
          groupId={groupId}
          initial={editing === "new" ? undefined : editing}
          requirements={data.requirements || []}
          teachers={data.teachers || []}
          t={t}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {data?.items.map((event) => (
        <article className="lms-event-row" key={event.id}>
          <div>
            <strong>{t(event.titleRu, event.titleKz)}</strong>
            <p>
              {eventDate(event, t)}
              {event.status === "CANCELLED"
                ? ` · ${t("Отменено", "Бас тартылды")}`
                : ""}
            </p>
          </div>
          <button
            onClick={() => setSelected(selected === event.id ? null : event.id)}
          >
            {t("Открыть занятие и участие", "Сабақты және қатысуды ашу")}
          </button>
          {selected === event.id && (
            <TeachingEventPanel
              id={event.id}
              t={t}
              onEdit={data.canSchedule ? () => setEditing(event) : undefined}
              onChanged={() => void load()}
            />
          )}
        </article>
      ))}
      {data && !data.items.length && (
        <p>{t("Занятий пока нет", "Әзірше сабақтар жоқ")}</p>
      )}
      {data && (
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize}
          onPage={setPage}
          t={t}
        />
      )}
    </section>
  );
}

function TeachingEventEditor({
  groupId,
  initial,
  requirements,
  teachers,
  t,
  onSaved,
  onClose,
}: {
  groupId: string;
  initial?: TeachingEvent;
  requirements: { id: string; titleRu: string; titleKz: string }[];
  teachers: { id: string; name: string }[];
  t: Translate;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [titleRu, setTitleRu] = useState(initial?.titleRu || ""),
    [titleKz, setTitleKz] = useState(initial?.titleKz || ""),
    [requirementId, setRequirement] = useState(initial?.requirementId || ""),
    [timezone, setTimezone] = useState(initial?.timezone || "Asia/Qyzylorda"),
    [startsAt, setStartsAt] = useState(
      initial ? teachingLocalTime(initial.startsAt, initial.timezone) : "",
    ),
    [endsAt, setEndsAt] = useState(
      initial ? teachingLocalTime(initial.endsAt, initial.timezone) : "",
    ),
    [teacherUserId, setTeacher] = useState(
      initial?.teacherUserId || (teachers.length === 1 ? teachers[0].id : ""),
    ),
    [joinUrl, setJoin] = useState(initial?.joinUrl || ""),
    [recordingUrl, setRecording] = useState(initial?.recordingUrl || ""),
    [recordingMaterialId, setRecordingMaterial] = useState(initial?.recordingMaterialId || ""),
    [recordings, setRecordings] = useState<Array<{ id: string; title: string; size: number }>>([]),
    [location, setLocation] = useState(initial?.location || ""),
    [practiceCriteria, setPracticeCriteria] = useState(initial?.practiceCriteria || []),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [commandId, setCommand] = useState(() => crypto.randomUUID());
  useEffect(() => { void api<{ items: Array<{ id: string; title: string; size: number }> }>(`/lms/groups/${groupId}/recordings`).then(value => setRecordings(value.items)).catch(setError); }, [groupId]);
  async function uploadRecording(file: File) {
    setBusy(true); setError(null);
    try {
      const body = new FormData(); body.set("file", file);
      const material = await api<{ id: string; title: string; size: number }>(`/lms/groups/${groupId}/recordings`, { method: "POST", body });
      setRecordings(value => [material, ...value]); setRecordingMaterial(material.id);
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      const body = {
        titleRu,
        titleKz,
        startsAt: teachingUtcTime(startsAt, timezone),
        endsAt: teachingUtcTime(endsAt, timezone),
        timezone,
        teacherUserId,
        joinUrl: joinUrl || null,
        recordingUrl: recordingUrl || null,
        recordingMaterialId: recordingMaterialId || null,
        location: location || null,
        practiceCriteria,
      };
      if (initial)
        await teachingApi.update(initial.id, {
          ...body,
          commandId,
          expectedRevision: initial.revision,
          reason,
        });
      else
        await teachingApi.create({
          ...body,
          groupId,
          requirementId: requirementId || null,
          operationId: commandId,
        });
      onSaved();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="lms-panel lms-event-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onChange={() => {
        if (error) setCommand(crypto.randomUUID());
      }}
    >
      <h3>
        {initial
          ? t("Изменение занятия", "Сабақты өзгерту")
          : t("Новое занятие", "Жаңа сабақ")}
      </h3>
      <ErrorNotice error={error} t={t} />
      <div className="lms-learning-fields">
        {!initial && (
          <label>
            {t("Требование программы", "Бағдарлама талабы")}
            <select
              value={requirementId}
              onChange={(event) => {
                setRequirement(event.target.value);
                const item = requirements.find(
                  (row) => row.id === event.target.value,
                );
                if (item) {
                  setTitleRu(item.titleRu);
                  setTitleKz(item.titleKz);
                }
              }}
            >
              <option value="">
                {t("Дополнительное занятие", "Қосымша сабақ")}
              </option>
              {requirements.map((row) => (
                <option key={row.id} value={row.id}>
                  {t(row.titleRu, row.titleKz)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t("Название на русском", "Орысша атауы")}
          <input
            required
            maxLength={500}
            value={titleRu}
            onChange={(event) => setTitleRu(event.target.value)}
          />
        </label>
        <label>
          {t("Название на казахском", "Қазақша атауы")}
          <input
            maxLength={500}
            value={titleKz}
            onChange={(event) => setTitleKz(event.target.value)}
          />
        </label>
        <label>
          {t("Преподаватель", "Оқытушы")}
          <select
            required
            value={teacherUserId}
            onChange={(event) => setTeacher(event.target.value)}
          >
            <option value="">
              {t("Выберите преподавателя", "Оқытушыны таңдаңыз")}
            </option>
            {teachers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Часовой пояс", "Уақыт белдеуі")}
          <input
            required
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </label>
        <label>
          {t("Начало занятия", "Сабақтың басталуы")}
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label>
          {t("Окончание занятия", "Сабақтың аяқталуы")}
          <input
            required
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </label>
        <label>
          {t("Ссылка на занятие", "Сабақ сілтемесі")}
          <input
            type="url"
            placeholder="https://"
            value={joinUrl}
            onChange={(event) => setJoin(event.target.value)}
          />
        </label>
        <label>
          {t("Ссылка на запись", "Жазба сілтемесі")}
          <input
            type="url"
            placeholder="https://"
            value={recordingUrl}
            onChange={(event) => setRecording(event.target.value)}
          />
        </label>
        <label>{t("Приватная запись", "Жеке жазба")}<select value={recordingMaterialId} onChange={event => setRecordingMaterial(event.target.value)}>
          <option value="">{t("Без файла записи", "Жазба файлынсыз")}</option>
          {recordings.map(row => <option key={row.id} value={row.id}>{row.title} · {Math.ceil(row.size / 1024 / 1024)} МБ</option>)}
        </select></label>
        <label>{t("Загрузить запись занятия", "Сабақ жазбасын жүктеу")}<input type="file" accept="video/mp4,video/webm" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadRecording(file); event.target.value = ""; }} /></label>
        <label>{t("Место проведения", "Өткізу орны")}<input value={location} maxLength={1000} onChange={event => setLocation(event.target.value)} /></label>
        {initial && (
          <label>
            {t("Причина изменения", "Өзгерту себебі")}
            <input
              required
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
      </div>
      <details open={practiceCriteria.length > 0}><summary>{t("Критерии очной практики", "Күндізгі практика критерийлері")}</summary>
        {practiceCriteria.map((criterion, index) => <div className="lms-fields" key={criterion.id}>
          <label>{t("Критерий RU", "Критерий RU")} {index + 1}<input required value={criterion.titleRu} onChange={event => setPracticeCriteria(rows => rows.map(row => row.id === criterion.id ? { ...row, titleRu: event.target.value } : row))} /></label>
          <label>{t("Критерий KZ", "Критерий KZ")} {index + 1}<input required value={criterion.titleKz} onChange={event => setPracticeCriteria(rows => rows.map(row => row.id === criterion.id ? { ...row, titleKz: event.target.value } : row))} /></label>
          <button type="button" onClick={() => setPracticeCriteria(rows => rows.filter(row => row.id !== criterion.id))}>{t("Убрать критерий", "Критерийді алып тастау")}</button>
        </div>)}
        <button type="button" onClick={() => setPracticeCriteria(rows => [...rows, { id: crypto.randomUUID(), titleRu: "", titleKz: "" }])}>{t("Добавить критерий", "Критерий қосу")}</button>
      </details>
      <div className="lms-actions">
        <button className="primary lms-primary" disabled={busy} type="submit">
          {busy
            ? t("Сохраняем…", "Сақталуда…")
            : initial
              ? t("Сохранить и уведомить", "Сақтау және хабарлау")
              : t("Назначить и уведомить", "Тағайындау және хабарлау")}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          {t("Закрыть", "Жабу")}
        </button>
      </div>
    </form>
  );
}

export function TeachingEventPanel({
  id,
  t,
  onEdit,
  onChanged,
}: {
  id: string;
  t: Translate;
  onEdit?: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<TeachingDetail | null>(null),
    [error, setError] = useState<unknown>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [commandId, setCommand] = useState(() => crypto.randomUUID());
  async function load() {
    try {
      setData(await teachingApi.detail(id));
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function cancel() {
    if (!data) return;
    setBusy(true);
    try {
      await teachingApi.cancel(id, {
        commandId,
        expectedRevision: data.event.revision,
        reason,
      });
      await load();
      onChanged?.();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lms-panel lms-event-detail">
      <ErrorNotice error={error} t={t} retry={() => void load()} />
      {data && (
        <>
          <h3>{t(data.event.titleRu, data.event.titleKz)}</h3>
          <p>
            {eventDate(data.event, t)} ·{" "}
            {data.event.status === "CANCELLED"
              ? t("Отменено", "Бас тартылды")
              : t("Запланировано", "Жоспарланды")}
          </p>
          <EventLinks event={data.event} t={t} />
          {data.canSchedule && data.event.status !== "CANCELLED" && (
            <details>
              <summary>
                {t("Изменить или отменить", "Өзгерту немесе бас тарту")}
              </summary>
              {onEdit && (
                <button onClick={onEdit}>
                  {t(
                    "Изменить расписание и ссылки",
                    "Кесте мен сілтемелерді өзгерту",
                  )}
                </button>
              )}
              <label>
                {t("Причина отмены", "Бас тарту себебі")}
                <input
                  value={reason}
                  maxLength={2000}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setCommand(crypto.randomUUID());
                  }}
                />
              </label>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => void cancel()}
              >
                {t("Отменить и уведомить", "Бас тарту және хабарлау")}
              </button>
            </details>
          )}
          {data.canAttend && <AttendanceEditor id={id} t={t} />}
          {data.canAttend && !!data.event.practiceCriteria?.length && <PracticeEditor id={id} t={t} />}
          <details>
            <summary>{t("История занятия", "Сабақ тарихы")}</summary>
            {data.history.map((row) => (
              <p key={row.id}>
                {new Date(row.createdAt).toLocaleString(t("ru-RU", "kk-KZ"))} ·{" "}
                {row.kind === "CREATED"
                  ? t("Назначено", "Тағайындалды")
                  : row.kind === "CANCELLED"
                    ? t("Отменено", "Бас тартылды")
                    : t("Изменено", "Өзгертілді")}{" "}
                {row.reason}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}

function AttendanceEditor({ id, t }: { id: string; t: Translate }) {
  const [data, setData] = useState<{
      items: AttendanceRow[];
      total: number;
      page: number;
      pageSize: number;
      canAttend: boolean;
      eventRevision: number;
    } | null>(null),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Record<string, "PRESENT" | "ABSENT">>(
      {},
    ),
    [reason, setReason] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [commandId, setCommand] = useState(() => crypto.randomUUID());
  async function load() {
    try {
      setData(await teachingApi.attendance(id, page));
      setSelected({});
      setError(null);
      setCommand(crypto.randomUUID());
    } catch (caught) {
      setError(caught);
    }
  }
  useEffect(() => {
    void load();
  }, [id, page]);
  async function save() {
    if (!data) return;
    setBusy(true);
    try {
      await teachingApi.saveAttendance(id, {
        commandId,
        expectedRevision: data.eventRevision,
        reason,
        items: data.items
          .filter((row) => !!selected[row.enrollmentId])
          .map((row) => ({
            enrollmentId: row.enrollmentId,
            status: selected[row.enrollmentId],
            expectedRevision: row.revision,
          })),
      });
      await load();
      setReason("");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lms-panel">
      <h4>{t("Ручная отметка участия", "Қатысуды қолмен белгілеу")}</h4>
      <ErrorNotice error={error} t={t} retry={() => void load()} />
      {data && (
        <>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={
                !!data.items.length &&
                data.items.every((row) => !!selected[row.enrollmentId])
              }
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? Object.fromEntries(
                        data.items.map((row) => [row.enrollmentId, "PRESENT"]),
                      )
                    : {},
                );
                setCommand(crypto.randomUUID());
              }}
            />
            {t(
              "Выбрать участников на этой странице",
              "Осы беттегі қатысушыларды таңдау",
            )}
          </label>
          <div className="lms-table-scroll">
            <table className="lms-table">
              <thead>
                <tr>
                  <th>{t("Участник", "Қатысушы")}</th>
                  <th>{t("Отметка", "Белгі")}</th>
                  <th>{t("История", "Тарих")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.enrollmentId}>
                    <td>
                      <label className="lms-inline-label">
                        <input
                          type="checkbox"
                          checked={!!selected[row.enrollmentId]}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = { ...current };
                              if (event.target.checked)
                                next[row.enrollmentId] = "PRESENT";
                              else delete next[row.enrollmentId];
                              return next;
                            });
                            setCommand(crypto.randomUUID());
                          }}
                        />
                        {t(row.nameRu, row.nameKz)}
                      </label>
                    </td>
                    <td>
                      {selected[row.enrollmentId] ? (
                        <select
                          aria-label={`${t("Участие", "Қатысу")}: ${t(row.nameRu, row.nameKz)}`}
                          value={selected[row.enrollmentId]}
                          onChange={(event) => {
                            setSelected((current) => ({
                              ...current,
                              [row.enrollmentId]: event.target.value as
                                | "PRESENT"
                                | "ABSENT",
                            }));
                            setCommand(crypto.randomUUID());
                          }}
                        >
                          <option value="PRESENT">
                            {t("Участвовал", "Қатысты")}
                          </option>
                          <option value="ABSENT">
                            {t("Не участвовал", "Қатыспады")}
                          </option>
                        </select>
                      ) : row.status === "PRESENT" ? (
                        t("Участвовал", "Қатысты")
                      ) : row.status === "ABSENT" ? (
                        t("Не участвовал", "Қатыспады")
                      ) : (
                        t("Не отмечено", "Белгіленбеген")
                      )}
                    </td>
                    <td>
                      {!!row.history.length && (
                        <details>
                          <summary>{row.history.length}</summary>
                          {row.history.map((entry) => (
                            <p key={entry.revision}>
                              {entry.status === "PRESENT"
                                ? t("Участвовал", "Қатысты")
                                : t("Не участвовал", "Қатыспады")}{" "}
                              · {entry.reason} ·{" "}
                              {entry.recordedAt.slice(0, 16).replace("T", " ")}
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PageControls
            page={page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
            t={t}
          />
          <label>
            {t(
              "Основание отметки или исправления",
              "Белгілеу немесе түзету негізі",
            )}
            <input
              value={reason}
              maxLength={2000}
              onChange={(event) => {
                setReason(event.target.value);
                setCommand(crypto.randomUUID());
              }}
            />
          </label>
          <button
            className="primary lms-primary"
            disabled={busy || !Object.keys(selected).length || !reason.trim()}
            onClick={() => void save()}
          >
            {busy
              ? t("Сохраняем…", "Сақталуда…")
              : `${t("Подтвердить участие выбранных", "Таңдалғандардың қатысуын растау")} · ${Object.keys(selected).length}`}
          </button>
        </>
      )}
    </section>
  );
}

export function LearningCalendar({ t }: { t: Translate }) {
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10)),
    [page, setPage] = useState(1),
    [data, setData] = useState<CalendarPage | null>(null),
    [error, setError] = useState<unknown>(null),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    setSelected(new URLSearchParams(window.location.search).get("eventId"));
  }, []);
  useEffect(() => {
    let alive = true;
    const start = new Date(`${from}T00:00:00.000Z`),
      end = new Date(start.getTime() + 31 * 86400000);
    if (!Number.isFinite(start.getTime())) return;
    void teachingApi
      .calendar(start.toISOString(), end.toISOString(), page)
      .then((value) => {
        if (alive) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (alive) setError(caught);
      });
    return () => {
      alive = false;
    };
  }, [from, page]);
  const labels: Record<string, [string, string]> = {
    SESSION: ["Занятие", "Сабақ"],
    COURSE_START: ["Начало обучения", "Оқудың басталуы"],
    COURSE_DUE: ["Срок обучения", "Оқу мерзімі"],
    EXAM_DUE: ["Срок экзамена", "Емтихан мерзімі"],
    ASSESSMENT_DUE: ["Срок задания или теста", "Тапсырма немесе тест мерзімі"],
  };
  return (
    <>
      <LmsHeading title={t("Учебный календарь", "Оқу күнтізбесі")} />
      <LearningNotifications t={t} onOpen={setSelected} />
      <section className="panel lms-panel">
        <label>
          {t("31 день начиная с", "31 күн, басталу күні")}
          <input
            type="date"
            value={from}
            onChange={(event) => {
              if (event.target.value) {
                setFrom(event.target.value);
                setPage(1);
              }
            }}
          />
        </label>
        <ErrorNotice error={error} t={t} />
        {data?.items.map((item) => (
          <article key={item.id} className="lms-event-row">
            <div>
              <strong>{t(item.titleRu, item.titleKz)}</strong>
              <p>
                {new Date(item.startsAt).toLocaleString(t("ru-RU", "kk-KZ"), {
                  timeZone: item.timezone || "UTC",
                })}{" "}
                ({item.timezone || "UTC"}) ·{" "}
                {t(...(labels[item.kind] || [item.kind, item.kind]))}
                {item.status === "CANCELLED"
                  ? ` · ${t("Отменено", "Бас тартылды")}`
                  : ""}
              </p>
            </div>
            {item.kind === "SESSION" ? (
              <button onClick={() => setSelected(item.id.slice(6))}>
                {t("Открыть", "Ашу")}
              </button>
            ) : (
              <Link href={item.href}>{t("К обучению", "Оқуға өту")}</Link>
            )}
          </article>
        ))}
        {data && !data.items.length && (
          <p>{t("В этом периоде событий нет", "Бұл кезеңде оқиғалар жоқ")}</p>
        )}
        {data && (
          <PageControls
            page={page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
            t={t}
          />
        )}
      </section>
      {selected && <TeachingEventPanel key={selected} id={selected} t={t} />}
    </>
  );
}
function LearningNotifications({
  t,
  onOpen,
}: {
  t: Translate;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<LearningNotification[]>([]),
    [error, setError] = useState<unknown>(null),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [pageSize, setPageSize] = useState(50);
  useEffect(() => {
    void teachingApi
      .notifications(page)
      .then((value) => {
        setItems(value.items);
        setTotal(value.total);
        setPageSize(value.pageSize);
        setError(null);
      })
      .catch(setError);
  }, [page]);
  async function read(item: LearningNotification) {
    try {
      await teachingApi.readNotification(item.id);
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, readAt: new Date().toISOString() }
            : row,
        ),
      );
      onOpen(item.eventId);
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <details className="panel lms-panel">
      <summary>
        {t("Уведомления об обучении", "Оқу туралы хабарламалар")} · {total}
      </summary>
      <ErrorNotice error={error} t={t} />
      {items.map((item) => (
        <div key={item.id} className="lms-event-row">
          <span>
            {item.kind === "CANCELLED"
              ? t("Занятие отменено", "Сабақтан бас тартылды")
              : item.kind === "UPDATED"
                ? t("Занятие изменено", "Сабақ өзгертілді")
                : t("Назначено занятие", "Сабақ тағайындалды")}
            : {t(item.titleRu, item.titleKz)}{" "}
            {item.readAt ? ` · ${t("Прочитано", "Оқылды")}` : ""}
          </span>
          <button onClick={() => void read(item)}>
            {t("Прочитать и открыть", "Оқу және ашу")}
          </button>
        </div>
      ))}
      <PageControls
        page={page}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
        t={t}
      />
    </details>
  );
}
