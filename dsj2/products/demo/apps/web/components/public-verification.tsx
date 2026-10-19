"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { LanguageSwitch, useLanguage } from "./lms/common";
import "./lms/lms.css";
type Verification = {
  issuer: { nameRu: string; nameKz: string };
  document: {
    type: string;
    number: string;
    date: string;
    validUntil?: string | null;
  };
  status: string;
  replacement: { type: string; number: string; date: string } | null;
  limitation: string;
  learningDocument?: {
    legalForm: string;
    assessmentKind: string;
    sourceIssuer: string;
    resultRevision: number;
    originalReference: string | null;
    sourceVerification: string;
    course?: { titleRu: string; titleKz: string; hours: number } | null;
  };
};
export function PublicVerification({ token }: { token?: string }) {
  const { language, setLanguage, t } = useLanguage("public-verification");
  const [record, setRecord] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [number, setNumber] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    setRecord(null);
    setError("");
    if (!token) return;
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
    <main
      className="workspace public-verification lms-workspace"
      lang={language === "kz" ? "kk" : "ru"}
    >
      <section className="panel workbench-detail">
        <LanguageSwitch language={language} onChange={setLanguage} />
        <h1>
          {t(
            "Проверка записи эмитента",
            "Құжат берген ұйымның жазбасын тексеру",
          )}
        </h1>
        {!token && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (searching) return;
              setSearching(true);
              setError("");
              setRecord(null);
              try {
                setRecord(
                  await api<Verification>("/verification/search", {
                    method: "POST",
                    body: json({
                      number: number.trim(),
                      issuerName: issuerName.trim(),
                    }),
                  }),
                );
              } catch {
                setError(
                  t(
                    "Запись недоступна. Проверьте номер и точное название эмитента или используйте QR документа.",
                    "Жазба қолжетімсіз. Нөмірді және құжат берген ұйымның нақты атауын тексеріңіз немесе құжаттың QR кодын пайдаланыңыз.",
                  ),
                );
              } finally {
                setSearching(false);
              }
            }}
          >
            <label>
              {t("Номер документа", "Құжат нөмірі")}
              <input
                required
                maxLength={80}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t(
                "Точное название эмитента",
                "Құжат берген ұйымның нақты атауы",
              )}
              <input
                required
                minLength={2}
                maxLength={300}
                value={issuerName}
                onChange={(event) => setIssuerName(event.target.value)}
                autoComplete="organization"
              />
            </label>
            <button
              disabled={
                searching || !number.trim() || issuerName.trim().length < 2
              }
            >
              {searching
                ? t("Проверяем…", "Тексерілуде…")
                : t("Проверить документ", "Құжатты тексеру")}
            </button>
          </form>
        )}
        {error && (
          <Notice>
            {t(
              error,
              token
                ? "Жазба қолжетімсіз. Сілтемені тексеріңіз немесе құжат берген ұйымға хабарласыңыз."
                : "Жазба қолжетімсіз. Нөмірді және құжат берген ұйымның нақты атауын тексеріңіз немесе құжаттың QR кодын пайдаланыңыз.",
            )}
          </Notice>
        )}
        {record ? (
          <>
            <h2>{record.issuer.nameRu}</h2>
            <p>{record.issuer.nameKz}</p>
            <dl>
              <dt>{t("Номер документа", "Құжат нөмірі")}</dt>
              <dd>{record.document.number}</dd>
              <dt>{t("Дата", "Күні")}</dt>
              <dd>{record.document.date}</dd>
              {record.document.validUntil && (
                <>
                  <dt>{t("Действует до", "Қолданылу мерзімі")}</dt>
                  <dd>{record.document.validUntil}</dd>
                </>
              )}
              {record.learningDocument && (
                <>
                  {record.learningDocument.course && (
                    <>
                      <dt>{t("Программа", "Бағдарлама")}</dt>
                      <dd>
                        {language === "kz"
                          ? record.learningDocument.course.titleKz ||
                            record.learningDocument.course.titleRu
                          : record.learningDocument.course.titleRu}
                      </dd>
                      <dt>{t("Объём обучения", "Оқу көлемі")}</dt>
                      <dd>
                        {record.learningDocument.course.hours}{" "}
                        {t("часов", "сағат")}
                      </dd>
                    </>
                  )}
                  <dt>{t("Форма документа", "Құжат нысаны")}</dt>
                  <dd>
                    {{
                      "lms-protocol": t("Протокол", "Хаттама"),
                      "lms-certificate": t("Сертификат", "Сертификат"),
                      "lms-credential": t("Удостоверение", "Куәлік"),
                    }[record.document.type] || t("Документ", "Құжат")}
                  </dd>
                  <dt>{t("Вид документа", "Құжат түрі")}</dt>
                  <dd>
                    {(
                      {
                        PAPER_ORIGINAL: t(
                          "Бумажный оригинал",
                          "Қағаз түпнұсқа",
                        ),
                        ELECTRONIC_ORIGINAL: t(
                          "Электронный оригинал",
                          "Электрондық түпнұсқа",
                        ),
                        COPY_OF_ORIGINAL: t(
                          "Копия оригинала",
                          "Түпнұсқаның көшірмесі",
                        ),
                        INFORMATION_CARD: t(
                          "Информационная карточка",
                          "Ақпараттық карточка",
                        ),
                      } as Record<string, string>
                    )[record.learningDocument.legalForm] ||
                      t("Требует уточнения", "Нақтылау қажет")}
                  </dd>
                  <dt>{t("Источник результата", "Нәтиже көзі")}</dt>
                  <dd>
                    {record.learningDocument.assessmentKind ===
                    "EXTERNAL_AUTHORIZED"
                      ? t(
                          "Проверенное внешнее основание",
                          "Тексерілген сыртқы негіз",
                        )
                      : t(
                          "Экзамен учебного центра",
                          "Оқу орталығының емтиханы",
                        )}{" "}
                    · {record.learningDocument.sourceIssuer}
                  </dd>
                  {record.learningDocument.originalReference && (
                    <>
                      <dt>{t("Оригинал", "Түпнұсқа")}</dt>
                      <dd>{record.learningDocument.originalReference}</dd>
                    </>
                  )}
                </>
              )}
              <dt>{t("Состояние записи", "Жазба күйі")}</dt>
              <dd>
                {(
                  {
                    ACTIVE_RECORD: t(
                      "Действующая запись",
                      "Қолданыстағы жазба",
                    ),
                    REPLACED: t(
                      "Заменена исправленным документом",
                      "Түзетілген құжатпен ауыстырылған",
                    ),
                    REVOKED: t("Отозвана", "Күші жойылған"),
                    EXPIRED: t(
                      "Срок документа истёк",
                      "Құжаттың қолданылу мерзімі аяқталған",
                    ),
                  } as Record<string, string>
                )[record.status] || record.status}
              </dd>
            </dl>
            {record.replacement && (
              <p>
                {t("Заменяющий документ", "Орнына берілген құжат")}: №{" "}
                {record.replacement.number}, {record.replacement.date}.
              </p>
            )}
            <p>
              {t(
                record.limitation,
                "Осы орталықтың тізіліміндегі жазба тексеріледі. Бет құжаттың кез келген көшірмесінің өзгермегенін растамайды және қолтаңбаны тексеруді алмастырмайды.",
              )}
            </p>
            <p className="fine-print">
              {t(
                "Проверка записи не является электронной подписью и не подтверждает неизменность стороннего файла.",
                "Жазбаны тексеру электрондық қолтаңба болып саналмайды және бөгде файлдың өзгермегенін растамайды.",
              )}
            </p>
            {token && (
              <details>
                <summary>
                  {t(
                    "Сообщить об ошибке в документе",
                    "Құжаттағы қате туралы хабарлау",
                  )}
                </summary>
                {sent ? (
                  <Notice kind="success">
                    {t(
                      "Обращение принято для проверки эмитентом.",
                      "Өтініш құжат берген ұйымның тексеруіне қабылданды.",
                    )}
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
                      {t("Что требуется проверить", "Нені тексеру қажет")}
                      <textarea
                        required
                        maxLength={2000}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                    </label>
                    <label>
                      {t(
                        "Как связаться для уточнения (необязательно)",
                        "Нақтылау үшін байланыс (міндетті емес)",
                      )}
                      <input
                        value={contact}
                        maxLength={500}
                        onChange={(e) => setContact(e.target.value)}
                      />
                    </label>
                    <button disabled={busy || !message.trim()}>
                      {t(
                        "Передать обращение эмитенту",
                        "Өтінішті құжат берген ұйымға жіберу",
                      )}
                    </button>
                  </form>
                )}
              </details>
            )}
          </>
        ) : (
          token &&
          !error && (
            <p role="status">{t("Проверяем запись…", "Жазба тексерілуде…")}</p>
          )
        )}
      </section>
    </main>
  );
}
