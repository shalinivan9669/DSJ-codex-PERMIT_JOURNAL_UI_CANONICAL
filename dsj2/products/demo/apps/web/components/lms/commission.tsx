"use client";
import { useCallback, useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import type { AppContext } from "@/lib/types";
import { SigningPanel } from "../signing-panel";
import { LmsHeading, Status, lmsError, useLanguage } from "./common";

type Row = { id: string; requestId: string; number: string | null; createdAt: string; status: string };
type Detail = { id: string; requestId: string; revision: string; canConfirm: boolean; confirmedAt: string | null;
  results: { id: string; fullName: string; title: string; verdict: string; score: number | null; maximum: number | null }[] };

export function CommissionWorkspace({ context }: { context: AppContext }) {
  const { t } = useLanguage(`${context.tenant.id}:${context.user.id}`);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Row[]; total: number }>({ items: [], total: 0 });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    setData(await api(`/lms/commission?page=${page}`));
  }, [page]);
  useEffect(() => { let active = true; void api<{ items: Row[]; total: number }>(`/lms/commission?page=${page}`)
    .then((value) => { if (active) setData(value); }).catch((caught) => { if (active) setError(lmsError(caught, t)); });
    return () => { active = false; }; }, [page]);
  useEffect(() => {
    let active = true;
    setDetail(null); setConfirmed(false); setError("");
    if (selected) void api<Detail>(`/lms/commission/${selected}`).then((value) => { if (active) setDetail(value); })
      .catch((caught) => { if (active) setError(lmsError(caught, t)); });
    return () => { active = false; };
  }, [selected]);
  async function confirm() {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      const updated = await api<Detail>(`/lms/commission/${detail.id}/confirm`, { method: "POST",
        body: json({ revision: detail.revision, confirmed: true }) });
      setDetail(updated); setConfirmed(false); await load();
    } catch (caught) { setError(lmsError(caught, t)); }
    finally { setBusy(false); }
  }
  return <>
    <LmsHeading title={t("Протоколы комиссии", "Комиссия хаттамалары")} />
    {error && <Notice>{error}</Notice>}
    {!selected ? <section className="panel">
      <div className="table-scroll"><table><thead><tr>
        <th>{t("Протокол / выпуск", "Хаттама / шығарылым")}</th><th>{t("Подготовлен", "Дайындалған")}</th>
        <th>{t("Состояние", "Күйі")}</th><th />
      </tr></thead><tbody>{data.items.map((row) => <tr key={row.id}>
        <td>{row.number ? `№ ${row.number}` : t("Документы обучения", "Оқу құжаттары")}</td>
        <td>{new Date(row.createdAt).toLocaleDateString("ru-RU")}</td><td><Status value={row.status} t={t} /></td>
        <td><button onClick={() => setSelected(row.id)}>{t("Открыть", "Ашу")}</button></td>
      </tr>)}</tbody></table></div>
      {!data.items.length && <p className="empty-state">{t("В назначенных вам программах пока нет подготовленных протоколов.", "Сізге тағайындалған бағдарламаларда дайын хаттамалар жоқ.")}</p>}
      {data.total > 30 && <div className="button-row"><button disabled={page === 1} onClick={() => setPage(page - 1)}>{t("Назад", "Артқа")}</button>
        <span>{page} / {Math.ceil(data.total / 30)}</span><button disabled={page * 30 >= data.total} onClick={() => setPage(page + 1)}>{t("Далее", "Келесі")}</button></div>}
    </section> : <>
      <button onClick={() => setSelected("")}>{t("К списку протоколов", "Хаттамалар тізіміне")}</button>
      {!detail && !error && <p role="status">{t("Открываем протокол…", "Хаттама ашылуда…")}</p>}
      {detail && <>
        <section className="panel"><h2>{t("Результаты для подтверждения", "Расталатын нәтижелер")}</h2>
          <div className="table-scroll"><table><thead><tr><th>{t("Слушатель", "Тыңдаушы")}</th><th>{t("Программа", "Бағдарлама")}</th><th>{t("Результат", "Нәтиже")}</th></tr></thead>
            <tbody>{detail.results.map((result) => <tr key={result.id}><td>{result.fullName}</td><td>{result.title}</td>
              <td><Status value={result.verdict} t={t} />{result.score !== null && ` · ${result.score}/${result.maximum}`}</td></tr>)}</tbody></table></div>
          {detail.confirmedAt ? <Notice kind="success">{t("Вы подтвердили этот протокол", "Сіз осы хаттаманы растадыңыз")} · {new Date(detail.confirmedAt).toLocaleString("ru-RU")}</Notice>
            : detail.canConfirm && <div className="approval-decision">
              <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
                {t("Результаты и окончательные PDF просмотрены, протокол подтверждаю", "Нәтижелер мен соңғы PDF қаралды, хаттаманы растаймын")}</label>
              <button className="primary" disabled={!confirmed || busy} onClick={() => void confirm()}>{busy ? t("Сохраняем…", "Сақталуда…") : t("Подтвердить протокол", "Хаттаманы растау")}</button>
            </div>}
          <p className="muted">{t("Подтверждение комиссии фиксируется в истории. ЭЦП ставится отдельно назначенным подписантом.", "Комиссия растауы тарихта сақталады. ЭЦҚ тағайындалған қол қоюшы арқылы бөлек қойылады.")}</p>
        </section>
        <SigningPanel requestId={detail.requestId} commissionIssuanceId={detail.id} role={context.user.role}
          onChanged={() => { void load().catch((caught) => setError(lmsError(caught, t))); }} />
      </>}
    </>}
  </>;
}
