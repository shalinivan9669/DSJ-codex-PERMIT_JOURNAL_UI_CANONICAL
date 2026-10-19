"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { lmsError, type Translate } from "./common";

type Choice = "user" | "course" | "group";
export type TeachingContext = {
  users: { id: string; displayName: string; email: string; role: string }[];
  courses: { id: string; titleRu: string; titleKz: string }[];
  groups: {
    id: string;
    name: string;
    courseVersionId: string;
    courseId: string;
  }[];
  usersTotal: number;
  coursesTotal: number;
  groupsTotal: number;
  canManage: boolean;
  pageSize: number;
};
export function useTeachingContext({
  userId = "",
  courseId = "",
  groupId = "",
  groupCourseId = "",
  excludeCourseId = "",
  refresh = 0,
}: {
  userId?: string;
  courseId?: string;
  groupId?: string;
  groupCourseId?: string;
  excludeCourseId?: string;
  refresh?: number;
} = {}) {
  const [context, setContext] = useState<TeachingContext | null>(null);
  const [query, setQuery] = useState({
    userSearch: "",
    courseSearch: "",
    groupSearch: "",
    userPage: 1,
    coursePage: 1,
    groupPage: 1,
  });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const selected = useRef({ userId, courseId, groupId });
  selected.current = { userId, courseId, groupId };
  useEffect(() => {
    setQuery((previous) => ({ ...previous, groupPage: 1 }));
  }, [groupCourseId]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        search: query.userSearch,
        courseSearch: query.courseSearch,
        groupSearch: query.groupSearch,
        userPage: String(query.userPage),
        coursePage: String(query.coursePage),
        groupPage: String(query.groupPage),
        pageSize: "25",
      });
      if (groupCourseId) params.set("groupCourseId", groupCourseId);
      if (excludeCourseId) params.set("excludeCourseId", excludeCourseId);
      void api<TeachingContext>(`/lms/teaching-context?${params}`)
        .then((value) => {
          if (!live) return;
          setContext((previous) => ({
            ...value,
            users: [
              ...value.users,
              ...(previous?.users.filter(
                (item) =>
                  item.id === selected.current.userId &&
                  !value.users.some((next) => next.id === item.id),
              ) || []),
            ],
            courses: [
              ...value.courses,
              ...(previous?.courses.filter(
                (item) =>
                  item.id === selected.current.courseId &&
                  !value.courses.some((next) => next.id === item.id),
              ) || []),
            ],
            groups: [
              ...value.groups,
              ...(previous?.groups.filter(
                (item) =>
                  item.id === selected.current.groupId &&
                  !value.groups.some((next) => next.id === item.id),
              ) || []),
            ],
          }));
          setError(null);
        })
        .catch((caught) => {
          if (live) setError(caught);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, groupCourseId, excludeCourseId, refresh]);
  function search(kind: Choice, value: string) {
    setQuery((previous) => ({
      ...previous,
      [`${kind}Search`]: value,
      [`${kind}Page`]: 1,
    }));
  }
  function page(kind: Choice, value: number) {
    setQuery((previous) => ({ ...previous, [`${kind}Page`]: value }));
  }
  return { context, query, error, loading, search, page };
}
export function TeachingChoiceSearch({
  choices,
  kind,
  t,
}: {
  choices: ReturnType<typeof useTeachingContext>;
  kind: Choice;
  t: Translate;
}) {
  const names = {
    user: t("Поиск пользователя", "Пайдаланушыны іздеу"),
    course: t("Поиск курса", "Курсты іздеу"),
    group: t("Поиск группы", "Топты іздеу"),
  };
  const page = choices.query[`${kind}Page`];
  const total = choices.context?.[`${kind}sTotal`] || 0;
  const pages = Math.max(
    1,
    Math.ceil(total / (choices.context?.pageSize || 25)),
  );
  return (
    <div className="lms-choice-search" aria-busy={choices.loading}>
      <label>
        {names[kind]}
        <input
          type="search"
          value={choices.query[`${kind}Search`]}
          onChange={(event) => choices.search(kind, event.target.value)}
        />
      </label>
      <div className="lms-actions" aria-label={names[kind]}>
        <button
          type="button"
          disabled={choices.loading || page <= 1}
          onClick={() => choices.page(kind, page - 1)}
        >
          {t("Назад", "Артқа")}
        </button>
        <span>
          {t("Найдено", "Табылды")}: {total} · {page} / {pages}
        </span>
        <button
          type="button"
          disabled={choices.loading || page >= pages}
          onClick={() => choices.page(kind, page + 1)}
        >
          {t("Далее", "Әрі қарай")}
        </button>
      </div>
      {!!choices.error && <p role="alert">{lmsError(choices.error, t)}</p>}
    </div>
  );
}
