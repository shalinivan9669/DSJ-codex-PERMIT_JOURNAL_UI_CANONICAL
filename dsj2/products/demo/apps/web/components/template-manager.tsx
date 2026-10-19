"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import {
  useCabinetError,
  useCabinetLanguage,
  useCabinetText,
} from "./cabinet-language";
import { templateLabels } from "@/lib/types";

type FormVersion = {
  id: string;
  templateId: string;
  version: string;
  approved: boolean;
  checksum: string;
  contract: {
    title?: string;
    validation?: { fields?: string[] };
    preview?: { sampleOnly?: boolean };
  };
};
const labels: Record<string, string> = {
  "lms-protocol": "Протокол обучения",
  "lms-certificate": "Сертификат учебного центра",
  "lms-credential": "Удостоверение учебного центра",
};
export function TemplateManager({
  onChanged,
}: {
  onChanged: () => void | Promise<void>;
}) {
  const t = useCabinetLanguage(),
    common = useCabinetText();
  const translations: Record<string, string> = {
    "Добавить форму или новую версию": "Нысанды немесе жаңа нұсқаны қосу",
    "Добавить стандартные формы": "Стандартты нысандарды қосу",
    "Доступные формы добавлены. Проверьте образцы и подтвердите применимость.":
      "Қолжетімді нысандар қосылды. Үлгілерді тексеріп, қолданылуын растаңыз.",
    "Новая версия проверена и сохранена. Откройте образцы и подтвердите применимость формы.":
      "Жаңа нұсқа тексеріліп сақталды. Үлгілерді ашып, нысанның қолданылуын растаңыз.",
    "Исходная форма": "Бастапқы нысан",
    "Выберите форму": "Нысанды таңдаңыз",
    "Скачать исходный DOCX": "Бастапқы DOCX жүктеу",
    "Новая версия": "Жаңа нұсқа",
    "Форма DOCX": "DOCX нысаны",
    "Сохраните поля и структуру исходной формы. При загрузке проверяются файл и пробное заполнение; прежние версии сохраняются.":
      "Бастапқы нысанның өрістері мен құрылымын сақтаңыз. Жүктеу кезінде файл мен сынақ толтыру тексеріледі; бұрынғы нұсқалар сақталады.",
    "Проверяем и готовим образцы…": "Тексеріп, үлгілерді дайындаудамыз…",
    "Проверить и сохранить версию": "Нұсқаны тексеру және сақтау",
    "Образцы и исходные файлы": "Үлгілер мен бастапқы файлдар",
    "Применимость подтверждена": "Қолданылуы расталды",
    "Ожидает проверки ответственным": "Жауапты адамның тексеруін күтуде",
    "Исходный DOCX": "Бастапқы DOCX",
    "Образец DOCX": "DOCX үлгісі",
    "Образец PDF": "PDF үлгісі",
    "Контроль версии": "Нұсқаны бақылау",
    "Протокол обучения": "Оқу хаттамасы",
    "Сертификат учебного центра": "Оқу орталығының сертификаты",
    "Удостоверение учебного центра": "Оқу орталығының куәлігі",
  };
  const tr = (ru: string) =>
    translations[ru] ? t(ru, translations[ru]) : common(ru);
  const [forms, setForms] = useState<FormVersion[]>([]),
    [selected, setSelected] = useState("");
  const [version, setVersion] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [error, setError] = useCabinetError();
  const load = async () => {
    const result = await api<{ items: FormVersion[] }>("/settings/templates");
    setForms(result.items);
  };
  useEffect(() => {
    void load().catch(setError);
  }, []);
  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await load();
      await onChanged();
      setMessage(tr(success));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !selected) return;
    const body = new FormData();
    body.set("sourceVersionId", selected);
    body.set("version", version);
    body.set("file", file);
    void run(
      () => api("/settings/templates/upload", { method: "POST", body }),
      "Новая версия проверена и сохранена. Откройте образцы и подтвердите применимость формы.",
    );
  }
  const current = forms.find((form) => form.id === selected);
  return (
    <section className="panel" aria-busy={busy}>
      {error && <Notice>{error}</Notice>}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>{tr("Добавить форму или новую версию")}</summary>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                api("/settings/templates/register-bundled", {
                  method: "POST",
                  body: json({}),
                }),
              "Доступные формы добавлены. Проверьте образцы и подтвердите применимость.",
            )
          }
        >
          {tr("Добавить стандартные формы")}
        </button>
        <form onSubmit={upload}>
          <label>
            {tr("Исходная форма")}
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{tr("Выберите форму")}</option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {tr(
                    labels[form.templateId] ||
                      templateLabels[form.templateId] ||
                      form.templateId,
                  )}{" "}
                  · {form.version}
                </option>
              ))}
            </select>
          </label>
          {current && (
            <p>
              <a href={`/api/settings/templates/${current.id}/source`} download>
                {tr("Скачать исходный DOCX")}
              </a>
            </p>
          )}
          <label>
            {tr("Новая версия")}
            <input
              required
              value={version}
              maxLength={50}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
              onChange={(e) => setVersion(e.target.value)}
              placeholder="4"
            />
          </label>
          <label>
            {tr("Форма DOCX")}
            <input
              required
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <p className="muted">
            {tr(
              "Сохраните поля и структуру исходной формы. При загрузке проверяются файл и пробное заполнение; прежние версии сохраняются.",
            )}
          </p>
          <button className="primary" disabled={busy || !file || !selected}>
            {busy
              ? tr("Проверяем и готовим образцы…")
              : tr("Проверить и сохранить версию")}
          </button>
        </form>
      </details>
      {!!forms.length && (
        <details>
          <summary>{tr("Образцы и исходные файлы")}</summary>
          <ul className="lms-list">
            {forms.map((form) => (
              <li key={form.id}>
                <div>
                  <strong>
                    {tr(
                      labels[form.templateId] ||
                        templateLabels[form.templateId] ||
                        form.templateId,
                    )}{" "}
                    · {form.version}
                  </strong>
                  <p>
                    {form.approved
                      ? tr("Применимость подтверждена")
                      : tr("Ожидает проверки ответственным")}
                  </p>
                  <div className="lms-actions">
                    <a
                      href={`/api/settings/templates/${form.id}/source`}
                      download
                    >
                      {tr("Исходный DOCX")}
                    </a>
                    <a
                      href={`/api/settings/templates/${form.id}/sample?format=DOCX`}
                      download
                    >
                      {tr("Образец DOCX")}
                    </a>
                    <a
                      href={`/api/settings/templates/${form.id}/sample?format=PDF`}
                      download
                    >
                      {tr("Образец PDF")}
                    </a>
                  </div>
                  <details>
                    <summary>{tr("Контроль версии")}</summary>
                    <code>{form.checksum}</code>
                    {form.contract.validation?.fields && (
                      <p>{form.contract.validation.fields.join(", ")}</p>
                    )}
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
