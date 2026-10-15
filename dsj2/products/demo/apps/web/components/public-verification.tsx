"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { LanguageSwitch, useLanguage } from "./lms/common";
import "./lms/lms.css";
type Verification = {
  issuer: { nameRu: string; nameKz: string };
  document: { type: string; number: string; date: string };
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
  };
};
export function PublicVerification({ token }: { token: string }) {
  const { language, setLanguage, t } = useLanguage("public-verification");
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
        {error && (
          <Notice>
            {t(
              error,
              "Жазба қолжетімсіз. Сілтемені тексеріңіз немесе құжат берген ұйымға хабарласыңыз.",
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
              {record.learningDocument && (
                <>
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
          </>
        ) : (
          !error && <p role="status">Проверяем запись…</p>
        )}
      </section>
    </main>
  );
}
