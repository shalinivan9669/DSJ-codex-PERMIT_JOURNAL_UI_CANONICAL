import { templateLabels, type Recipient, type Validation } from "./types";

type Issue =
  | string
  | (Exclude<Validation["errors"][number], string> & { rowId?: string });
export function groupValidationIssues(errors: Issue[], items: Recipient[]) {
  const groups = new Map<
    string,
    { title: string; issues: { issue: Issue; document: string }[] }
  >();
  const seen = new Set<string>();
  for (const issue of errors) {
    const path =
      typeof issue === "string"
        ? ""
        : Array.isArray(issue.path)
          ? issue.path.join(".")
          : issue.path || "";
    const match = /^items\.(\d+)(?:\.assignments\.(\d+))?/.exec(path);
    const rowId =
      typeof issue === "string" ? undefined : issue.rowId || issue.itemId;
    const shared = /^(events|commonFields|profile|issuer)(\.|$)/.test(path);
    const person = shared
      ? undefined
      : (rowId ? items.find((item) => item.id === rowId) : undefined) ||
        (match ? items[Number(match[1])] : undefined);
    const key = person?.id || "common";
    const message = typeof issue === "string" ? issue : issue.message;
    const identity = JSON.stringify([key, path, message]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const document =
      person && match?.[2] !== undefined
        ? person.assignments[Number(match[2])]?.templateId
        : undefined;
    if (!groups.has(key))
      groups.set(key, {
        title: person
          ? person.fullNameRu ||
            person.fullNameKz ||
            `Получатель ${items.indexOf(person) + 1}`
          : "Общее для заявки и центра",
        issues: [],
      });
    groups.get(key)!.issues.push({
      issue,
      document: document ? templateLabels[document] || document : "",
    });
  }
  return [...groups]
    .sort(([a], [b]) => (a === "common" ? -1 : b === "common" ? 1 : 0))
    .map(([key, group]) => ({ key, ...group }));
}
