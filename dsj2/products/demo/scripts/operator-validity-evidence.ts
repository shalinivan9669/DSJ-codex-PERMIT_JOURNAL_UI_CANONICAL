import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { measuredValidityRows } from "../apps/web/test/validity-policy-fixture";
async function main() {
  const directory = resolve(
    "docs/evidence/operator-flow-full-fix-20261003/preparation",
  );
  await mkdir(directory, { recursive: true });
  const rows = measuredValidityRows();
  const allOrigins = ["MANUAL", "IMPORTED", "INHERITED", "CLEARED"] as const;
  await writeFile(
    resolve(directory, "R4-code-driven-validity-readback.json"),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        method:
          "Current code: draftSchema -> applyBusinessRules -> resolveDraft -> eventProtocolAssignment LIVE -> displayed helper. Synthetic fixtures, no database writes; legal approval not established.",
        scenarios: allOrigins.flatMap((origin) => measuredValidityRows(origin)),
      },
      null,
      2,
    ) + "\n",
  );
  const cell = (value: unknown) =>
    String(value ?? "")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ");
  const header =
    "# R4 — фактические сроки и подсказки по текущему коду\n\nТаблица построена запуском текущего кода на синтетических данных. Дата документа 03.10.2026, исходное ручное окончание 31.12.2035. LIVE_V1 заменяет окончание расчётом и происхождением AUTO. В JSON отдельно выполнены MANUAL / IMPORTED / INHERITED / CLEARED для даты выдачи. Это проверка продуктового контракта; юридическая правильность сроков не установлена.\n\nПредметное расхождение подтверждено: INSPECTOR_SPECIAL preset указывает 1 год, COUNCIL_GENERAL / COUNCIL_SPECIAL — срок полномочий; LIVE_V1 печатает ИТР 3 года. Экран теперь прямо объясняет различие и показывает действующий расчёт. Нормативные presets, часы, ЕЦС и макеты не менялись.\n\nДо UX-13 редактируемое поле обещало сохранение ручной даты (исходные PNG 27/28). Теперь LIVE_V1 поле только для чтения; изменение даты документа пересчитывает срок.\n\n| Категория | Документ | Область | Подсказка | Preset срок | LIVE правило | Displayed | Resolved | Saved origin | Resolved origin |\n|---|---|---|---|---|---|---|---|---|---|\n";
  const body = rows
    .map((row) =>
      [
        row.selectedCategory,
        row.templateId,
        row.scope,
        row.hint,
        row.presetValidity,
        row.liveRule,
        row.displayedUntil || "Бессрочно/дата не указана",
        row.resolvedUntil || "Бессрочно/дата не указана",
        row.savedOrigin,
        row.resolvedOrigin,
      ]
        .map(cell)
        .join(" | "),
    )
    .map((line) => "| " + line + " |")
    .join("\n");
  await writeFile(
    resolve(directory, "R4_VALIDITY_TABLE_RU.md"),
    header + body + "\n",
  );
  console.log(
    JSON.stringify({
      rows: rows.length,
      originScenarios: rows.length * allOrigins.length,
      output: directory,
    }),
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
