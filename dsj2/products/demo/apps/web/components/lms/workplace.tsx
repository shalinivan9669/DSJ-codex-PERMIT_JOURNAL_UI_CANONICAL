"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import type { Enrollment, Paged } from "@/lib/lms-api";
import { LmsHeading, Status, lmsError, type Translate } from "./common";
type Workplace = {
  timezone: string;
  enrollments: Paged<Enrollment>;
  calendar: {
    items: {
      id: string;
      titleRu: string;
      titleKz: string;
      startsAt: string;
      href: string;
      status: string;
    }[];
  };
  applications: {
    id: string;
    state: string;
    reason: string | null;
    enrollmentId: string | null;
    name: string;
    titleRu: string;
    titleKz: string;
    quantity: number;
    orderId: string | null;
  }[];
  imports: { id: string; state: string; errorCode: string | null }[];
};
function applicationStatus(state: string, t: Translate) {
  const values: Record<string, [string, string]> = {
    NEW: ["Ожидает принятия", "Қабылдауды күтуде"],
    PROCESSING: ["В обработке", "Өңделуде"],
    RETURNED: ["Нужно уточнение", "Нақтылау қажет"],
    ACCEPTED: ["Принята", "Қабылданды"],
    REJECTED: ["Отклонена", "Қабылданбады"],
    CANCELLED: ["Отменена", "Бас тартылды"],
  };
  return values[state]
    ? t(...values[state])
    : t("Проверить заявку", "Өтінімді тексеру");
}
export function WorkspaceCompanion({
  t,
  learner = false,
  employer = false,
  canManage = false,
  compact = false,
  canAssign = canManage,
}: {
  t: Translate;
  learner?: boolean;
  employer?: boolean;
  canManage?: boolean;
  compact?: boolean;
  canAssign?: boolean;
}) {
  const [data, setData] = useState<Workplace | null>(null),
    [error, setError] = useState<unknown>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let loading = false;
    const load = () => {
      if (loading || document.hidden) return;
      loading = true;
      void api<Workplace>("/lms/workplace")
      .then((value) => {
        if (alive) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (alive) {
          setError(caught);
          setData(null);
        }
      })
      .finally(() => { loading = false; });
    };
    load();
    const timer = setInterval(load, 20_000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [retry]);
  return (
    <>
      {!compact && (
        <LmsHeading title={t("Рабочий кабинет", "Жұмыс кабинеті")}>
          {!learner && canAssign && (
            <>
              <Link className="button primary lms-primary" href={employer ? "/lms/import" : "/lms/assign"}>
                {employer ? t("Добавить сотрудников", "Қызметкерлерді қосу") : t("Организовать обучение", "Оқуды ұйымдастыру")}
              </Link>
              <Link className="button" href={employer ? "/catalogue" : "/lms/applications?new=1"}>
                {t("Заполнить заявку", "Өтінімді толтыру")}
              </Link>
            </>
          )}
        </LmsHeading>
      )}

      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <button onClick={() => setRetry((value) => value + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {data && (
        <>
          {!!data.applications.length && (
            <section className="panel lms-panel">
              <h2>{t("Заявки на обучение", "Оқуға өтінімдер")}</h2>
              <ul className="lms-list">
                {data.applications.map((application) => (
                  <li key={application.id}>
                    <div>
                      <strong>{application.name || t(application.titleRu, application.titleKz || application.titleRu)}</strong>
                      <div className="lms-list-meta">{t(application.titleRu, application.titleKz || application.titleRu)} · {application.quantity}</div>
                      {applicationStatus(application.state, t)}
                      {application.reason && <p>{application.reason}</p>}
                    </div>
                    <Link
                      href={
                        application.enrollmentId
                          ? learner ? `/learn/${application.enrollmentId}` : `/lms/results?enrollmentId=${application.enrollmentId}`
                          : learner
                            ? "/learn/applications"
                            : `/lms/applications?id=${application.id}`
                      }
                    >
                      {application.enrollmentId && learner
                        ? t("Начать обучение", "Оқуды бастау")
                        : application.state === "ACCEPTED" && !learner
                          ? t("Продолжить состав и назначение", "Құрам мен тағайындауды жалғастыру")
                          : t("Открыть", "Ашу")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!compact && !!data.enrollments.items.length && (
            <section className="panel lms-panel">
              <h2>{t("Обучение и результат", "Оқу және нәтиже")}</h2>
              <ul className="lms-list">
                {data.enrollments.items.map((enrollment) => (
                  <li key={enrollment.id}>
                    <div>
                      {t(
                        enrollment.recipient?.data.fullNameRu || "",
                        enrollment.recipient?.data.fullNameKz || "",
                      )}{" "}
                      ·{" "}
                      {t(
                        enrollment.courseVersion?.content.titleRu || "",
                        enrollment.courseVersion?.content.titleKz || "",
                      )}
                      <div className="lms-list-meta">
                        {enrollment.progressPercent || 0}%
                        {enrollment.result && (
                          <Status
                            value={
                              enrollment.result.state ||
                              enrollment.result.verdict
                            }
                            t={t}
                          />
                        )}
                      </div>
                    </div>
                    <Link
                      href={
                        learner
                          ? `/learn/${enrollment.id}`
                          : `/lms/results?enrollmentId=${enrollment.id}`
                      }
                    >
                      {t("Открыть", "Ашу")}
                    </Link>
                  </li>
                ))}
              </ul>
              {data.enrollments.total > data.enrollments.items.length && (
                <Link href={learner ? "/learn" : "/lms/results"}>
                  {t("Весь список", "Барлық тізім")} · {data.enrollments.total}
                </Link>
              )}
            </section>
          )}
          {!!data.calendar.items.length && (
            <section className="panel lms-panel">
              <h2>
                {t(
                  "Ближайшие события и сроки",
                  "Алдағы оқиғалар мен мерзімдер",
                )}
              </h2>
              <ul className="lms-list">
                {data.calendar.items.map((event) => (
                  <li key={event.id}>
                    <span>
                      {t(event.titleRu, event.titleKz || event.titleRu)} ·{" "}
                      {new Date(event.startsAt).toLocaleString(
                        t("ru-KZ", "kk-KZ"),
                        {
                          timeZone: data.timezone,
                          dateStyle: "short",
                          timeStyle: "short",
                        },
                      )}
                    </span>
                    <Link href={event.href}>{t("Открыть", "Ашу")}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {canAssign && !!data.imports.length && (
            <section className="panel lms-panel">
              <h2>{t("Списки сотрудников", "Қызметкерлер тізімдері")}</h2>
              <ul className="lms-list">
                {data.imports.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {entry.state === "DRAFT"
                        ? t("Проверить список", "Тізімді тексеру")
                        : entry.state === "SUBMITTED"
                          ? t("Передан центру", "Орталыққа жіберілді")
                          : entry.errorCode
                            ? t("Нужно исправление", "Түзету қажет")
                            : t("Обрабатывается", "Өңделуде")}
                    </span>
                    <Link href={`/lms/import?id=${entry.id}`}>
                      {t("Открыть список", "Тізімді ашу")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!data.enrollments.total &&
            !data.applications.length &&
            !data.imports.length && (
              <p className="lms-empty">
                {t(
                  "Активных задач пока нет.",
                  "Әзірше белсенді тапсырмалар жоқ.",
                )}{" "}
                <Link href={learner ? "/catalogue" : canAssign ? "/lms/assign" : employer ? "/portal" : "/lms/teaching"}>
                  {learner ? t("Открыть программы", "Бағдарламаларды ашу") : canAssign ? t("Начать подготовку обучения", "Оқуды дайындауды бастау") : t("В мой кабинет", "Менің кабинетіме")}
                </Link>
              </p>
            )}
        </>
      )}
    </>
  );
}
