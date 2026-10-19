import {
  canAuthorPrograms,
  lmsQuestionSchema,
  z,
  type LmsQuestion,
} from "@demo/contracts";
import { fail, parse, type Context } from "../core";
import { assertQuestionPublishable } from "./validation";
import { questionSemanticHash } from "./question-semantics";
import { saveQuestion } from "./questions";

export const questionImportColumns = [
  "kind",
  "category",
  "topic",
  "questionRu",
  "questionKz",
  "optionsRu",
  "optionsKz",
  "correct",
  "rightRu",
  "rightKz",
  "criteriaRu",
  "criteriaKz",
  "explanationRu",
  "explanationKz",
  "source",
  "contextRu",
  "contextKz",
];
const split = (value = "") =>
  value ? value.split("|").map((item) => item.trim()) : [];
/** Spreadsheet-friendly TSV; option and right-side indexes remain stable across repeated imports. */
export function parseQuestionImport(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split("\n");
  const headers =
    lines
      .shift()
      ?.split("\t")
      .map((item) => item.trim()) || [];
  if (
    ["kind", "questionRu", "questionKz"].some(
      (key) => !headers.includes(key),
    ) ||
    new Set(headers).size !== headers.length
  )
    fail(
      400,
      "QUESTION_IMPORT_HEADER",
      "Используйте шаблон банка вопросов: вид и тексты вопроса обязательны",
    );
  if (!lines.length || lines.length > 500)
    fail(
      400,
      "QUESTION_IMPORT_LIMIT",
      "Импортируйте от 1 до 500 вопросов за раз",
    );
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const cells = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, i) => [header, cells[i] || ""]),
    );
    try {
      const ru = split(row.optionsRu),
        kz = split(row.optionsKz),
        rightRu = split(row.rightRu),
        rightKz = split(row.rightKz);
      if (ru.length !== kz.length || rightRu.length !== rightKz.length)
        throw new Error(
          "Число вариантов RU/KZ различается / RU/KZ нұсқаларының саны әртүрлі",
        );
      const options = ru.map((textRu, i) => ({
        id: String(i + 1),
        textRu,
        textKz: kz[i],
      }));
      const keys = row.correct
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      let answerSpec: LmsQuestion["answerSpec"];
      switch (row.kind) {
        case "SINGLE":
        case "MULTIPLE":
          answerSpec = { kind: row.kind, correctOptionIds: keys };
          break;
        case "ORDERING":
          answerSpec = { kind: "ORDERING", correctOrderIds: keys };
          break;
        case "MATCHING":
          answerSpec = {
            kind: "MATCHING",
            rightOptions: rightRu.map((textRu, i) => ({
              id: String(i + 1),
              textRu,
              textKz: rightKz[i],
            })),
            pairs: keys.map((pair) => {
              const [leftId, rightId] = pair.split(":");
              return { leftId, rightId };
            }),
          };
          break;
        case "TEXT":
          answerSpec = row.correct
            ? {
                kind: "TEXT",
                mode: "EXACT",
                acceptedAnswers: split(row.correct),
                caseSensitive: false,
                collapseWhitespace: true,
              }
            : {
                kind: "TEXT",
                mode: "MANUAL",
                criteriaRu: row.criteriaRu,
                criteriaKz: row.criteriaKz,
              };
          break;
        case "CASE":
          answerSpec = {
            kind: "CASE",
            contextRu: row.contextRu,
            contextKz: row.contextKz,
            response: {
              kind: "TEXT",
              mode: "MANUAL",
              criteriaRu: row.criteriaRu,
              criteriaKz: row.criteriaKz,
            },
          };
          break;
        default:
          throw new Error("Неизвестный вид вопроса / Сұрақ түрі белгісіз");
      }
      const question = lmsQuestionSchema.parse({
        id: `import-${index + 1}`,
        category: row.category,
        topic: row.topic,
        promptRu: row.questionRu,
        promptKz: row.questionKz,
        options,
        multiple: row.kind === "MULTIPLE",
        correctOptionIds: ["SINGLE", "MULTIPLE"].includes(row.kind) ? keys : [],
        answerSpec,
        explanationRu: row.explanationRu,
        explanationKz: row.explanationKz,
        source: row.source,
      });
      assertQuestionPublishable(question);
      const meaning = questionSemanticHash(question);
      const duplicate = seen.has(meaning);
      seen.add(meaning);
      return {
        row: index + 2,
        title: question.promptRu,
        question,
        error: null,
        duplicate,
      };
    } catch (error) {
      return {
        row: index + 2,
        title: row.questionRu,
        question: null,
        error:
          error instanceof Error && !error.message.startsWith("[")
            ? error.message
            : "Проверьте тексты, варианты и правильный ответ / Мәтіндерді, нұсқаларды және дұрыс жауапты тексеріңіз",
        duplicate: false,
      };
    }
  });
}
export async function importQuestions(c: Context, input: unknown) {
  if (c.learningMode || !canAuthorPrograms(c.role))
    fail(403, "ROLE_DENIED", "Импорт доступен методисту и администратору");
  const body = parse(
    z
      .object({
        text: z.string().min(1).max(2_000_000),
        commit: z.boolean().default(false),
      })
      .strict(),
    input,
  );
  const rows = parseQuestionImport(body.text);
  if (!body.commit)
    return {
      rows: rows.map(({ question: _question, ...row }) => row),
      valid: rows.filter((row) => !row.error && !row.duplicate).length,
    };
  if (rows.some((row) => row.error))
    fail(
      400,
      "QUESTION_IMPORT_ERRORS",
      "Исправьте строки с ошибками и повторите проверку",
    );
  const ids: string[] = [];
  for (const row of rows)
    if (row.question && !row.duplicate) {
      const revision = await saveQuestion(c, { question: row.question });
      ids.push(revision.question.libraryQuestionId!);
    }
  return { saved: ids.length, questionIds: ids };
}
