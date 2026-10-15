import type { Response } from "express";
import { once } from "node:events";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRender } from "@demo/printing";
import { z } from "@demo/contracts";
import { audit, db, parse, type Context } from "../core";
import { enrollmentPageFacts } from "./enrollment-list";
import { parseEnrollmentQuery, scopedEnrollmentIds } from "./enrollment-query";

export const resultExportSchema = z
  .object({
    filters: z.record(z.string(), z.unknown()).default({}),
    format: z.enum(["CSV", "XLSX"]),
    language: z.enum(["ru", "kz"]).default("ru"),
  })
  .strict();
const headings = {
  ru: [
    "Слушатель",
    "Организация",
    "Курс",
    "Версия",
    "Группа",
    "Прогресс, %",
    "Результат",
    "Срок доступа",
    "Документы",
  ],
  kz: [
    "Тыңдаушы",
    "Ұйым",
    "Курс",
    "Нұсқа",
    "Топ",
    "Барысы, %",
    "Нәтиже",
    "Қолжетімділік мерзімі",
    "Құжаттар",
  ],
};
const states: Record<string, [string, string]> = {
  ACTIVE: ["Обучается", "Оқып жатыр"],
  PASSED: ["Сдано", "Өтті"],
  FAILED: ["Не сдано", "Өтпеді"],
  VOIDED: ["Аннулирован", "Күші жойылған"],
  SUPERSEDED: ["Заменено", "Ауыстырылған"],
  NEEDS_REVIEW: ["Нужна проверка", "Тексеру қажет"],
  ISSUED: ["Выдано", "Берілген"],
  AWAITING_APPROVAL: ["Ожидает согласования", "Келісу күтілуде"],
  PREPARING: ["Файлы готовятся", "Файлдар дайындалуда"],
  REJECTED: ["Отклонено", "Қабылданбаған"],
  AWAITING_SIGNATURE: ["Ожидает подписи", "Қол қою күтілуде"],
};
export function safeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
export async function exportResults(c: Context, input: unknown, res: Response) {
  const data = parse(resultExportSchema, input);
  const q = parseEnrollmentQuery({ ...data.filters, page: 1, pageSize: 100 });
  const languageIndex = data.language === "kz" ? 1 : 0;
  const label = (value: string) =>
    states[value]?.[languageIndex] || states.NEEDS_REVIEW[languageIndex];
  const headers = headings[data.language];
  const temp =
    data.format === "XLSX"
      ? await mkdtemp(join(tmpdir(), "demo-lms-export-"))
      : null;
  const output = temp
    ? await open(join(temp, "rows.jsonl"), "wx", 0o600)
    : null;
  let count = 0;
  try {
    if (data.format === "CSV") {
      res.type("text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=LMS-results.csv",
      );
      res.write("\uFEFF" + headers.map(safeCsvCell).join(";") + "\r\n");
    }
    let after: { assignedAt: Date; id: string } | undefined;
    while (!res.destroyed) {
      const page = await scopedEnrollmentIds(c, q, after);
      if (!page.length) break;
      const facts = await enrollmentPageFacts(
        c,
        page.map((e) => e.id),
      );
      for (const row of facts) {
        const values = [
          data.language === "kz"
            ? row.recipient.data.fullNameKz || row.recipient.data.fullNameRu
            : row.recipient.data.fullNameRu,
          data.language === "kz"
            ? row.customer?.nameKz || row.customer?.nameRu
            : row.customer?.nameRu,
          data.language === "kz"
            ? row.courseVersion.content.titleKz ||
              row.courseVersion.content.titleRu
            : row.courseVersion.content.titleRu,
          row.courseVersion.version,
          row.group?.name || row.groupKey,
          row.progressPercent,
          label(row.result?.state || row.status),
          row.dueAt.toISOString(),
          row.documents.length
            ? [...new Set(row.documents.map((d) => label(d.status)))].join(", ")
            : "",
        ];
        if (output)
          await output.write(
            JSON.stringify(
              Object.fromEntries(values.map((v, i) => [String(i), v ?? ""])),
            ) + "\n",
          );
        else if (!res.write(values.map(safeCsvCell).join(";") + "\r\n"))
          await once(res, "drain");
        count++;
      }
      after = page.at(-1)!;
      if (page.length < q.pageSize) break;
    }
    if (output && temp) {
      await output.close();
      const rendered = await runRender("xlsx", {
        itemsFile: join(temp, "rows.jsonl"),
        columns: headers.map((title, i) => ({ field: String(i), title })),
      });
      res.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=LMS-results.xlsx",
      );
      res.send(rendered.buffer);
    } else res.end();
    await audit(db, c, "LMS_RESULTS_EXPORTED", "LMS_RESULTS", {
      format: data.format,
      count,
      filters: q,
    });
  } finally {
    await output?.close().catch(() => {});
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}
