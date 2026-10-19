"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { PageControls, lmsError, type Translate } from "./common";
type Detail = {
  id: string;
  canReview: boolean;
  canAssign: boolean;
  canAct: boolean;
  supervisors: { id: string; displayName: string }[];
  activeAttempt: { id: string; state: string; ordinal: number } | null;
  history: {
    id: string;
    revision: number;
    decision: string;
    feedback: string;
    createdAt: string;
    snapshot: {
      startsAt: string;
      endsAt: string;
      supervisorUserId: string;
      ordinal: number;
      identityConfirmed?: boolean;
      presenceConfirmed?: boolean;
      attemptId?: string;
    };
  }[];
};
const decisions = [
  ["ASSIGNED", "Наблюдатель назначен", "Бақылаушы тағайындалды"],
  [
    "ADMITTED",
    "Личность и присутствие подтверждены",
    "Жеке басы мен қатысуы расталды",
  ],
  ["INCIDENT", "Замечание по сессии", "Сессия бойынша ескерту"],
  [
    "APPROVED",
    "Попытка подтверждена наблюдателем",
    "Әрекетті бақылаушы растады",
  ],
  ["REJECTED", "Попытка не принята", "Әрекет қабылданбады"],
] as const;
function localTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function label(value: string, t: Translate) {
  const found = decisions.find(([key]) => key === value);
  return found ? t(found[1], found[2]) : value;
}

export function ProctoringQueue({ t }: { t: Translate }) {
  const [data, setData] = useState<{
      items: {
        id: string;
        learnerName: string;
        titleRu: string;
        titleKz: string;
      }[];
      total: number;
    }>({ items: [], total: 0 }),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api<typeof data>(
        `/lms/proctoring?${new URLSearchParams({ search, page: String(page) })}`,
      )
        .then((value) => {
          if (live) {
            setData(value);
            setError(null);
          }
        })
        .catch((caught) => {
          if (live) setError(caught);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, page]);
  return (
    <section className="panel lms-panel">
      <h2>
        {t(
          "Местный экзамен под наблюдением",
          "Бақылаушы қатысатын жергілікті емтихан",
        )}
      </h2>
      <p>
        {t(
          "Назначьте наблюдателя и время. Наблюдатель подтвердит личность и присутствие до старта, затем зафиксирует решение по завершённой попытке. После этого проверяющий выставит оценку в очереди работ.",
          "Бақылаушы мен уақытты тағайындаңыз. Бақылаушы басталғанға дейін жеке басы мен қатысуды растап, аяқталған әрекет бойынша шешім тіркейді. Содан кейін тексеруші жұмыстар кезегінде баға қояды.",
        )}
      </p>
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      <label>
        {t(
          "Поиск слушателя или программы",
          "Тыңдаушы немесе бағдарламаны іздеу",
        )}
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <ul className="lms-list">
        {data.items.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.learnerName}</strong> ·{" "}
              {t(item.titleRu, item.titleKz)}
            </span>
            <button onClick={() => setSelected(item.id)}>
              {t("Открыть сессию", "Сессияны ашу")}
            </button>
          </li>
        ))}
      </ul>
      {!data.total && !error && (
        <p>
          {t(
            "В доступных программах нет назначений с обязательным наблюдением.",
            "Қолжетімді бағдарламаларда міндетті бақылауы бар тағайындаулар жоқ.",
          )}
        </p>
      )}
      <PageControls
        page={page}
        total={data.total}
        pageSize={25}
        onPage={setPage}
        t={t}
      />
      {selected && (
        <ProctoringSession key={selected} enrollmentId={selected} t={t} />
      )}
    </section>
  );
}
export function ProctoringSession({
  enrollmentId,
  t,
}: {
  enrollmentId: string;
  t: Translate;
}) {
  const [data, setData] = useState<Detail | null>(null),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [supervisor, setSupervisor] = useState(""),
    [startsAt, setStartsAt] = useState(localTime(new Date())),
    [endsAt, setEndsAt] = useState(
      localTime(new Date(Date.now() + 2 * 3600000)),
    ),
    [identity, setIdentity] = useState(false),
    [presence, setPresence] = useState(false),
    [feedback, setFeedback] = useState("");
  useEffect(() => {
    let live = true;
    void api<Detail>(`/lms/enrollments/${enrollmentId}/proctoring`)
      .then((value) => {
        if (live) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (live) setError(caught);
      });
    return () => {
      live = false;
    };
  }, [enrollmentId, refresh]);
  async function act(decision: string) {
    if (!data) return;
    setBusy(true);
    try {
      const value = await api<Detail>(
        `/lms/enrollments/${enrollmentId}/proctoring`,
        {
          method: "POST",
          body: json({
            commandId: crypto.randomUUID(),
            revision: data.history[0]?.revision || 0,
            decision,
            feedback,
            identityConfirmed: identity,
            presenceConfirmed: presence,
            ...(decision === "ASSIGNED"
              ? {
                  supervisorUserId: supervisor,
                  startsAt: new Date(startsAt).toISOString(),
                  endsAt: new Date(endsAt).toISOString(),
                }
              : {}),
            ...(data.activeAttempt ? { attemptId: data.activeAttempt.id } : {}),
          }),
        },
      );
      setData(value);
      setError(null);
      setFeedback("");
      setIdentity(false);
      setPresence(false);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const current = data?.history[0];
  return (
    <section className="lms-panel">
      <h3>{t("Журнал контроля экзамена", "Емтиханды бақылау журналы")}</h3>
      <button
        type="button"
        disabled={busy}
        onClick={() => setRefresh((value) => value + 1)}
      >
        {t("Обновить сессию", "Сессияны жаңарту")}
      </button>
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      {current ? (
        <p>
          {label(current.decision, t)} ·{" "}
          {new Date(current.snapshot.startsAt).toLocaleString()} —{" "}
          {new Date(current.snapshot.endsAt).toLocaleString()}
        </p>
      ) : (
        <p>
          {t(
            "Сессия ещё не назначена. Учебный центр должен назначить наблюдателя и время.",
            "Сессия әлі тағайындалмаған. Оқу орталығы бақылаушы мен уақытты тағайындауы керек.",
          )}
        </p>
      )}
      {data?.canReview && (
        <fieldset disabled={busy}>
          <legend>{t("Действия наблюдателя", "Бақылаушы әрекеттері")}</legend>
          {data.canAssign && !data.activeAttempt && (
            <div className="lms-fields">
              <label>
                {t("Наблюдатель", "Бақылаушы")}
                <select
                  value={supervisor}
                  onChange={(event) => setSupervisor(event.target.value)}
                >
                  <option value="">
                    {t("Выберите сотрудника", "Қызметкерді таңдаңыз")}
                  </option>
                  {data.supervisors.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Начало сессии", "Сессияның басталуы")}
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </label>
              <label>
                {t("Окончание сессии", "Сессияның аяқталуы")}
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </label>
            </div>
          )}
          {data.canAct && (
            <>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={identity}
                  onChange={(event) => setIdentity(event.target.checked)}
                />
                {t(
                  "Личность слушателя проверена по документу лично",
                  "Тыңдаушының жеке басы құжат бойынша жеке тексерілді",
                )}
              </label>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={presence}
                  onChange={(event) => setPresence(event.target.checked)}
                />
                {t(
                  "Подтверждаю присутствие и наблюдение; замечания проверены",
                  "Қатысу мен бақылауды растаймын; ескертулер тексерілді",
                )}
              </label>
            </>
          )}
          <label>
            {t("Основание / замечания / решение", "Негіз / ескертулер / шешім")}
            <textarea
              required
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </label>
          <div className="lms-actions">
            {data.canAssign && !data.activeAttempt && (
              <button
                disabled={
                  !feedback.trim() || !supervisor || !startsAt || !endsAt
                }
                onClick={() => void act("ASSIGNED")}
              >
                {t(
                  "Назначить наблюдателя и время",
                  "Бақылаушы мен уақытты тағайындау",
                )}
              </button>
            )}
            {data.canAct &&
              !data.activeAttempt &&
              ["ASSIGNED", "ADMITTED"].includes(current?.decision || "") && (
                <button
                  className="primary"
                  disabled={!feedback.trim() || !identity || !presence}
                  onClick={() => void act("ADMITTED")}
                >
                  {t(
                    "Подтвердить личность и допустить",
                    "Жеке басын растап, рұқсат беру",
                  )}
                </button>
              )}
            {data.canAct && data.activeAttempt && (
              <>
                <button
                  disabled={!feedback.trim()}
                  onClick={() => void act("INCIDENT")}
                >
                  {t(
                    "Записать событие / замечание",
                    "Оқиға / ескертуді тіркеу",
                  )}
                </button>
                {data.activeAttempt.state === "AWAITING_REVIEW" && (
                  <>
                    <button
                      className="primary"
                      disabled={!feedback.trim() || !presence}
                      onClick={() => void act("APPROVED")}
                    >
                      {t(
                        "Подтвердить попытку для оценки",
                        "Бағалау үшін әрекетті растау",
                      )}
                    </button>
                    <button
                      disabled={!feedback.trim()}
                      onClick={() => void act("REJECTED")}
                    >
                      {t("Не принять попытку", "Әрекетті қабылдамау")}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </fieldset>
      )}
      <ol>
        {data?.history.map((row) => (
          <li key={row.id}>
            <strong>{label(row.decision, t)}</strong> ·{" "}
            {new Date(row.createdAt).toLocaleString()}
            <p>{row.feedback}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
