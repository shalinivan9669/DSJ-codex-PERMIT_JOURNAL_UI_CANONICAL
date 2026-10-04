import {
  courseProgramDefaults,
  draftSchema,
  employeeCategoryFor,
  trainingDirection,
  z,
  type CommonFields,
} from "@demo/contracts";
import { db, fail, parse, type Context } from "./core";

const querySchema = z
  .object({
    direction: z.enum(["BIOT", "PTM", "PB", "PS"]),
    category: z.enum(["WORKER", "ITR"]).default("WORKER"),
  })
  .strict();
export type TrainingTopic = Pick<
  CommonFields,
  | "trainingSubject"
  | "trainingSubjectKz"
  | "psGeneralSubjectRu"
  | "psGeneralSubjectKz"
  | "psSpecialSubjectRu"
  | "psSpecialSubjectKz"
> & {
  id: string;
  origin: "COURSE" | "SAVED";
};

/** Reusable text only. Outcomes, dates, grades and evidence never enter this list. */
export async function trainingTopics(c: Context, query: unknown) {
  if (!["ADMIN", "DIRECTOR", "OPERATOR"].includes(c.role))
    fail(403, "ROLE_DENIED", "Темы обучения доступны сотрудникам центра");
  const filter = parse(querySchema, query);
  const template =
    filter.direction === "BIOT"
      ? filter.category === "ITR"
        ? "biot-itr-protocol"
        : "biot-protocol"
      : `${filter.direction.toLowerCase()}-protocol`;
  const defaults = courseProgramDefaults(template);
  const items: TrainingTopic[] = [];
  const seen = new Set<string>();
  function add(fields: CommonFields, origin: TrainingTopic["origin"]) {
    const keys = [
      "trainingSubject",
      "trainingSubjectKz",
      "psGeneralSubjectRu",
      "psGeneralSubjectKz",
      "psSpecialSubjectRu",
      "psSpecialSubjectKz",
    ] as const;
    if (!fields.trainingSubject?.trim()) return;
    const values = Object.fromEntries(
      keys.flatMap((key) =>
        fields[key] === undefined ? [] : [[key, fields[key]?.trim() || ""]],
      ),
    );
    // An omitted optional language/discipline and an explicitly empty one
    // describe the same reusable topic, even across older draft versions.
    const key = JSON.stringify(
      keys.map((field) => values[field] || ""),
    ).normalize("NFKC");
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      ...values,
      id: `${origin.toLowerCase()}-${items.length}`,
      origin,
    });
  }
  add(defaults, "COURSE");
  const [requests, proposals] = await Promise.all([
    db.printRequest.findMany({
      where: { tenantId: c.tenantId },
      select: { draft: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.requestProposal.findMany({
      where: { tenantId: c.tenantId },
      select: { payload: true },
      orderBy: { submittedAt: "desc" },
    }),
  ]);
  for (const payload of [
    ...requests.map((request) => request.draft),
    ...proposals.map((proposal) => proposal.payload),
  ]) {
    const result = draftSchema.safeParse(payload);
    if (!result.success) continue;
    const draft = result.data;
    for (const event of draft.events || []) {
      if (
        trainingDirection(event.protocolTemplateId) !== filter.direction ||
        (filter.direction === "BIOT" && event.protocolTemplateId !== template)
      )
        continue;
      add(event.commonFields, "SAVED");
    }
    for (const item of draft.items) {
      if (
        filter.direction === "BIOT" &&
        employeeCategoryFor(item) !== filter.category
      )
        continue;
      for (const assignment of item.assignments) {
        if (
          trainingDirection(assignment.templateId) !== filter.direction ||
          assignment.templateId.endsWith("-protocol")
        )
          continue;
        add(assignment, "SAVED");
      }
    }
  }
  return { items };
}
