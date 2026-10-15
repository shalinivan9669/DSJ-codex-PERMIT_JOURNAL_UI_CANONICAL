"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Notice } from "@demo/ui";
import { ApiError, errorText } from "@/lib/api";

export type Language = "ru" | "kz";
export type Translate = (ru: string, kz: string) => string;
export function useLanguage(scope: string) {
  const [language, setLanguage] = useState<Language>("ru");
  useEffect(() => {
    try {
      setLanguage(
        localStorage.getItem(`demo:lms:language:${scope}`) === "kz"
          ? "kz"
          : "ru",
      );
    } catch {
      /* Storage is optional; the server remains the source of facts. */
    }
    const changed = (event: Event) => {
      const detail = (
        event as CustomEvent<{ scope: string; language: Language }>
      ).detail;
      if (detail?.scope === scope) setLanguage(detail.language);
    };
    window.addEventListener("demo:lms-language", changed);
    return () => window.removeEventListener("demo:lms-language", changed);
  }, [scope]);
  function change(value: Language) {
    setLanguage(value);
    window.dispatchEvent(
      new CustomEvent("demo:lms-language", {
        detail: { scope, language: value },
      }),
    );
    try {
      localStorage.setItem(`demo:lms:language:${scope}`, value);
    } catch {
      /* Optional preference. */
    }
  }
  return {
    language,
    setLanguage: change,
    t: ((ru, kz) => (language === "kz" ? kz : ru)) as Translate,
  };
}
export function LanguageSwitch({
  language,
  onChange,
}: {
  language: Language;
  onChange: (value: Language) => void;
}) {
  return (
    <div className="lms-language" role="group" aria-label="Язык / Тіл">
      <button
        type="button"
        lang="ru"
        aria-pressed={language === "ru"}
        onClick={() => onChange("ru")}
      >
        RU
      </button>
      <button
        type="button"
        lang="kk"
        aria-pressed={language === "kz"}
        onClick={() => onChange("kz")}
      >
        KZ
      </button>
    </div>
  );
}
export function LmsHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading lms-heading">
      <h1>{title}</h1>
      <div className="lms-actions">{children}</div>
    </div>
  );
}
export function LmsTabs({
  path,
  t,
  employer = false,
}: {
  path: string;
  t: Translate;
  employer?: boolean;
}) {
  const tabs = employer
    ? [
        ["/lms", t("Курсы", "Курстар")],
        ["/lms/assign", t("Сотрудники", "Қызметкерлер")],
        ["/lms/results", t("Результаты", "Нәтижелер")],
      ]
    : [
        ["/lms", t("Курсы", "Курстар")],
        ["/lms/assign", t("Назначения", "Тағайындаулар")],
        ["/lms/results", t("Результаты", "Нәтижелер")],
        ["/lms/sanitary", t("Санитарное обучение", "Санитариялық оқыту")],
      ];
  return (
    <nav className="lms-tabs" aria-label={t("Обучение", "Оқыту")}>
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={
            path === href ||
            (href === "/lms" && path.startsWith("/lms/courses/"))
              ? "page"
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function lmsError(error: unknown, t: Translate) {
  const code =
    error instanceof ApiError
      ? (error.details as { code?: string } | undefined)?.code || ""
      : "";
  if (
    [
      "REVISION_CONFLICT",
      "ANSWER_CONFLICT",
      "PROGRESS_CONFLICT",
      "VERSION_CONFLICT",
      "RESULT_REVISION_CONFLICT",
    ].includes(code)
  )
    return t(
      "Запись изменена в другом окне. Ваш ввод сохранён на странице. Откройте актуальную редакцию и проверьте отличия.",
      "Жазба басқа терезеде өзгерді. Енгізген деректеріңіз бетте қалды. Соңғы нұсқаны ашып, айырмашылықтарды тексеріңіз.",
    );
  if (error instanceof ApiError && error.status === 0)
    return t(
      "Нет связи. Введённые данные остаются на странице. Повторите после восстановления связи.",
      "Байланыс жоқ. Енгізілген деректер бетте қалады. Байланыс қалпына келгенде қайталаңыз.",
    );
  const messages: Record<string, [string, string]> = {
    ROLE_DENIED: [
      "Недостаточно прав для этого действия.",
      "Бұл әрекетке құқық жеткіліксіз.",
    ],
    VALIDATION: [
      "Проверьте заполнение полей.",
      "Өрістердің толтырылуын тексеріңіз.",
    ],
    EXAM_DATE_INVALID: [
      "Проверьте дату экзамена.",
      "Емтихан күнін тексеріңіз.",
    ],
    EXAM_DATE_ALREADY_KNOWN: [
      "Дата уже указана в основании.",
      "Күні негізде көрсетілген.",
    ],
    EXTERNAL_DATE_CONFLICT: [
      "Дата уже уточнена другим решением.",
      "Күн басқа шешіммен нақтыланған.",
    ],
    SOURCE_REVIEW_REQUIRED: [
      "Сначала подтвердите документальное основание.",
      "Алдымен құжаттық негізді растаңыз.",
    ],
    LESSONS_REQUIRED: [
      "Завершите обязательные уроки.",
      "Міндетті сабақтарды аяқтаңыз.",
    ],
    PREREQUISITE_REQUIRED: [
      "Сначала завершите предыдущий урок.",
      "Алдымен алдыңғы сабақты аяқтаңыз.",
    ],
    ATTEMPT_LIMIT: [
      "Попытки исчерпаны. Обратитесь в учебный центр.",
      "Талпыныстар таусылды. Оқу орталығына хабарласыңыз.",
    ],
    WAITING_EXTERNAL: [
      "Для программы требуется результат внешнего экзамена.",
      "Бағдарлама үшін сыртқы емтихан нәтижесі қажет.",
    ],
    ROUTE_REVIEW_REQUIRED: [
      "Маршрут экзамена требует проверки учебным центром.",
      "Емтихан тәртібін оқу орталығы тексеруі керек.",
    ],
    ROUTE_EXPIRED: [
      "Срок действия основания требует проверки.",
      "Негіздің қолданылу мерзімін тексеру қажет.",
    ],
    ASSESSMENT_REQUIREMENT: [
      "Сначала подтвердите обязательную проверку по программе.",
      "Алдымен бағдарлама бойынша міндетті тексеруді растаңыз.",
    ],
    COURSE_TITLE_REQUIRED: [
      "Укажите название на русском и казахском.",
      "Атауды орыс және қазақ тілдерінде көрсетіңіз.",
    ],
    LESSON_TITLE_REQUIRED: [
      "Укажите название каждого урока на двух языках.",
      "Әр сабақтың атауын екі тілде көрсетіңіз.",
    ],
    LESSON_TEXT_REQUIRED: [
      "Добавьте текст урока на двух языках.",
      "Сабақ мәтінін екі тілде қосыңыз.",
    ],
    MATERIAL_REQUIRED: [
      "Загрузите материал урока.",
      "Сабақ материалын жүктеңіз.",
    ],
    QUESTION_COUNT_INVALID: [
      "Добавьте вопросы для выбранного размера теста.",
      "Таңдалған тест көлеміне сұрақтар қосыңыз.",
    ],
    QUESTION_INVALID: [
      "Проверьте вопрос, переводы и правильные ответы.",
      "Сұрақты, аудармаларды және дұрыс жауаптарды тексеріңіз.",
    ],
    SANITARY_THRESHOLD: [
      "Для санитарной программы нужен результат более 80%.",
      "Санитариялық бағдарламада нәтиже 80%-дан жоғары болуы керек.",
    ],
  };
  if (messages[code]) return t(...messages[code]);
  return errorText(error);
}
export function LoadError({
  message,
  retry,
  t,
}: {
  message: string;
  retry: () => void;
  t: Translate;
}) {
  return (
    <Notice>
      {message}
      <button type="button" onClick={retry}>
        {t("Повторить", "Қайталау")}
      </button>
    </Notice>
  );
}
export function Status({ value, t }: { value: string; t: Translate }) {
  const names: Record<string, [string, string]> = {
    DRAFT: ["Черновик", "Жоба"],
    PROTOCOL: ["Протокол", "Хаттама"],
    CERTIFICATE: ["Сертификат", "Сертификат"],
    CREDENTIAL: ["Удостоверение", "Куәлік"],
    PUBLISHED: ["Опубликован", "Жарияланған"],
    ARCHIVED: ["В архиве", "Мұрағатта"],
    ACTIVE: ["Обучается", "Оқып жатыр"],
    IN_PROGRESS: ["В работе", "Орындалуда"],
    COMPLETED: ["Завершено", "Аяқталды"],
    PASSED: ["Сдано", "Өтті"],
    FAILED: ["Не сдано", "Өтпеді"],
    ABSENT: ["Не участвовал", "Қатыспады"],
    VOIDED: ["Аннулирован", "Күші жойылған"],
    PRACTICE: ["Учебный тест", "Жаттығу тесті"],
    CENTER_EXAM: ["Экзамен центра", "Орталық емтиханы"],
    EXTERNAL_AUTHORIZED: ["Внешний экзамен", "Сыртқы емтихан"],
    CONFIRMED: ["Подтверждено", "Расталған"],
    NEEDS_LEGAL_REVIEW: ["Нужна проверка основания", "Негізді тексеру қажет"],
    WAITING_EXTERNAL: ["Ожидает внешнего результата", "Сыртқы нәтиже күтілуде"],
    UNVERIFIED: ["Не проверено", "Тексерілмеген"],
    DOCUMENT_REVIEWED: ["Документ проверен", "Құжат тексерілген"],
    MACHINE_VERIFIED: ["Подтверждено системой", "Жүйемен расталған"],
    ELIGIBLE: ["Готово к оформлению", "Рәсімдеуге дайын"],
    BLOCKED: ["Нужна проверка", "Тексеру қажет"],
    NOT_CONNECTED: ["Подключение не настроено", "Қосылым бапталмаған"],
    READY: ["Готово", "Дайын"],
    PREPARED: ["Подготовлено", "Дайындалған"],
    PREPARING: ["Файлы готовятся", "Файлдар дайындалуда"],
    AWAITING_APPROVAL: ["Ожидает согласования", "Келісу күтілуде"],
    APPROVED: ["Согласовано", "Келісілген"],
    ISSUED: ["Выдано", "Берілген"],
    FINISHED: ["Завершено", "Аяқталды"],
    REVOKED: ["Аннулирован", "Күші жойылған"],
    SUPERSEDED: ["Заменено новой редакцией", "Жаңа нұсқамен ауыстырылған"],
    CORRECTED: ["Исправлено", "Түзетілген"],
    NOT_CONFIRMED: ["Ещё не подтверждено", "Әлі расталмаған"],
    PARTIAL: ["Принято частично", "Ішінара қабылданған"],
    RETRY_SCHEDULED: ["Ожидает повторной передачи", "Қайта жіберу күтілуде"],
    PENDING: ["Ожидает ответа", "Жауап күтілуде"],
    UNKNOWN: ["Исход требует проверки", "Нәтижені тексеру қажет"],
    REJECTED: ["Отклонено", "Қабылданбаған"],
    ACCEPTED: ["Принято системой", "Жүйе қабылдаған"],
    AWAITING_SIGNATURE: ["Ожидает подписи", "Қол қою күтілуде"],
    NEEDS_REVIEW: ["Нужна проверка", "Тексеру қажет"],
    OPERATOR_ATTESTED: [
      "Подтверждение добавлено оператором",
      "Растауды оператор қосты",
    ],
    PAPER_ORIGINAL: ["Бумажный оригинал", "Қағаз түпнұсқа"],
    ELECTRONIC_ORIGINAL: ["Электронный оригинал", "Электрондық түпнұсқа"],
    COPY_OF_ORIGINAL: ["Копия оригинала", "Түпнұсқа көшірмесі"],
    INFORMATION_CARD: ["Информационная карточка", "Ақпараттық карточка"],
  };
  const label = names[value];
  return (
    <span className="lms-status">
      {label ? t(...label) : t("На проверке", "Тексерілуде")}
    </span>
  );
}
export function PageControls({
  page,
  total,
  pageSize,
  onPage,
  t,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  t: Translate;
}) {
  if (total <= pageSize) return null;
  return (
    <nav
      className="lms-pagination"
      aria-label={t("Страницы списка", "Тізім беттері")}
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t("Назад", "Артқа")}
      </button>
      <span>
        {page} / {Math.ceil(total / pageSize)}
      </span>
      <button
        type="button"
        disabled={page * pageSize >= total}
        onClick={() => onPage(page + 1)}
      >
        {t("Далее", "Келесі")}
      </button>
    </nav>
  );
}
