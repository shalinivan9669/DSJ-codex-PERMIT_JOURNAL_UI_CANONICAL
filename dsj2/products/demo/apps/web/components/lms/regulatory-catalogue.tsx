"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import type { RegulatoryProfile } from "@demo/contracts/src/lms";
import { api } from "@/lib/api";
import { LmsHeading, PageControls, Status, lmsError, type Translate } from "./common";
import { SourceLibrary } from "./source-library";

type Entry = {
  id: string; courseId: string; courseVersionId: string; version: number;
  titleRu: string; titleKz: string; status: string;
  profile: Pick<RegulatoryProfile, "title" | "sources" | "status" | "sanitary" | "synthetic">;
  currentReview: { status: string; updatedAt: string } | null;
};
function sourceLink(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function RegulatoryCatalogue({ t }: { t: Translate }) {
  const [data, setData] = useState<{ items: Entry[]; total: number }>({ items: [], total: 0 });
  const [search, setSearch] = useState("");
  const [sanitary, setSanitary] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    const timer = setTimeout(() => {
      void api<{ items: Entry[]; total: number }>(`/lms/regulatory?${new URLSearchParams({ search, sanitary, status, page: String(page), pageSize: "25" })}`)
        .then(value => { if (alive) { setData(value); setError(null); } })
        .catch(value => { if (alive) { setError(value); setData({ items: [], total: 0 }); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [page, search, sanitary, status, refresh]);
  return <>
    <LmsHeading title={t("Нормативная база", "Нормативтік база")} />
    <SourceLibrary t={t} />
    {!!error && <Notice>{lmsError(error, t)} <button onClick={() => setRefresh(value => value + 1)}>{t("Повторить", "Қайталау")}</button></Notice>}
    <section className="panel lms-panel" aria-busy={busy}>
      <div className="lms-toolbar">
        <label>{t("Найти НПА или программу", "НҚА немесе бағдарламаны табу")}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
        <label>{t("Направление", "Бағыт")}<select value={sanitary} onChange={event => { setSanitary(event.target.value); setPage(1); }}><option value="ALL">{t("Все направления", "Барлық бағыттар")}</option><option value="ONLY">{t("Санитарное обучение", "Санитариялық оқыту")}</option></select></label>
        <label>{t("Версии программ", "Бағдарлама нұсқалары")}<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="ALL">{t("Все версии", "Барлық нұсқалар")}</option><option value="PUBLISHED">{t("Опубликованные", "Жарияланған")}</option><option value="DRAFT">{t("Черновики", "Жобалар")}</option></select></label>
      </div>
      <p className="muted">{t("Источники сохранены в версиях программ. Для изменения опубликованного основания откройте программу и создайте новую версию.", "Дереккөздер бағдарлама нұсқаларында сақталған. Жарияланған негізді өзгерту үшін бағдарламаны ашып, жаңа нұсқа жасаңыз.")}</p>
      {busy && <p role="status">{t("Загрузка…", "Жүктелуде…")}</p>}
      {!busy && !error && !data.total && <p>{t("Источники не найдены. Добавьте источник в условиях своей программы или измените поиск.", "Дереккөздер табылмады. Бағдарлама шарттарына дереккөз қосыңыз немесе іздеуді өзгертіңіз.")}</p>}
      <ul className="lms-list">
        {data.items.map(entry => <li key={entry.courseVersionId} data-course-version={entry.courseVersionId} style={{ display: "block" }}>
          <div className="lms-actions"><strong>{t(entry.titleRu, entry.titleKz)}</strong><span>{t("Версия", "Нұсқа")} {entry.version}</span><Status value={entry.status} t={t} /><Link href={`/lms/courses/${entry.courseId}?section=overview`}>{t("Открыть программу", "Бағдарламаны ашу")}</Link></div>
          <p>{entry.profile.title} · <Status value={entry.profile.status} t={t} />{entry.profile.synthetic && <> · {t("Учебный пример", "Оқу үлгісі")}</>}{entry.profile.sanitary && <> · {t("Санитарное обучение", "Санитариялық оқыту")}</>}</p>
          {entry.currentReview && <p>{t("Текущая проверка программы", "Бағдарламаның ағымдағы тексеруі")}: <Status value={entry.currentReview.status} t={t} /></p>}
          {entry.profile.sources.map((source, index) => {
            const href = sourceLink(source.url);
            return <details key={index} className="lms-advanced">
              <summary>{source.title}{source.number ? ` · № ${source.number}` : ""}{source.revision ? ` · ${t("редакция", "редакция")} ${source.revision}` : ""}</summary>
              <dl className="lms-form-grid">
                {([
                  [t("Номер НПА", "НҚА нөмірі"), source.number], [t("Дата НПА", "НҚА күні"), source.date],
                  [t("Орган", "Орган"), source.authority], [t("Редакция", "Редакция"), source.revision],
                  [t("Статья", "Бап"), source.article], [t("Пункт", "Тармақ"), source.paragraph],
                  [t("Подпункт", "Тармақша"), source.subparagraph], [t("Дата актуальности", "Өзектілік күні"), source.effectiveOn],
                ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="muted">{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd></div>)}
                {source.status && <div><dt className="muted">{t("Состояние источника в этой версии", "Осы нұсқадағы дереккөздің күйі")}</dt><dd style={{ margin: 0 }}><Status value={source.status} t={t} /></dd></div>}
              </dl>
              {href && <a href={href} target="_blank" rel="noopener noreferrer">{t("Открыть источник", "Дереккөзді ашу")}</a>}
            </details>;
          })}
        </li>)}
      </ul>
      <PageControls page={page} total={data.total} pageSize={25} onPage={setPage} t={t} />
    </section>
  </>;
}
