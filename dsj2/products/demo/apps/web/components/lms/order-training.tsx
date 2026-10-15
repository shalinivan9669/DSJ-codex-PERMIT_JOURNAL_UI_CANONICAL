"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ResultEnrollment } from "@/lib/results-api";
export function OrderTraining({ orderId }: { orderId: string }) {
  const [data, setData] = useState<{
    items: ResultEnrollment[];
    total: number;
    requests: { requestId: string; title: string }[];
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<{
      items: ResultEnrollment[];
      total: number;
      requests: { requestId: string; title: string }[];
    }>(`/lms/orders/${orderId}`)
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
  }, [orderId]);
  return (
    <details className="outcome-entry">
      <summary>Обучение и документы {data ? `· ${data.total}` : ""}</summary>
      {error && (
        <p role="alert">
          Не удалось получить обучение. Откройте заказ повторно.
        </p>
      )}
      {data && (
        <>
          {data.requests.map((r) => (
            <p key={r.requestId}>
              <Link
                href={`/lms/assign?orderId=${encodeURIComponent(orderId)}&requestId=${encodeURIComponent(r.requestId)}`}
              >
                Назначить обучение участникам заявки · {r.title}
              </Link>
            </p>
          ))}
          {!!data.total && (
            <p>
              <Link
                href={`/lms/results?sourceOrderId=${encodeURIComponent(orderId)}`}
              >
                Все результаты и готовые документы
              </Link>
            </p>
          )}
          {data.items.map((row) => (
            <p key={row.id}>
              {row.recipient?.data.fullNameRu} · {row.progressPercent || 0}% ·{" "}
              {row.result?.verdict === "PASSED"
                ? "Сдано"
                : row.result?.verdict === "FAILED"
                  ? "Не сдано"
                  : "Не завершено"}
              {row.groupId && (
                <>
                  {" "}
                  · <Link href={`/lms/groups/${row.groupId}`}>Группа</Link>
                </>
              )}
            </p>
          ))}
        </>
      )}
    </details>
  );
}
