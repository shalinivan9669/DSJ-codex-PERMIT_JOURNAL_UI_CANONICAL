import { trainingDirection, type Draft } from "@demo/contracts";
import { addressIssue, type AddressedIssue } from "./validation-address";
import type { Validation } from "./types";
import { trainingDisplayTitle } from "./training-display";

/** Collapse repeated document requirements only when they have one input source. */
export function approvalIssueGroups(
  issues: Validation["errors"],
  draft?: Draft | null,
) {
  const groups = new Map<
    string,
    {
      key: string;
      title: string;
      entries: { key: string; issue: AddressedIssue | string; count: number }[];
    }
  >();
  const seen = new Map<
    string,
    { key: string; issue: AddressedIssue | string; count: number }
  >();
  for (const issue of issues) {
    const addressed = addressIssue(
      issue,
      draft?.items || [],
      draft?.events || [],
    ) as AddressedIssue | string;
    const path =
      typeof addressed === "string" ? "" : String(addressed.path || "");
    const index = /^items\.(\d+)(?:\.assignments\.(\d+))?/.exec(path);
    const row =
      typeof addressed === "string"
        ? undefined
        : draft?.items.find(
            (item) =>
              item.id ===
              (addressed.rowId || addressed.recipientId || addressed.itemId),
          ) || (index ? draft?.items[Number(index[1])] : undefined);
    const assignment =
      typeof addressed === "string"
        ? undefined
        : row?.assignments.find((item) => item.id === addressed.assignmentId) ||
          (index?.[2] ? row?.assignments[Number(index[2])] : undefined);
    const field =
      typeof addressed === "string"
        ? ""
        : addressed.field ||
          path
            .split(".")
            .slice(index?.[2] ? 4 : 2)
            .join(".");
    const event = draft?.events?.find(
      (item) =>
        item.id ===
        (typeof addressed === "string"
          ? undefined
          : addressed.eventId || assignment?.eventId),
    );
    const course =
      event?.title ||
      (assignment ? trainingDirection(assignment.templateId) : "Обучение");
    const own = assignment?.fieldOrigins?.[field];
    const sharedCourse =
      !!event &&
      !["MANUAL", "IMPORTED", "CLEARED"].includes(own || "") &&
      /^(trainingSubject|hours|productionHours|biotIndustry|biotKnowledgeResult|biotProctoringResult|documentDate|protocolDate|trainingStart|trainingEnd)/.test(
        field,
      );
    const inheritedEmployer =
      !!row &&
      !row.workplaceRu &&
      !row.workplaceKz &&
      /^(employer|workplace)/.test(field);
    const personTitle =
      row?.fullNameRu ||
      row?.fullNameKz ||
      `Получатель ${(draft?.items.indexOf(row!) ?? -1) + 1}`;
    const key = /^(profile|issuer)/.test(path)
      ? "center"
      : sharedCourse
        ? `course:${event!.id}`
        : inheritedEmployer
          ? `company:${row?.employerId || draft?.customerId || "default"}`
          : row
            ? `person:${row.id}`
            : "request";
    const title =
      key === "center"
        ? "Настройки центра"
        : sharedCourse
          ? trainingDisplayTitle(course)
          : inheritedEmployer
            ? "Компания / работодатель"
            : row
              ? personTitle
              : "Общие данные заявки";
    // Outcomes/professions are one fact per person/course, never merged across people.
    const identity = JSON.stringify([
      key,
      key === "center" || key.startsWith("company:")
        ? ""
        : assignment?.eventId ||
          (assignment ? trainingDirection(assignment.templateId) : ""),
      field,
      typeof addressed === "string"
        ? addressed
        : (addressed as AddressedIssue & { code?: string }).code ||
          addressed.message,
    ]);
    const existing = seen.get(identity);
    if (existing) {
      existing.count++;
      continue;
    }
    const entry = { key: identity, issue: addressed, count: 1 };
    seen.set(identity, entry);
    if (!groups.has(key)) groups.set(key, { key, title, entries: [] });
    groups.get(key)!.entries.push(entry);
  }
  return [...groups.values()];
}
