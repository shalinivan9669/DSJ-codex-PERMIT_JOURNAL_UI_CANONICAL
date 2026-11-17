import {
  courseProgramKeys,
  isProtectedField,
  type CommonFields,
} from "@demo/contracts";

type ProgramKey = (typeof courseProgramKeys)[number];
export type TrainingTopic = Pick<CommonFields, ProgramKey> & {
  id: string;
  origin: "COURSE" | "SAVED";
};

const titleKey = (value?: string) =>
  value?.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("ru");

function specified(fields: CommonFields, key: ProgramKey) {
  const origin = fields.fieldOrigins?.[key];
  return (
    isProtectedField(origin) ||
    (origin !== "COURSE" && origin !== "AUTO" && !!fields[key]?.trim())
  );
}

function topicKeys(template: string) {
  return template.startsWith("ps-")
    ? courseProgramKeys
    : courseProgramKeys.slice(0, 2);
}

/** A typed title is enough only when every matching version agrees on that field. */
export function completeTrainingTopic(
  current: CommonFields,
  template: string,
  title: string,
  candidates: readonly TrainingTopic[],
  inherited: readonly (CommonFields | undefined)[],
): CommonFields {
  const match = titleKey(title);
  const matches = match
    ? candidates.filter((topic) => titleKey(topic.trainingSubject) === match)
    : [];
  const next: CommonFields = {
    ...current,
    trainingSubject: title,
    fieldOrigins: {
      ...current.fieldOrigins,
      trainingSubject: title ? "MANUAL" : "CLEARED",
    },
  };
  for (const key of topicKeys(template)) {
    if (key === "trainingSubject" || specified(current, key)) continue;
    // Autocompleted details belong to the title. Drop them as soon as the title
    // changes, including when the replacement is unknown or has multiple versions.
    if (next.fieldOrigins![key] === "AUTO") {
      delete next[key];
      delete next.fieldOrigins![key];
    }
    if (inherited.some((fields) => fields && specified(fields, key))) continue;
    const value = matches[0]?.[key]?.trim();
    if (!value || !matches.every((topic) => topic[key]?.trim() === value))
      continue;
    next[key] = value;
    next.fieldOrigins![key] = "AUTO";
  }
  return next;
}

/** Replacing an entered value, including an explicit blank, uses the existing review. */
export function topicWouldReplaceInput(
  topic: TrainingTopic,
  template: string,
  sources: readonly (CommonFields | undefined)[],
) {
  return topicKeys(template).some((key) => {
    const existing = sources.find((fields) => fields && specified(fields, key));
    return existing && (existing[key] || "") !== (topic[key] || "");
  });
}
