import { LIMITS } from "@demo/contracts";
import { newRecipient, type Recipient } from "./types";
import { isBlankText } from "./blank-text";
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
  // Eight columns of 500 characters per recipient plus TSV quoting overhead.
  if (text.length > LIMITS.rows * gridColumns.length * 1_002)
    throw new Error(
      `Диапазон слишком большой. Выберите не более ${LIMITS.rows} строк.`,
    );
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
  columns: readonly GridField[] = gridColumns.map(([field]) => field),
  blankRows: "KEEP" | "SKIP" = "KEEP",
) {
  const source = parseClipboardRange(text);
  const sourceRows = source.map((values, index) => ({
    values,
    sourceRow: index + 1,
    blank: values.every(isBlankText),
  }));
  const data = sourceRows.filter((row) => blankRows === "KEEP" || !row.blank);
  const startColumn = columns.indexOf(startField);
  if (startColumn < 0 || new Set(columns).size !== columns.length)
    throw new Error("Выберите доступную колонку для начала вставки.");
  if (startRow + data.length > LIMITS.rows)
    throw new Error(`Диапазон выходит за предел ${LIMITS.rows} получателей.`);
  if (!Number.isInteger(startRow) || startRow < 0 || startRow > items.length)
    throw new Error(
      "Начало диапазона должно быть существующей строкой или следующей новой строкой заявки.",
    );
  if (startColumn + source[0].length > columns.length)
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
  const createdRows: { row: number; sourceRow: number; blank: boolean }[] = [];
  let skippedFilled = 0;
  let unchanged = 0;
  data.forEach(({ values, sourceRow, blank }, rowIndex) => {
    const index = startRow + rowIndex;
    if (!next[index]) {
      next[index] = { ...newRecipient(), assignments: [] };
      createdRows.push({ row: index + 1, sourceRow, blank });
    }
    values.forEach((value, columnIndex) => {
      const field = columns[startColumn + columnIndex];
      const before = next[index][field] || "";
      if (value.length > 500)
        throw new Error(`Строка ${index + 1}: поле длиннее 500 символов.`);
      if (mode === "EMPTY" && !isBlankText(before)) {
        skippedFilled++;
        return;
      }
      if (before === value) {
        unchanged++;
        return;
      }
      next[index][field] = value;
      changes.push({ row: index + 1, field, before, after: value });
    });
  });
  return {
    items: next,
    changes,
    added: Math.max(0, next.length - items.length),
    rows: source.length,
    appliedRows: data.length,
    columns: source[0].length,
    blankRows: sourceRows
      .filter((row) => row.blank)
      .map((row) => row.sourceRow),
    skippedBlankRows: source.length - data.length,
    createdRows,
    skippedFilled,
    unchanged,
  };
}

/** Fast paste has an exact visible schema and touches only empty effective cells. */
export function quickGridPaste(
  items: Recipient[],
  effectiveItems: Recipient[],
  range: {
    startRow: number;
    startField: GridField;
    text: string;
    columns?: readonly GridField[];
  },
  filtered = false,
) {
  if (filtered)
    return {
      eligible: false as const,
      reason:
        "Под поиском или фильтром порядок целей неоднозначен. Сбросьте фильтры перед вставкой.",
    };
  if (!range.columns?.length)
    return {
      eligible: false as const,
      reason:
        "Порядок колонок не подтверждён. Проверьте диапазон перед применением.",
    };
  const preview = previewGridPaste(
    items,
    range.startRow,
    range.startField,
    range.text,
    "EMPTY",
    range.columns,
  );
  if (preview.blankRows.length)
    return {
      eligible: false as const,
      reason:
        "В диапазоне есть пустые строки. Выберите явно, сохранить или пропустить их.",
    };
  if (preview.skippedFilled)
    return {
      eligible: false as const,
      reason:
        "Диапазон содержит заполненные поля. Проверьте, какие значения оставить или заменить.",
    };
  const effectiveById = new Map(effectiveItems.map((item) => [item.id, item]));
  const startColumn = range.columns.indexOf(range.startField);
  const source = parseClipboardRange(range.text);
  for (let row = 0; row < source.length; row++) {
    const item = items[range.startRow + row];
    if (!item) continue;
    const effective = effectiveById.get(item.id) || item;
    for (let column = 0; column < source[row].length; column++) {
      const field = range.columns[startColumn + column];
      if (!isBlankText(effective[field] || ""))
        return {
          eligible: false as const,
          reason:
            "В диапазоне есть подставленные или сохранённые значения. Проверьте изменения перед применением.",
        };
    }
  }
  return { eligible: true as const, preview };
}
