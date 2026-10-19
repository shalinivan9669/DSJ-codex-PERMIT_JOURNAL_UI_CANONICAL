"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import type { ResultEnrollment } from "@/lib/results-api";
import { LmsHeading, PageControls, lmsError, type Translate } from "./common";
import { TeachingGroupEvents } from "./teaching-calendar";
import type { AccessPolicy } from "@demo/contracts/src/lms";
import { AccessPolicyEditor } from "./access-policy-editor";
import { LearnerAccess } from "./learner-access";

type GroupData = {
  group: {
    id: string;
    name: string;
    courseVersionId: string;
    dueAt: string | null;
    startsAt?: string | null;
    accessPolicy?: AccessPolicy | null;
    sourceRequestId?: string | null;
    sourceOrderId?: string | null;
    customerId?: string | null;
  };
  items: ResultEnrollment[];
  total: number;
  page: number;
  pageSize: number;
  excluded: {
    id: string;
    recipientId: string;
    excludedAt: string;
    recipient?: { fullNameRu?: string; fullNameKz?: string };
  }[];
};
export function TrainingGroup({
  id,
  t,
  canEdit,
}: {
  id: string;
  t: Translate;
  canEdit: boolean;
}) {
  const [data, setData] = useState<GroupData | null>(null),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicy>({
      mode: "DAYS",
      days: 90,
      timezone: "Asia/Qyzylorda",
    }),
    [changePolicy, setChangePolicy] = useState(false);
  const locale = t("ru", "kz");
  useEffect(() => {
    let alive = true;
    void api<GroupData>(`/lms/groups/${id}?page=${page}`)
      .then((v) => {
        if (alive) {
          setData(v);
          setName(v.group.name);
          setAccessPolicy(
            v.group.accessPolicy || {
              mode: v.group.dueAt ? "FIXED" : "UNLIMITED",
              startsAt: v.group.startsAt,
              endsAt: v.group.dueAt,
              timezone: "Asia/Qyzylorda",
            },
          );
          setChangePolicy(false);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(lmsError(e, t));
      });
    return () => {
      alive = false;
    };
  }, [id, page, refresh, locale]);
  async function act(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body: json(body) });
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(lmsError(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={data?.group.name || t("Учебная группа", "Оқу тобы")} />
      {error && <Notice>{error}</Notice>}
      {data && (
        <section className="panel lms-panel">
          <div className="lms-toolbar">
            <Link
              className="primary lms-primary"
              href={`/lms/results?groupId=${id}`}
            >
              {t(
                "Результаты и готовые документы",
                "Нәтижелер мен дайын құжаттар",
              )}{" "}
              · {data.total}
            </Link>
            {canEdit && (
              <Link href={`/lms/assign?groupId=${id}`}>
                {t("Добавить участников", "Қатысушыларды қосу")}
              </Link>
            )}
          </div>
          {canEdit && (
            <details>
              <summary>
                {t("Название и общий срок", "Атауы және ортақ мерзімі")}
              </summary>
              <label>
                {t("Название", "Атауы")}
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <p>
                {t("Текущий срок", "Ағымдағы мерзім")}:{" "}
                {data.group.dueAt
                  ? new Date(data.group.dueAt).toLocaleString(
                      t("ru-RU", "kk-KZ"),
                      {
                        timeZone:
                          data.group.accessPolicy?.timezone || "Asia/Qyzylorda",
                      },
                    )
                  : t("Без ограничения", "Шектеусіз")}
              </p>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={changePolicy}
                  onChange={(event) => setChangePolicy(event.target.checked)}
                />
                {t(
                  "Изменить общий период доступа",
                  "Ортақ қолжетімділік мерзімін өзгерту",
                )}
              </label>
              {changePolicy && (
                <>
                  <AccessPolicyEditor
                    value={accessPolicy}
                    onChange={setAccessPolicy}
                    t={t}
                    disabled={busy}
                  />
                  <p className="lms-save-state">
                    {t(
                      "Индивидуальные исключения сохранятся. Новое значение применяется к действующим участникам без исключения.",
                      "Жеке ерекшеліктер сақталады. Жаңа мән ерекшелігі жоқ белсенді қатысушыларға қолданылады.",
                    )}
                  </p>
                </>
              )}
              <button
                disabled={busy || !name.trim()}
                onClick={() =>
                  void act(
                    `/lms/groups/${id}`,
                    {
                      name,
                      ...(changePolicy ? { accessPolicy } : {}),
                    },
                    "PUT",
                  )
                }
              >
                {t("Сохранить", "Сақтау")}
              </button>
            </details>
          )}
          {data.group.sourceOrderId && (
            <p>
              <Link href={`/workbench?orderId=${data.group.sourceOrderId}`}>
                {t("Исходный заказ", "Бастапқы тапсырыс")}
              </Link>
            </p>
          )}
          {data.group.sourceRequestId && (
            <p>
              <Link href={`/requests/${data.group.sourceRequestId}/edit`}>
                {t("Исходная заявка", "Бастапқы өтінім")}
              </Link>
            </p>
          )}
          {canEdit && <button onClick={() => setAccessOpen((open) => !open)}>{accessOpen ? t("Показать состав и прогресс", "Құрам мен барысты көрсету") : t("Открыть доступ слушателям", "Тыңдаушыларға қолжетімділік ашу")}</button>}
          {!accessOpen && <div className="lms-table-scroll">
            <table className="lms-table">
              <thead>
                <tr>
                  <th>{t("Участник", "Қатысушы")}</th>
                  <th>{t("Прогресс", "Барысы")}</th>
                  <th>{t("Результат", "Нәтиже")}</th>
                  <th>{t("Доступ до", "Қолжетімділік мерзімі")}</th>
                  {canEdit && <th>{t("Состав", "Құрамы")}</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {t(
                        row.recipient?.data.fullNameRu || "",
                        row.recipient?.data.fullNameKz ||
                          row.recipient?.data.fullNameRu ||
                          "",
                      )}
                    </td>
                    <td>{row.progressPercent || 0}%</td>
                    <td>
                      {row.result?.verdict === "PASSED"
                        ? t("Сдано", "Өтті")
                        : row.result?.verdict === "FAILED"
                          ? t("Не сдано", "Өтпеді")
                          : t("Не завершено", "Аяқталмаған")}
                    </td>
                    <td>
                      {row.dueAt?.slice(0, 10) ||
                        t("Без ограничения", "Шектеусіз")}
                    </td>
                    {canEdit && (
                      <td>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(
                              `/lms/groups/${id}/members/${row.id}/exclude`,
                              {},
                            )
                          }
                        >
                          {t("Исключить из состава", "Құрамнан шығару")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          }
          {canEdit && accessOpen && <LearnerAccess recipientIds={data.items.map((row) => row.recipientId)} customerId={data.group.customerId || undefined} t={t} />}
          <PageControls
            page={page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
            t={t}
          />
          {!!data.excluded.length && (
            <details>
              <summary>
                {t("История исключений", "Шығару тарихы")} ·{" "}
                {data.excluded.length}
              </summary>
              {data.excluded.map((row) => (
                <p key={row.id}>
                  {t(
                    row.recipient?.fullNameRu || "",
                    row.recipient?.fullNameKz ||
                      row.recipient?.fullNameRu ||
                      "",
                  )}{" "}
                  · {row.excludedAt.slice(0, 10)}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
      {data && <TeachingGroupEvents groupId={id} t={t} />}
    </>
  );
}
