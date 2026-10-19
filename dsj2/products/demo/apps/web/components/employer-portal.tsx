"use client";
import { useCabinetText, useCabinetError } from "./cabinet-language";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { PortalEvidence } from "./portal-evidence";
type Row = {
  id: string;
  fullNameRu: string;
  fullNameKz: string;
  positionRu: string;
  positionKz: string;
  employmentStatus?: "CURRENT" | "LEFT" | "TRAINED_ELSEWHERE" | "";
};
type PortalOrder = {
  id: string;
  title: string;
  customerId?: string;
  employerId?: string;
  status: string;
  dueDate?: string;
  permissions: string[];
  requests: {
    id: string;
    title: string;
    revision: number;
    fullRosterAllowed: boolean;
    rows: Row[];
  }[];
  artifacts: { id: string; fileName: string; format: string; label?: string }[];
  proposals: {
    id: string;
    kind: string;
    message: string;
    status: string;
    resolution?: string;
  }[];
};
export function EmployerPortal() {
  const tr = useCabinetText();
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [error, setError] = useCabinetError();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [active, setActive] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let alive = true;
    setBusy(true);
    api<{ orders: PortalOrder[] }>("/portal")
      .then((r) => {
        if (alive) {
          setOrders(r.orders);
          setError("");
        }
      })
      .catch((c) => {
        if (alive) setError(c);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  const order = orders.find((o) => o.requests.some((r) => r.id === active));
  const request = order?.requests.find((r) => r.id === active);
  const changes = rows.flatMap((row) => {
    const old = request?.rows.find((r) => r.id === row.id);
    if (!old) return [];
    const patch = Object.fromEntries(
      (
        [
          "fullNameRu",
          "fullNameKz",
          "positionRu",
          "positionKz",
          "employmentStatus",
        ] as const
      )
        .filter(
          (key) =>
            row[key] !== old[key] && (key !== "employmentStatus" || !!row[key]),
        )
        .map((key) => [key, row[key]]),
    );
    return Object.keys(patch).length ? [{ rowId: row.id, ...patch }] : [];
  });
  async function submit(kind: string) {
    if (!order || !request) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(`/portal/orders/${order.id}/proposals`, {
        method: "POST",
        body: json({
          requestId: request.id,
          requestRevision: request.revision,
          kind,
          message,
          changes: kind === "UPDATE_LIST" ? changes : [],
        }),
      });
      setSuccess(
        tr("Ответ передан учебному центру. Статус рассмотрения появится в истории обращения."),
      );
      setActive("");
      setRefresh((v) => v + 1);
    } catch (c) {
      setError(c);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{tr("Кабинет заказчика")}</h1>
          <p>
            {tr("Проверьте известный состав, предложите изменения и получите документы вашего заказа.")}</p>
        </div>
      </div>
      {error && (
        <Notice>
          {error}
          <button onClick={() => setRefresh((v) => v + 1)}>{tr("Повторить")}</button>
        </Notice>
      )}
      {success && <Notice kind="success">{success}</Notice>}
      {orders.map((o) => (
        <section className="panel workbench-detail" key={o.id}>
          <h2>{o.title}</h2>
          <p>{tr("Согласованный срок:")}{" "}{o.dueDate || tr("не задан")}.</p>
          <div className="toolbar-actions">
            {o.requests.map((r) => (
              <button
                key={r.id}
                disabled={busy}
                onClick={() => {
                  setActive(r.id);
                  setRows(structuredClone(r.rows));
                  setMessage("");
                }}
              >
                {r.title} {" "}{tr("· редакция")}{" "}{r.revision}
              </button>
            ))}
          </div>
          {o.permissions.includes("DOWNLOAD") && (
            <div className="portal-files">
              <h3>{tr("Выданные документы")}</h3>
              {o.artifacts.length ? (
                o.artifacts.map((a) => (
                  <a
                    className="button"
                    key={a.id}
                    href={`/api/portal/artifacts/${a.id}`}
                    download
                  >
                    {a.label || a.fileName}
                  </a>
                ))
              ) : (
                <p>{tr("Доступных выданных файлов пока нет.")}</p>
              )}
            </div>
          )}
          {o.proposals.length > 0 && (
            <details>
              <summary>{tr("Ответы и рассмотрение (")}{o.proposals.length})</summary>
              {o.proposals.map((p) => (
                <article className="milestone" key={p.id}>
                  <strong>
                    {(
                      {
                        CONFIRM_LIST: tr("Подтверждение списка"),
                        UPDATE_LIST: tr("Изменения списка"),
                        CLARIFICATION: tr("Уточнение"),
                        REPEAT_REQUEST: tr("Повторная заявка"),
                      } as Record<string, string>
                    )[p.kind] || p.kind}
                  </strong>
                  <p>{p.message}</p>
                  <small>
                    {(
                      {
                        PENDING: tr("Ожидает центра"),
                        ACCEPTED: tr("Принято"),
                        REJECTED: tr("Отклонено"),
                      } as Record<string, string>
                    )[p.status] || p.status}
                    {p.resolution ? `: ${p.resolution}` : ""}
                  </small>
                </article>
              ))}
            </details>
          )}
        </section>
      ))}
      {!orders.length && !busy && !error && (
        <section className="panel workbench-detail">
          <h2>{tr("Нет доступных заказов")}</h2>
          <p>
            {tr("Ваш представитель должен быть привязан к заказчику с действующим доступом. Обратитесь в учебный центр для проверки доступа.")}</p>
        </section>
      )}
      <PortalEvidence
        customers={[
          ...new Map(
            orders
              .filter((o) => o.employerId ?? o.customerId)
              .map((o) => [
                (o.employerId ?? o.customerId)!,
                { id: (o.employerId ?? o.customerId)!, label: o.title },
              ]),
          ).values(),
        ]}
      />
      {order && request && (
        <section className="panel workbench-detail">
          <h2>{request.title}</h2>
          <p>
            {tr("Редакция")}{" "}{request.revision}{tr(". Меняйте только отличия. Фактические результаты и выпуск документов подтверждает учебный центр.")}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{tr("ФИО RU")}</th>
                  <th>{tr("ФИО KZ")}</th>
                  <th>{tr("Должность RU")}</th>
                  <th>{tr("Должность KZ")}</th>
                  <th>{tr("Актуальность сведений")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id}>
                    {(
                      [
                        "fullNameRu",
                        "fullNameKz",
                        "positionRu",
                        "positionKz",
                      ] as const
                    ).map((key) => (
                      <td key={key}>
                        <input
                          aria-label={`${{ fullNameRu: tr("ФИО RU"), fullNameKz: tr("ФИО KZ"), positionRu: tr("Должность RU"), positionKz: tr("Должность KZ") }[key]}${tr(", получатель ")}${index + 1}`}
                          disabled={
                            !order.permissions.includes("PROPOSE") || busy
                          }
                          value={row[key]}
                          onChange={(e) =>
                            setRows(
                              rows.map((r) =>
                                r.id === row.id
                                  ? { ...r, [key]: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <select
                        aria-label={`${tr("Актуальность получателя ")}${index + 1}`}
                        disabled={
                          !order.permissions.includes("PROPOSE") || busy
                        }
                        value={row.employmentStatus || ""}
                        onChange={(e) =>
                          setRows(
                            rows.map((r) =>
                              r.id === row.id
                                ? {
                                    ...r,
                                    employmentStatus: e.target
                                      .value as Row["employmentStatus"],
                                  }
                                : r,
                            ),
                          )
                        }
                      >
                        <option value="">{tr("Изменения не заявлены")}</option>
                        <option value="CURRENT">{tr("Продолжает работать")}</option>
                        <option value="LEFT">{tr("Выбыл из организации")}</option>
                        <option value="TRAINED_ELSEWHERE">
                          {tr("Обучен у другого поставщика")}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            {tr("Сообщение учебному центру")}<textarea
              aria-label={tr("Сообщение учебному центру")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <p>
            {tr("Строк с изменениями:")}{" "}{changes.length}{tr(". Отправка предложения сохраняет историю; опубликованные документы остаются неизменными.")}</p>
          <div className="toolbar-actions">
            {order.permissions.includes("APPROVE_DATA") && (
              <button
                disabled={
                  busy || !request.fullRosterAllowed || changes.length > 0
                }
                onClick={() => void submit("CONFIRM_LIST")}
              >
                {tr("Подтвердить показанную редакцию списка")}</button>
            )}
            {order.permissions.includes("PROPOSE") && (
              <>
                <button
                  className="primary"
                  disabled={busy || !changes.length}
                  onClick={() => void submit("UPDATE_LIST")}
                >
                  {tr("Отправить изменения на проверку")}</button>
                <button
                  disabled={busy || !message.trim()}
                  onClick={() => void submit("CLARIFICATION")}
                >
                  {tr("Отправить уточнение")}</button>
                <button
                  disabled={busy || !message.trim()}
                  onClick={() => void submit("REPEAT_REQUEST")}
                >
                  {tr("Запросить повторную заявку")}</button>
              </>
            )}
          </div>
          {!request.fullRosterAllowed && (
            <p className="fine-print">
              {tr("Ваш доступ охватывает часть списка. Подтвердить весь состав может представитель с доступом ко всем получателям.")}</p>
          )}
        </section>
      )}
    </>
  );
}
