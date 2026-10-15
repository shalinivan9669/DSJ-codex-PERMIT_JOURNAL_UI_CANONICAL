"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { Status, lmsError, type Translate } from "./common";

type Evidence = {
  id: string;
  issuer: string;
  sourceSystem: string;
  documentNumber: string;
  documentDate: string;
  examDate?: string | null;
  examAt?: string | null;
  supersededByEvidenceId?: string | null;
  status: string;
  reviewMethod?: string | null;
};
export function ExternalEvidence({
  enrollmentId,
  t,
  canReview,
  onChanged,
}: {
  enrollmentId: string;
  t: Translate;
  canReview: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Evidence[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [issuer, setIssuer] = useState(""),
    [source, setSource] = useState(""),
    [number, setNumber] = useState(""),
    [date, setDate] = useState(""),
    [examDate, setExamDate] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [review, setReview] = useState<Record<string, string>>({});
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [dateCorrections, setDateCorrections] = useState<
    Record<string, string>
  >({});
  const [dateReasons, setDateReasons] = useState<Record<string, string>>({});
  const [corrected, setCorrected] = useState(new Set<string>());
  useEffect(() => {
    let alive = true;
    void api<{ items: Evidence[] }>(
      `/lms/enrollments/${enrollmentId}/external-evidence`,
    )
      .then((value) => {
        if (alive) setItems(value.items);
      })
      .catch((caught) => {
        if (alive) setError(lmsError(caught, t));
      });
    return () => {
      alive = false;
    };
  }, [enrollmentId, refresh]);
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    body.set("issuer", issuer);
    body.set("sourceSystem", source);
    body.set("documentNumber", number);
    body.set("documentDate", date);
    if (examDate) body.set("examDate", examDate);
    try {
      await api(`/lms/enrollments/${enrollmentId}/external-evidence`, {
        method: "POST",
        body,
      });
      setRefresh((v) => v + 1);
      onChanged?.();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(id: string, status: "DOCUMENT_REVIEWED" | "REJECTED") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/lms/external-evidence/${id}/review`, {
        method: "POST",
        body: json({ status, reviewMethod: review[id], verdict: verdicts[id] }),
      });
      setRefresh((v) => v + 1);
      onChanged?.();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  async function correctDate(id: string, event: FormEvent) {
    event.preventDefault();
    if (busy || !dateCorrections[id] || !dateReasons[id]?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/lms/external-evidence/${id}/date`, {
        method: "POST",
        body: json({
          examDate: dateCorrections[id],
          reviewMethod: dateReasons[id],
        }),
      });
      setCorrected((current) => new Set([...current, id]));
      setRefresh((value) => value + 1);
      onChanged?.();
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>{t("Внешний результат", "Сыртқы нәтиже")}</h3>
      {error && <Notice>{error}</Notice>}
      {items.map((item) => (
        <article key={item.id}>
          <p>
            <strong>{item.issuer}</strong> · {item.documentNumber} ·{" "}
            {item.documentDate}
          </p>
          <p>
            <Status
              value={item.supersededByEvidenceId ? "SUPERSEDED" : item.status}
              t={t}
            />
          </p>
          <p>
            {t("Дата экзамена", "Емтихан күні")}:{" "}
            {item.examDate || t("неизвестна", "белгісіз")}
          </p>
          <a
            className="button"
            href={`/api/lms/external-evidence/${item.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Открыть основание", "Негізді ашу")}
          </a>
          {canReview &&
            item.status === "DOCUMENT_REVIEWED" &&
            !item.examAt &&
            !item.examDate &&
            !item.supersededByEvidenceId &&
            !corrected.has(item.id) && (
              <details>
                <summary>
                  {t("Уточнить дату экзамена", "Емтихан күнін нақтылау")}
                </summary>
                <form onSubmit={(event) => void correctDate(item.id, event)}>
                  <label>
                    {t("Дата экзамена", "Емтихан күні")}
                    <input
                      required
                      type="date"
                      value={dateCorrections[item.id] || ""}
                      onChange={(event) =>
                        setDateCorrections({
                          ...dateCorrections,
                          [item.id]: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Основание уточнения", "Нақтылау негізі")}
                    <textarea
                      required
                      minLength={3}
                      value={dateReasons[item.id] || ""}
                      onChange={(event) =>
                        setDateReasons({
                          ...dateReasons,
                          [item.id]: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {t("Сохранить уточнение", "Нақтылауды сақтау")}
                  </button>
                </form>
              </details>
            )}
          {canReview && item.status === "UNVERIFIED" && (
            <>
              <label>
                {t("Как проверено основание", "Негіз қалай тексерілді")}
                <textarea
                  value={review[item.id] || ""}
                  onChange={(e) =>
                    setReview({ ...review, [item.id]: e.target.value })
                  }
                />
              </label>
              <label>
                {t("Результат во внешнем документе", "Сыртқы құжаттағы нәтиже")}
                <select
                  value={verdicts[item.id] || ""}
                  onChange={(e) =>
                    setVerdicts({ ...verdicts, [item.id]: e.target.value })
                  }
                >
                  <option value="">
                    {t("Выберите результат", "Нәтижені таңдаңыз")}
                  </option>
                  <option value="PASSED">{t("Сдано", "Өтті")}</option>
                  <option value="FAILED">{t("Не сдано", "Өтпеді")}</option>
                </select>
              </label>
              <div className="lms-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (review[item.id]?.trim().length || 0) < 3 ||
                    !verdicts[item.id]
                  }
                  onClick={() => void inspect(item.id, "DOCUMENT_REVIEWED")}
                >
                  {t("Подтвердить проверку", "Тексеруді растау")}
                </button>
                <button
                  disabled={busy || (review[item.id]?.trim().length || 0) < 3}
                  onClick={() => void inspect(item.id, "REJECTED")}
                >
                  {t("Отклонить", "Қабылдамау")}
                </button>
              </div>
            </>
          )}
        </article>
      ))}
      <details>
        <summary>{t("Добавить основание", "Негіз қосу")}</summary>
        <form onSubmit={upload}>
          <div className="lms-fields">
            <label>
              {t("Кем выдан", "Кім берген")}
              <input
                required
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
              />
            </label>
            <label>
              {t("Источник", "Дереккөз")}
              <input
                required
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label>
              {t("Номер документа", "Құжат нөмірі")}
              <input
                required
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </label>
            <label>
              {t("Дата документа", "Құжат күні")}
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              {t("Дата экзамена, если известна", "Емтихан күні, белгілі болса")}
              <input
                type="date"
                value={examDate}
                onChange={(event) => setExamDate(event.target.value)}
              />
            </label>
          </div>
          <label>
            {t("Файл основания", "Негіз файлы")}
            <input
              type="file"
              required
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {t("Добавить на проверку", "Тексеруге қосу")}
          </button>
        </form>
      </details>
    </section>
  );
}
