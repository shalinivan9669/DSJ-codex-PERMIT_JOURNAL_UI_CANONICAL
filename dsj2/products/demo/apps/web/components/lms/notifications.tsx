"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, json } from "@/lib/api";
import { formatLearningDateTime } from "@/lib/learning-date-format";
import { learningNotificationLink } from "@/lib/learning-notification-link";
import {
  lmsError,
  LmsErrorDiagnostic,
  LmsHeading,
  type Translate,
} from "./common";
type Notification = {
  id: string;
  kind: string;
  status: string | null;
  startsAt: string;
  eventId: string | null;
  titleRu: string;
  titleKz: string;
  createdAt: string;
  readAt: string | null;
  href: string | null;
  reviewState?: string | null;
};
type Inbox = {
  items: Notification[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
};
export function LearningInbox({
  t,
  timezone,
}: {
  t: Translate;
  timezone: string;
}) {
  const pathname = usePathname();
  const [page, setPage] = useState(1),
    [data, setData] = useState<Inbox | null>(null),
    [error, setError] = useState<unknown>(null),
    [markError, setMarkError] = useState<{
      id?: string;
      error: unknown;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [badge, setBadge] = useState(true),
    [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const currentData = data?.page === page ? data : null;
  const errorDetails = error instanceof ApiError ? error.details : error;
  const deploymentBlocked =
    !!errorDetails &&
    typeof errorDetails === "object" &&
    "code" in errorDetails &&
    errorDetails.code === "LMS_DEPLOYMENT_REVIEW_REQUIRED";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void api<{ preferences: { showUnreadBadge?: boolean } }>("/lms/profile")
      .then((v) => {
        if (alive) setBadge(v.preferences.showUnreadBadge !== false);
      })
      .catch(() => {
        /* Badge preference is optional; inbox data is loaded separately. */
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true,
      fetching = false;
    setLoading(true);
    setError(null);
    async function load() {
      if (fetching || document.hidden || pending.current) return;
      fetching = true;
      try {
        const result = await api<Inbox>(
          `/lms/notifications?page=${page}&pageSize=25`,
        );
        if (alive) {
          const lastPage = Math.max(
            1,
            Math.ceil(result.total / result.pageSize),
          );
          if (page > lastPage) {
            setPage(lastPage);
            setData(null);
          } else setData(result);
          setError(null);
        }
      } catch (e) {
        if (alive) {
          setError(e);
          setData(null);
        }
      } finally {
        fetching = false;
        if (alive) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [page, revision]);
  async function mark(id?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMarkError(null);
    try {
      await api(
        id ? `/lms/notifications/${id}/read` : "/lms/notifications/read-all",
        { method: "POST", body: json({}) },
      );
      if (mounted.current) setRevision((v) => v + 1);
    } catch (e) {
      if (mounted.current) setMarkError({ id, error: e });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Уведомления", "Хабарламалар")}>
        {badge && currentData && !error && (
          <span aria-live="polite">
            {t("Непрочитанные", "Оқылмаған")}: {currentData.unread}
          </span>
        )}
        {!!currentData?.unread && !error && (
          <button disabled={busy || loading} onClick={() => void mark()}>
            {t("Отметить все прочитанными", "Барлығын оқылған деп белгілеу")}
          </button>
        )}
      </LmsHeading>
      {!!error && (
        <div role="alert" className="notice">
          <strong>
            {t("Уведомления недоступны", "Хабарламалар қолжетімсіз")}
          </strong>
          <p>{lmsError(error, t)}</p>
          <LmsErrorDiagnostic error={error} t={t} />
          <button
            disabled={busy || loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            {deploymentBlocked
              ? t("Проверить доступ", "Қолжетімділікті тексеру")
              : t("Повторить загрузку", "Қайта жүктеу")}
          </button>
        </div>
      )}
      {markError && (
        <div role="alert" className="notice">
          <strong>
            {t(
              "Не удалось отметить прочитанным",
              "Оқылған деп белгілеу мүмкін болмады",
            )}
          </strong>
          <p>{lmsError(markError.error, t)}</p>
          <LmsErrorDiagnostic error={markError.error} t={t} />
          <button disabled={busy} onClick={() => void mark(markError.id)}>
            {t("Повторить отметку", "Белгілеуді қайталау")}
          </button>
        </div>
      )}
      {loading && !currentData && !error && (
        <p role="status">
          {t("Загружаем уведомления…", "Хабарламалар жүктелуде…")}
        </p>
      )}
      {currentData && !loading && !error && !currentData.total && (
        <p>{t("Новых событий пока нет", "Әзірше жаңа оқиғалар жоқ")}</p>
      )}
      <ul className="lms-list lms-inbox-list">
        {currentData?.items.map((n) => (
          <li key={n.id}>
            <div>
              <strong>{t(n.titleRu, n.titleKz || n.titleRu)}</strong>
              {!n.readAt && <small>{t("Не прочитано", "Оқылмаған")}</small>}
              {n.reviewState && (
                <small>
                  {["SUBMITTED", "AWAITING_REVIEW"].includes(n.reviewState)
                    ? t(
                        "Ожидает решения проверяющего",
                        "Тексерушінің шешімін күтуде",
                      )
                    : t("Работа обновлена", "Жұмыс жаңартылды")}
                </small>
              )}
              {n.eventId && (
                <small>
                  {n.status === "CANCELLED"
                    ? t("Занятие отменено", "Сабақ тоқтатылды")
                    : n.kind === "UPDATED"
                      ? t("Занятие изменено", "Сабақ өзгертілді")
                      : t("Занятие назначено", "Сабақ тағайындалды")}
                  {" · "}
                  {formatLearningDateTime(
                    n.startsAt,
                    timezone,
                    t("ru-KZ", "kk-KZ"),
                  )}
                </small>
              )}
              {!n.eventId && (
                <small>
                  {formatLearningDateTime(
                    n.createdAt,
                    timezone,
                    t("ru-KZ", "kk-KZ"),
                  )}
                </small>
              )}
            </div>
            <div className="lms-actions">
              {learningNotificationLink(n, pathname) && (
                <Link
                  href={learningNotificationLink(n, pathname)!}
                  onClick={() => {
                    if (!n.readAt) void mark(n.id);
                  }}
                >
                  {t("Открыть", "Ашу")}
                </Link>
              )}
              {!n.readAt && (
                <button disabled={busy} onClick={() => void mark(n.id)}>
                  {t("Отметить прочитанным", "Оқылған деп белгілеу")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!!currentData && !error && currentData.total > currentData.pageSize && (
        <nav
          className="lms-actions"
          aria-label={t("Страницы уведомлений", "Хабарлама беттері")}
        >
          <button
            disabled={busy || loading || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("Назад", "Артқа")}
          </button>
          <span>
            {page} / {Math.ceil(currentData.total / currentData.pageSize)}
          </span>
          <button
            disabled={
              busy ||
              loading ||
              page * currentData.pageSize >= currentData.total
            }
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Далее", "Келесі")}
          </button>
        </nav>
      )}
    </>
  );
}
