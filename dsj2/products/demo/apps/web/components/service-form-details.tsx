import type { Template } from "@/lib/types";
import { templateLabels } from "@/lib/types";

function fieldLabel(key: string): string | null {
  if (["EMPTY", "ONE", "TWO"].includes(key)) return null;
  const groups: [RegExp, string][] = [
    [/^FULL_NAME/, "ФИО получателя"],
    [/^POSITION/, "Должность получателя"],
    [/^PROFESSION/, "Профессия"],
    [/^WORKPLACE|^EMPLOYER_NAME/, "Работодатель и место работы"],
    [/^EMPLOYER_BIN$/, "БИН работодателя"],
    [/^DEPARTMENT/, "Подразделение"],
    [/^ISSUER_HEAD/, "Руководитель центра"],
    [/^ISSUER_BIN$/, "БИН центра"],
    [/^ISSUER|^EDU_ORG/, "Наименование центра"],
    [/^CITY/, "Город"],
    [/^ADDRESS/, "Адрес"],
    [/^CHAIR/, "Председатель комиссии"],
    [/^MEMBER_1/, "Первый член комиссии"],
    [/^MEMBER_2/, "Второй член комиссии"],
    [/^REGISTRATION_NUMBER|^NUMBER$|^KB_NUMBER/, "Регистрационный номер"],
    [/^PROTOCOL_NUMBER/, "Номер протокола"],
    [/^PROTOCOL_/, "Дата протокола"],
    [/^DOCUMENT_|^ISSUE_/, "Дата оформления"],
    [/^TRAINING_START/, "Начало обучения"],
    [/^TRAINING_END/, "Окончание обучения"],
    [/^VALID_/, "Срок действия"],
    [
      /^RESULT$|^BIOT_KNOWLEDGE_RESULT$/,
      "Фактический результат проверки знаний",
    ],
    [/^BIOT_PROCTORING_RESULT$/, "Результат прокторинга"],
    [/^BIOT_UNIQUE_NUMBER$/, "Уникальный номер ЕЦС"],
    [/^BIOT_CATEGORY/, "Категория БиОТ"],
    [/^BIOT_CHECK_TYPE/, "Вид проверки БиОТ"],
    [/^BIOT_INDUSTRY/, "Отрасль БиОТ"],
    [/^BIOT_NOTES$/, "Примечания БиОТ"],
    [/^SUBJECT$/, "Программа / тема обучения"],
    [/^HOURS$/, "Объём обучения"],
    [/^EDUCATION$/, "Образование"],
    [/^APPROVAL_BASIS$|^REASON$/, "Основание"],
    [/^SERIES$/, "Серия документа"],
  ];
  return groups.find(([pattern]) => pattern.test(key))?.[1] || key;
}
export function ServiceFormDetails({
  ids,
  templates,
}: {
  ids: string[];
  templates: Template[];
}) {
  return (
    <details>
      <summary>Версии форм, поля и выходные документы</summary>
      <p>
        Установленные формы для новых действий. Версии уже оформленных
        документов сохранены в их истории; этот справочник не меняет выданные
        файлы.
      </p>
      {ids.map((id) => {
        const versions = templates
          .filter((template) => (template.templateId || template.id) === id)
          .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
        return (
          <section key={id}>
            <strong>
              {(templateLabels[id] || id).replace(
                "индивидуальный протокол",
                "протокол",
              )}
            </strong>
            {!versions.length && (
              <p>Форма не установлена. Допустимость выдачи не подтверждена.</p>
            )}
            {versions.map((template) => {
              const contract = template.contract || {};
              const fields = Array.isArray(contract.fields)
                ? contract.fields.filter(
                    (field): field is string => typeof field === "string",
                  )
                : [];
              const exports = Array.isArray(contract.exports)
                ? contract.exports.filter(
                    (format): format is string => typeof format === "string",
                  )
                : template.exports || template.supportedExports || [];
              const labels = [
                ...new Set(fields.map(fieldLabel).filter(Boolean)),
              ];
              return (
                <div key={template.id}>
                  <p>
                    Назначение:{" "}
                    {contract.ownerKind === "GROUP"
                      ? "Общий протокол события"
                      : id.endsWith("-protocol")
                        ? "Индивидуальный протокол"
                        : "Индивидуальный документ"}
                    .
                  </p>
                  <p>
                    Версия формы: {template.version || "Не указана"}. Выходные
                    файлы: {exports.join(", ") || "Не подтверждены"}.
                  </p>
                  <p>
                    Поля данных: {labels.join("; ") || "Состав не подтверждён"}.
                  </p>
                  <p>
                    Выпуск требует проверки данных, фактического результата и
                    действующего разрешения центра для этой формы.
                  </p>
                </div>
              );
            })}
          </section>
        );
      })}
    </details>
  );
}
