/** Non-blocking source checks. Never normalises or changes personal data. */
export function textQualityHints(value: string): string[] {
  const hints: string[] = [];
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(value))
    hints.push(
      "В тексте есть невидимый или управляющий направлением знак. Сверьте с исходником; значение сохранено без исправлений.",
    );
  if (
    value
      .split(/[^\p{L}]+/u)
      .some(
        (word) =>
          /\p{Script=Latin}/u.test(word) && /\p{Script=Cyrillic}/u.test(word),
      )
  )
    hints.push(
      "В одном слове смешаны латинские и кириллические буквы. Проверьте похожие символы по исходнику; иностранное имя можно оставить.",
    );
  return hints;
}
