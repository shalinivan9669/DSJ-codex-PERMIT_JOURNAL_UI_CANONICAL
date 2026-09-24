"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
type Evidence = {
  id: string;
  recipientId: string;
  program: string;
  issuer: string;
  originalNumber: string;
  documentDate: string;
  validUntil?: string;
  status: string;
  state: string;
  attachments: { id: string; fileName: string }[];
};
type Data = {
  recipients: { id: string; fullNameRu: string }[];
  programs: {
    id: string;
    serviceKey: string;
    title: string;
    version: number;
  }[];
  permissions: string[];
  items: Evidence[];
};
type Matrix = {
  columns: { id: string; title: string; version: number }[];
  rows: {
    recipientId: string;
    fullNameRu: string;
    cells: {
      ruleId: string;
      state: string;
      source: string | null;
      originalNumber?: string;
      validUntil?: string;
      nextAction: string;
    }[];
  }[];
  limitation: string;
};
const states: Record<string, string> = {
  UNKNOWN: "Сведений нет",
  UNVERIFIED: "Ожидает проверки центра",
  VERIFIED: "Источник проверен",
  VERIFIED_NO_EXPIRY: "Источник проверен, срок неизвестен",
  APPROACHING: "Приближается дата проверки",
  REVIEW_DATE_PASSED: "Требуется уточнение срока",
  SUPERSEDED: "Документ заменён",
};
export function PortalEvidence({
  customers,
}: {
  customers: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [data, setData] = useState<Data | null>(null);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachmentId, setAttachmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileSource, setFileSource] = useState("");
  useEffect(() => {
    if (customers.some((customer) => customer.id === customerId)) return;
    setCustomerId(customers[0]?.id || "");
    setData(null);
    setMatrix(null);
    setForm({});
    setAttachmentId("");
    setFile(null);
    setFileSource("");
    setSuccess("");
  }, [customers, customerId]);
  useEffect(() => {
    if (!open || !customerId) return;
    let active = true;
    setBusy(true);
    setError("");
    Promise.all([
      api<Data>(
        `/portal/evidence?customerId=${encodeURIComponent(customerId)}`,
      ),
      api<Matrix>(
        `/portal/matrix?customerId=${encodeURIComponent(customerId)}`,
      ),
    ])
      .then(([d, m]) => {
        if (active) {
          setData(d);
          setMatrix(m);
        }
      })
      .catch((c) => {
        if (active) setError(errorText(c));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open, customerId, refresh]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setSuccess(message);
      setRefresh((v) => v + 1);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        value={form[key] || ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  async function upload() {
    if (!file) return;
    if (file.size > 1048576)
      throw new Error("Размер вложения — не более 1 МБ.");
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
      reader.readAsDataURL(file);
    });
    await api(`/portal/evidence/${attachmentId}/attachments`, {
      method: "POST",
      body: json({ source: fileSource, fileName: file.name, contentBase64 }),
    });
    setAttachmentId("");
    setFile(null);
    setFileSource("");
  }
  if (!customers.length) return null;
  return (
    <section className="panel workbench-detail">
      <div className="toolbar">
        <div>
          <h2>Сведения об обучении у других поставщиков</h2>
          <p>
            Разрешённые люди и программы вашей организации. Учебный центр
            проверяет источники отдельно.
          </p>
        </div>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Свернуть сведения" : "Открыть сведения и матрицу"}
        </button>
      </div>
      {open && (
        <>
          {error && <Notice>{error}</Notice>}
          {success && <Notice kind="success">{success}</Notice>}
          <label>
            Организация для сверки
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setForm({});
                setData(null);
                setMatrix(null);
                setAttachmentId("");
                setFile(null);
                setFileSource("");
                setSuccess("");
              }}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {matrix && (
            <>
              <h3>Люди и согласованные программы</h3>
              <p>{matrix.limitation}</p>
              {matrix.columns.length ? (
                <div className="table-scroll">
                  <table className="source-data-table">
                    <thead>
                      <tr>
                        <th>Человек</th>
                        {matrix.columns.map((c) => (
                          <th key={c.id}>
                            {c.title}
                            <small>Версия {c.version}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.rows.map((row) => (
                        <tr key={row.recipientId}>
                          <td>{row.fullNameRu}</td>
                          {matrix.columns.map((column) => {
                            const cell = row.cells.find(
                              (c) => c.ruleId === column.id,
                            );
                            return (
                              <td key={column.id}>
                                {cell ? (
                                  <>
                                    <strong>
                                      {states[cell.state] || cell.state}
                                    </strong>
                                    <small>
                                      {cell.source === "EXTERNAL"
                                        ? "Другой поставщик"
                                        : cell.source === "OWN"
                                          ? "Учебный центр"
                                          : "Источник не известен"}
                                    </small>
                                    {cell.originalNumber && (
                                      <small>№ {cell.originalNumber}</small>
                                    )}
                                    {cell.validUntil && (
                                      <small>
                                        Срок документа: {cell.validUntil}
                                      </small>
                                    )}
                                    <p>{cell.nextAction}</p>
                                  </>
                                ) : (
                                  "Сведений нет"
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  Учебный центр ещё не связал согласованные программы с заказами
                  вашей организации.
                </p>
              )}
            </>
          )}
          {data && (
            <>
              <h3>Переданные внешние документы</h3>
              {data.items.map((item) => (
                <article className="milestone" key={item.id}>
                  <strong>
                    {data.recipients.find((p) => p.id === item.recipientId)
                      ?.fullNameRu || "Разрешённый получатель"}{" "}
                    · {item.program}
                  </strong>
                  <p>
                    {item.issuer} · № {item.originalNumber} ·{" "}
                    {item.documentDate}
                  </p>
                  <small>
                    {states[item.state] || states[item.status] || item.status}
                  </small>
                  {data.permissions.includes("DOWNLOAD") &&
                    item.attachments.map((attachment) => (
                      <p key={attachment.id}>
                        <a
                          href={`/api/portal/evidence-attachments/${attachment.id}`}
                          download
                        >
                          {attachment.fileName}
                        </a>
                      </p>
                    ))}
                  {data.permissions.includes("PROPOSE") && (
                    <button
                      disabled={busy}
                      onClick={() => setAttachmentId(item.id)}
                    >
                      Приложить копию источника
                    </button>
                  )}
                </article>
              ))}
              {!data.items.length && <p>Внешние документы ещё не переданы.</p>}
              {data.permissions.includes("PROPOSE") && (
                <details className="outcome-entry">
                  <summary>Передать сведения для проверки центром</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await api("/portal/evidence", {
                          method: "POST",
                          body: json({
                            customerId,
                            recipientId: form.recipientId,
                            program: form.program,
                            issuer: form.issuer,
                            originalNumber: form.originalNumber,
                            documentDate: form.documentDate,
                            validUntil: form.validUntil || null,
                            source: form.source,
                          }),
                        });
                        setForm({});
                      }, "Сведения переданы со статусом «Ожидает проверки центра».");
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Человек
                        <select
                          required
                          value={form.recipientId || ""}
                          onChange={(e) =>
                            setForm({ ...form, recipientId: e.target.value })
                          }
                        >
                          <option value="">
                            Выберите разрешённого человека
                          </option>
                          {data.recipients.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.fullNameRu}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Программа
                        <select
                          required
                          value={form.program || ""}
                          onChange={(e) =>
                            setForm({ ...form, program: e.target.value })
                          }
                        >
                          <option value="">
                            Выберите согласованную программу
                          </option>
                          {data.programs.map((p) => (
                            <option key={p.id} value={p.serviceKey}>
                              {p.title} · версия {p.version}
                            </option>
                          ))}
                        </select>
                      </label>
                      {field("issuer", "Кем выдан документ")}
                      {field("originalNumber", "Номер внешнего документа")}
                      {field("documentDate", "Дата внешнего документа", "date")}
                      {field(
                        "validUntil",
                        "Срок документа (если указан)",
                        "date",
                        false,
                      )}
                      {field("source", "Откуда получены сведения")}
                    </div>
                    <button
                      className="primary"
                      disabled={
                        busy || !data.recipients.length || !data.programs.length
                      }
                    >
                      Передать внешний документ на проверку
                    </button>
                  </form>
                </details>
              )}
              {attachmentId && (
                <form
                  className="contact-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      upload,
                      "Копия источника сохранена. Загрузка не означает положительный результат проверки.",
                    );
                  }}
                >
                  <h3>Копия выбранного внешнего документа</h3>
                  <label>
                    Источник копии
                    <input
                      required
                      value={fileSource}
                      onChange={(e) => setFileSource(e.target.value)}
                    />
                  </label>
                  <label>
                    PDF, PNG или JPEG до 1 МБ
                    <input
                      type="file"
                      required
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <div className="toolbar-actions">
                    <button type="button" onClick={() => setAttachmentId("")}>
                      Отмена
                    </button>
                    <button disabled={busy || !file || !fileSource.trim()}>
                      Сохранить копию источника
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
