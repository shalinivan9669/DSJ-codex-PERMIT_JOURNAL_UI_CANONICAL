"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ResultEnrollment } from "@/lib/results-api";
import { useLanguage } from "./common";
type OrderLearning = {
  items: ResultEnrollment[]; total: number; requests: { requestId: string; title: string }[];
  application?: { id: string; kind: string; courseVersionId: string; customerId: string | null; recipientId: string | null; enrollmentId: string | null; state: string } | null;
};
export function OrderTraining({ orderId, scope = "orders" }: { orderId: string; scope?: string }) {
  const { t } = useLanguage(scope);
  const [data, setData] = useState<OrderLearning | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<OrderLearning>(`/lms/orders/${orderId}`)
      .then((v) => {
        if (alive) {
          setData(v);
          setError(false);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [orderId, refresh]);
  return (
    <section className="outcome-entry">
      <h3>{t("Обучение и документы", "Оқу және құжаттар")} {data ? `· ${data.total}` : ""}</h3>
      {error && (
        <p role="alert">
          {t("Не удалось получить обучение.", "Оқу деректерін алу мүмкін болмады.")} <button onClick={() => setRefresh((value) => value + 1)}>{t("Повторить", "Қайталау")}</button>
        </p>
      )}
      {data && (
        <>
          {data.application && <div className="lms-toolbar">
            <Link href={`/lms/applications?id=${data.application.id}`}>{t("Исходная заявка на обучение", "Бастапқы оқу өтінімі")}</Link>
            {data.application.kind === "B2B" && data.application.state === "ACCEPTED" && <Link className="button primary" href={`/lms/import?orderId=${encodeURIComponent(orderId)}&applicationId=${data.application.id}`}>{t("Заполнить состав и назначить", "Құрамды толтыру және тағайындау")}</Link>}
          </div>}
          {data.requests.map((r) => (
            <p key={r.requestId}>
              <Link
                href={`/lms/assign?orderId=${encodeURIComponent(orderId)}&requestId=${encodeURIComponent(r.requestId)}`}
              >
                {t("Назначить обучение участникам заявки", "Өтінім қатысушыларына оқуды тағайындау")} · {r.title}
              </Link>
            </p>
          ))}
          {!!data.total && (
            <p>
              <Link
                href={`/lms/results?sourceOrderId=${encodeURIComponent(orderId)}`}
              >
                {t("Все результаты и готовые документы", "Барлық нәтижелер мен дайын құжаттар")}
              </Link>
            </p>
          )}
          {data.items.map((row) => (
            <p key={row.id}>
              {t(row.recipient?.data.fullNameRu || "", row.recipient?.data.fullNameKz || row.recipient?.data.fullNameRu || "")} · {row.progressPercent || 0}% ·{" "}
              {row.result?.verdict === "PASSED"
                ? t("Сдано", "Өтті")
                : row.result?.verdict === "FAILED"
                  ? t("Не сдано", "Өтпеді")
                  : t("Не завершено", "Аяқталмаған")}
              {row.groupId && (
                <>
                  {" "}
                  · <Link href={`/lms/groups/${row.groupId}`}>{t("Группа", "Топ")}</Link>
                </>
              )}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
