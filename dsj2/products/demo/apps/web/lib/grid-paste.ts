import { LIMITS } from "@demo/contracts";
import { newRecipient, type Recipient } from "./types";
export const gridColumns = [
  ["fullNameRu", "ФИО RU"],
  ["fullNameKz", "ФИО KZ"],
  ["positionRu", "Должность RU"],
  ["positionKz", "Должность KZ"],
  ["workplaceRu", "Место работы RU"],
  ["workplaceKz", "Место работы KZ"],
  ["personnelNumber", "Табельный номер"],
  ["externalId", "Внешний ID"],
] as const;
export type GridField = (typeof gridColumns)[number][0];
export function parseClipboardRange(text: string): string[][] {
  if (text.length > 200_000)
    throw new Error("Диапазон слишком большой. Выберите не более 100 строк.");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (!cell) {
        quoted = true;
      } else {
        cell += ch;
      }
    } else if (!quoted && (ch === "\t" || ch === "\n" || ch === "\r")) {
      row.push(cell);
      cell = "";
      if (ch !== "\t") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else cell += ch;
  }
  if (quoted)
    throw new Error(
      "В диапазоне не закрыты кавычки. Повторно скопируйте прямоугольный диапазон из таблицы.",
    );
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) throw new Error("В буфере нет табличных данных.");
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width))
    throw new Error(
      "У строк разное количество ячеек. Скопируйте прямоугольный диапазон.",
    );
  return rows;
}
export function previewGridPaste(
  items: Recipient[],
  startRow: number,
  startField: GridField,
  text: string,
  mode: "EMPTY" | "REPLACE",
) {
  const data = parseClipboardRange(text);
  const startColumn = gridColumns.findIndex(([field]) => field === startField);
  if (startRow + data.length > LIMITS.rows)
    throw new Error(`Диапазон выходит за предел ${LIMITS.rows} получателей.`);
  if (startColumn + data[0].length > gridColumns.length)
    throw new Error(
      "Диапазон выходит за доступные колонки. Начните с ФИО RU или скопируйте меньше колонок.",
    );
  const next = items.map((item) => ({ ...item }));
  const changes: {
    row: number;
    field: GridField;
    before: string;
    after: string;
  }[] = [];
  data.forEach((values, rowIndex) => {
    const index = startRow + rowIndex;
    if (!next[index]) next[index] = newRecipient();
    values.forEach((value, columnIndex) => {
      const field = gridColumns[startColumn + columnIndex][0];
      const before = next[index][field] || "";
      if ((mode === "EMPTY" && before) || before === value) return;
      if (value.length > 500)
        throw new Error(`Строка ${index + 1}: поле длиннее 500 символов.`);
      next[index][field] = value;
      changes.push({ row: index + 1, field, before, after: value });
    });
  });
  return {
    items: next,
    changes,
    added: Math.max(0, next.length - items.length),
    rows: data.length,
    columns: data[0].length,
  };
}
