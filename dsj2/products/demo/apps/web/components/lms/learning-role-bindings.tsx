"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import {
  LmsErrorDiagnostic,
  LmsHeading,
  lmsError,
  type Translate,
} from "./common";

import { TeachingChoiceSearch, useTeachingContext } from "./teaching-context";

type Role = "TEACHER" | "METHODIST" | "EXPERT";
type Binding = {
  id: string;
  role: Role;
  courseId: string;
  groupId?: string | null;
  revokedAt?: string | null;
  user: { id: string; displayName: string; email: string };
  course: { id: string; titleRu: string; titleKz: string };
  group?: { id: string; name: string } | null;
  allowedActions: string[];
};
const roles = [
  ["TEACHER", "Преподаватель", "Оқытушы"],
  ["METHODIST", "Методист", "Әдіскер"],
  ["EXPERT", "Эксперт / член комиссии", "Сарапшы / комиссия мүшесі"],
] as const;
export function LearningRoleBindings({ t, canManageAccounts = false }: { t: Translate; canManageAccounts?: boolean }) {
  const [data, setData] = useState<{ items: Binding[]; total: number } | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    courseId: "",
    groupId: "",
    role: "TEACHER" as Role,
  });
  const choices = useTeachingContext({
    ...form,
    groupCourseId: form.courseId,
    refresh,
  });
  const context = choices.context;
  const canManage = canManageAccounts && !!context?.canManage && !choices.error;
  const [revoke, setRevoke] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const courseId = query.get("courseId"), groupId = query.get("groupId");
    if (courseId && /^[a-zA-Z0-9_-]{1,100}$/.test(courseId)) {
      setForm(previous => ({ ...previous, courseId, groupId: groupId && /^[a-zA-Z0-9_-]{1,100}$/.test(groupId) ? groupId : "" }));
      setCreating(true);
    }
  }, []);
  useEffect(() => {
    let live = true;
    void api<{ items: Binding[]; total: number }>(
      `/lms/learning-bindings?page=${page}&pageSize=25`,
    )
      .then((value) => {
        if (live) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (live) { setError(caught); setData(null); }
      });
    return () => {
      live = false;
    };
  }, [page, refresh]);
  async function save() {
    if (!canManage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/lms/learning-bindings", {
        method: "POST",
        body: json({ ...form, groupId: form.groupId || null }),
      });
      setRefresh((value) => value + 1);
      setCreating(false);
      setSaved(true);
      setPage(1);
      setForm(previous => ({ ...previous, userId: "" }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function revokeBinding() {
    if (!revoke || !canManage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/lms/learning-bindings/${encodeURIComponent(revoke)}/revoke`, {
        method: "POST",
        body: json({ reason }),
      });
      setRevoke(null);
      setReason("");
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Учебные полномочия", "Оқу өкілеттіктері")}>
        {canManage && !creating && <button type="button" className="primary lms-primary" onClick={() => { setCreating(true); setSaved(false); setRevoke(null); }}>{t("Назначить полномочия", "Өкілеттіктерді тағайындау")}</button>}
        {creating ? <button type="button" disabled={busy} onClick={() => setCreating(false)}>{t("К списку назначений", "Тағайындаулар тізіміне")}</button> : canManageAccounts && <Link href="/settings?tab=users">{t("Пользователи центра", "Орталық пайдаланушылары")}</Link>}
      </LmsHeading>
      {saved && <p role="status">{t("Учебные полномочия назначены", "Оқу өкілеттіктері тағайындалды")}</p>}
      {!!(error || choices.error) && (
        <Notice>
          {lmsError(error || choices.error, t)}
          <LmsErrorDiagnostic error={error || choices.error} t={t} />
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {canManage && context && creating && (
        <form
          className="panel lms-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2>{t("Назначить учебную роль", "Оқу рөлін тағайындау")}</h2>
          <fieldset disabled={busy}>
            <div className="lms-fields">
              {(context.usersTotal > context.pageSize || choices.query.userSearch) && <TeachingChoiceSearch choices={choices} kind="user" t={t} />}
              {(context.coursesTotal > context.pageSize || choices.query.courseSearch) && <TeachingChoiceSearch choices={choices} kind="course" t={t} />}
              {form.role !== "METHODIST" && (context.groupsTotal > context.pageSize || choices.query.groupSearch) && (
                <TeachingChoiceSearch choices={choices} kind="group" t={t} />
              )}
            </div>
            <div className="lms-fields">
              <label>
                {t("Пользователь", "Пайдаланушы")}
                <select
                  required
                  value={form.userId}
                  onChange={(event) =>
                    setForm({ ...form, userId: event.target.value })
                  }
                >
                  <option value="">
                    {t("Выберите пользователя", "Пайдаланушыны таңдаңыз")}
                  </option>
                  {context.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.displayName} · {user.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Роль", "Рөл")}
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      role: event.target.value as Role,
                      groupId: "",
                    })
                  }
                >
                  {roles.map(([value, ru, kz]) => (
                    <option key={value} value={value}>
                      {t(ru, kz)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Курс", "Курс")}
                <select
                  required
                  value={form.courseId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      courseId: event.target.value,
                      groupId: "",
                    })
                  }
                >
                  <option value="">
                    {t("Выберите курс", "Курсты таңдаңыз")}
                  </option>
                  {form.courseId && !context.courses.some(course => course.id === form.courseId) && <option value={form.courseId}>{t("Выбранная программа", "Таңдалған бағдарлама")}</option>}
                  {context.courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {t(course.titleRu, course.titleKz)}
                    </option>
                  ))}
                </select>
              </label>
              {form.role !== "METHODIST" && <label>
                {t("Область группы", "Топ ауқымы")}
                <select
                  value={form.groupId}
                  disabled={!form.courseId}
                  onChange={(event) =>
                    setForm({ ...form, groupId: event.target.value })
                  }
                >
                  <option value="">
                    {t("Все группы этого курса", "Осы курстың барлық топтары")}
                  </option>
                  {form.groupId && !context.groups.some(group => group.id === form.groupId) && <option value={form.groupId}>{t("Выбранная группа", "Таңдалған топ")}</option>}
                  {context.groups
                    .filter((group) => group.courseId === form.courseId)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>
              </label>}
            </div>
            <p className="muted">
              {form.role === "TEACHER"
                ? t(
                    "Проверка работ, занятия и посещаемость в назначенной области.",
                    "Тағайындалған ауқымда жұмыстарды тексеру, сабақтар және қатысу.",
                  )
                : form.role === "METHODIST"
                  ? t(
                      "Редактирование черновиков и материалов в назначенной области.",
                      "Тағайындалған ауқымда жобалар мен материалдарды өңдеу.",
                    )
                  : t(
                      "Просмотр результатов и проверка работ. Подпись документов требует отдельного полномочия.",
                      "Нәтижелерді қарау және жұмыстарды тексеру. Құжаттарға қол қою үшін бөлек өкілеттік қажет.",
                    )}
            </p>
            <button
              type="submit"
              className="primary lms-primary"
              disabled={!form.userId || !form.courseId}
            >
              {t("Назначить роль", "Рөл тағайындау")}
            </button>
          </fieldset>
        </form>
      )}
      {!creating && <section className="panel lms-panel">
        <h2>{t("Назначения", "Тағайындаулар")}</h2>
        <ul className="lms-list">
          {data?.items.map((binding) => (
            <li key={binding.id}>
              <div>
                <strong>{binding.user.displayName}</strong>
                <p>
                  {(() => {
                    const role = roles.find(
                      ([value]) => value === binding.role,
                    );
                    return role ? t(role[1], role[2]) : binding.role;
                  })()}{" "}
                  · {t(binding.course.titleRu, binding.course.titleKz)} ·{" "}
                  {binding.role === "METHODIST" ? t("Материалы программы", "Бағдарлама материалдары") : binding.group?.name || t("Все группы курса", "Курстың барлық топтары")}
                </p>
                {binding.revokedAt && (
                  <p>{t("Роль отозвана", "Рөл қайтарылған")}</p>
                )}
              </div>
              {canManage && binding.allowedActions.includes("revoke") && !binding.revokedAt && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setRevoke(binding.id);
                    setReason("");
                  }}
                >
                  {t("Отозвать", "Қайтарып алу")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {data && !data.items.length && (
          <p>{t("Учебных назначений нет", "Оқу тағайындаулары жоқ")}</p>
        )}
        {data && data.total > 25 && (
          <div className="lms-actions">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t("Назад", "Артқа")}
            </button>
            <span>
              {page} / {Math.ceil(data.total / 25)}
            </span>
            <button
              type="button"
              disabled={page * 25 >= data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("Далее", "Әрі қарай")}
            </button>
          </div>
        )}
      </section>}
      {revoke && canManage && (
        <form
          className="panel lms-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void revokeBinding();
          }}
        >
          <label>
            {t("Причина отзыва", "Қайтарып алу себебі")}
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="lms-actions">
            <button type="submit" disabled={busy || !reason.trim()}>
              {t("Отозвать назначение", "Тағайындауды қайтарып алу")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRevoke(null)}
            >
              {t("Оставить назначение", "Тағайындауды сақтау")}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
