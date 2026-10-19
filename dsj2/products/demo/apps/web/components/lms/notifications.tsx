"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, json } from "@/lib/api";
import { lmsError, LmsHeading, type Translate } from "./common";
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
    [busy, setBusy] = useState(false),
    [badge, setBadge] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<{ preferences: { showUnreadBadge?: boolean } }>("/lms/profile")
      .then((v) => { if (alive) setBadge(v.preferences.showUnreadBadge !== false); })
      .catch(() => { /* Badge preference is optional; inbox data is loaded separately. */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true,
      loading = false;
    async function load() {
      if (loading || document.hidden) return;
      loading = true;
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
        if (alive) { setError(e); setData(null); }
      } finally {
        loading = false;
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
    setBusy(true);
    setError(null);
    try {
      await api(
        id ? `/lms/notifications/${id}/read` : "/lms/notifications/read-all",
        { method: "POST", body: json({}) },
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Уведомления", "Хабарламалар")}>
        {badge && data && (
          <span aria-live="polite">
            {t("Непрочитанные", "Оқылмаған")}: {data.unread}
          </span>
        )}
        {!!data?.unread && (
          <button disabled={busy} onClick={() => void mark()}>
            {t("Отметить все прочитанными", "Барлығын оқылған деп белгілеу")}
          </button>
        )}
      </LmsHeading>
      {!!error && (
        <div role="alert" className="notice">
          {lmsError(error, t)}
          <button onClick={() => setRevision((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </div>
      )}
      {!data && !error && (
        <p role="status">
          {t("Загружаем уведомления…", "Хабарламалар жүктелуде…")}
        </p>
      )}
      {data && !data.total && (
        <p>{t("Новых событий пока нет", "Әзірше жаңа оқиғалар жоқ")}</p>
      )}
      <ul className="lms-list">
        {data?.items.map((n) => (
          <li key={n.id}>
            <div>
              <strong>{t(n.titleRu, n.titleKz || n.titleRu)}</strong>
              {!n.readAt && <small>{t("Не прочитано", "Оқылмаған")}</small>}
              {n.reviewState && <small>{["SUBMITTED", "AWAITING_REVIEW"].includes(n.reviewState)
                ? t("Ожидает решения проверяющего", "Тексерушінің шешімін күтуде")
                : t("Состояние работы изменилось — откройте текущую редакцию", "Жұмыс күйі өзгерді — ағымдағы нұсқаны ашыңыз")}</small>}
              {n.eventId && (
                <small>
                  {n.status === "CANCELLED"
                    ? t("Занятие отменено", "Сабақ тоқтатылды")
                    : n.kind === "UPDATED"
                      ? t("Занятие изменено", "Сабақ өзгертілді")
                      : t("Занятие назначено", "Сабақ тағайындалды")}
                  {" · "}
                  {new Date(n.startsAt).toLocaleString(t("ru-KZ", "kk-KZ"), {
                    timeZone: timezone,
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </small>
              )}
              <small>
                {new Date(n.createdAt).toLocaleString(t("ru-KZ", "kk-KZ"), {
                  timeZone: timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </small>
            </div>
            <div className="lms-actions">
              {(n.href || n.eventId) && (
                <Link
                  href={n.href?.startsWith("/") && !n.href.startsWith("//") ? n.href : `${pathname.startsWith("/learn") ? "/learn" : "/lms"}/calendar?eventId=${encodeURIComponent(n.eventId || "")}`}
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
      {!!data && data.total > data.pageSize && (
        <nav
          className="lms-actions"
          aria-label={t("Страницы уведомлений", "Хабарлама беттері")}
        >
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            {t("Назад", "Артқа")}
          </button>
          <span>
            {page} / {Math.ceil(data.total / data.pageSize)}
          </span>
          <button
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Далее", "Келесі")}
          </button>
        </nav>
      )}
    </>
  );
}
