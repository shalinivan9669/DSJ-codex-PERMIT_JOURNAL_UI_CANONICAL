"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
type Verification = {
  issuer: { nameRu: string; nameKz: string };
  document: { type: string; number: string; date: string };
  status: string;
  replacement: { type: string; number: string; date: string } | null;
  limitation: string;
};
export function PublicVerification({ token }: { token: string }) {
  const [record, setRecord] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    let active = true;
    api<Verification>(`/verification/${encodeURIComponent(token)}`)
      .then((r) => {
        if (active) setRecord(r);
      })
      .catch(() => {
        if (active)
          setError(
            "Запись недоступна. Проверьте ссылку или обратитесь к эмитенту документа.",
          );
      });
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="workspace public-verification">
      <section className="panel workbench-detail">
        <h1>Проверка записи эмитента</h1>
        {error && <Notice>{error}</Notice>}
        {record ? (
          <>
            <h2>{record.issuer.nameRu}</h2>
            <p>{record.issuer.nameKz}</p>
            <dl>
              <dt>Номер документа</dt>
              <dd>{record.document.number}</dd>
              <dt>Дата</dt>
              <dd>{record.document.date}</dd>
              <dt>Состояние записи</dt>
              <dd>
                {(
                  {
                    ACTIVE_RECORD: "Действующая запись",
                    REPLACED: "Заменена исправленным документом",
                    REVOKED: "Отозвана",
                  } as Record<string, string>
                )[record.status] || record.status}
              </dd>
            </dl>
            {record.replacement && (
              <p>
                Заменяющий документ: № {record.replacement.number},{" "}
                {record.replacement.date}.
              </p>
            )}
            <p>{record.limitation}</p>
            <p className="fine-print">
              Проверка записи не является электронной подписью и не подтверждает
              неизменность стороннего файла.
            </p>
            <details>
              <summary>Сообщить об ошибке в документе</summary>
              {sent ? (
                <Notice kind="success">
                  Обращение принято для проверки эмитентом.
                </Notice>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      await api(
                        `/verification/${encodeURIComponent(token)}/corrections`,
                        {
                          method: "POST",
                          body: json({
                            message,
                            ...(contact ? { replyContact: contact } : {}),
                          }),
                        },
                      );
                      setSent(true);
                    } catch (c) {
                      setError(errorText(c));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Что требуется проверить
                    <textarea
                      required
                      maxLength={2000}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  <label>
                    Как связаться для уточнения (необязательно)
                    <input
                      value={contact}
                      maxLength={500}
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </label>
                  <button disabled={busy || !message.trim()}>
                    Передать обращение эмитенту
                  </button>
                </form>
              )}
            </details>
          </>
        ) : (
          !error && <p role="status">Проверяем запись…</p>
        )}
      </section>
    </main>
  );
}
