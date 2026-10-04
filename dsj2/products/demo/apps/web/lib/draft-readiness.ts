import {
  documentPlan,
  eventProtocolAssignment,
  resolveDraft,
  validateDraft,
  draftSchema,
  type Draft,
  type IssuerProfile,
  type ValidationIssue,
} from "@demo/contracts";

/** Each result is one person in one training, including historical omitted UNKNOWN metadata. */
export function trainingOutcomeSummary(draft: Pick<Draft, "items">) {
  return draft.items.reduce(
    (summary, item) => {
      const trainings = new Set(
        item.assignments
          .filter(
            (assignment) =>
              (assignment.protocolMode === "GROUP" || !!assignment.outcome) &&
              (!assignment.outcome || assignment.outcome.status === "UNKNOWN"),
          )
          .map((assignment) => assignment.eventId || assignment.id),
      ).size;
      return {
        trainings: summary.trainings + trainings,
        recipients: summary.recipients + (trainings > 0 ? 1 : 0),
      };
    },
    { trainings: 0, recipients: 0 },
  );
}

/**
 * Immediate, side-effect-free hints for the current input. A supplied resolution
 * must belong to that input and include its current organization/profile values.
 * Passing no profile deliberately retains the contract's missing-profile issue.
 * This does not check template approval, references, photos, layout, approval,
 * or separately pinned event profiles unavailable to this local check.
 */
export function draftReadiness(
  draft: Draft,
  profile: IssuerProfile | null,
  resolved?: Pick<ReturnType<typeof resolveDraft>, "draft" | "issues">,
) {
  const current = resolved || resolveDraft(draft, profile?.commonFields);
  const contractIssues = validateDraft(current.draft, profile);
  const format = draftSchema.safeParse(draft);
  if (!format.success)
    for (const issue of format.error.issues) {
      const path = issue.path.join(".");
      if (
        issue.code !== "too_big" ||
        !/^(items|events|commonFields|title)(\.|$)/.test(path)
      )
        continue;
      const row = /^items\.(\d+)(?:\.assignments\.(\d+))?/.exec(path);
      const recipient = row ? draft.items[Number(row[1])] : undefined;
      const assignment =
        row?.[2] !== undefined
          ? recipient?.assignments[Number(row[2])]
          : undefined;
      const value = issue.path.reduce<unknown>(
        (parent, key) =>
          parent && typeof parent === "object"
            ? (parent as Record<string | number, unknown>)[
                key as string | number
              ]
            : undefined,
        draft,
      );
      contractIssues.push({
        code: "FIELD_LENGTH",
        path,
        rowId: recipient?.id,
        assignmentId: assignment?.id,
        eventId: assignment?.eventId,
        message: `Максимум ${issue.maximum} символов. Сейчас ${String(value || "").length}. Текст остаётся в поле для исправления.`,
      });
    }
  // Group protocols are virtual assignments. Match the server's contract check
  // so fields required only by their print form are visible before preparation.
  const rowIndex = new Map(
    current.draft.items.map((item, index) => [item.id, index]),
  );
  for (const group of documentPlan(current.draft).groups) {
    const separateProfile =
      group.event.profileVersionId &&
      group.event.profileVersionId !== current.draft.profileVersionId;
    for (const member of group.members) {
      const row = rowIndex.get(member.item.id)!;
      const column = member.item.assignments.findIndex(
        (assignment) => assignment.id === member.assignment.id,
      );
      const protocol = eventProtocolAssignment(group.event, member.assignment);
      const memberIssues = validateDraft(
        {
          ...current.draft,
          items: [
            {
              ...member.item,
              assignments: [member.assignment, protocol],
            },
          ],
        },
        profile,
        { skipBusinessRules: true },
      );
      for (const issue of memberIssues) {
        // The server validates this protocol against its pinned event profile.
        // A missing field in the request profile cannot establish a problem in
        // a different profile. Request-level issues above remain authoritative
        // local hints; the separately pinned profile still needs server review.
        if (separateProfile && /^(profile|issuer)(\.|$)/.test(issue.path))
          continue;
        const assignmentPath =
          /^items\.0\.assignments\.([01])(?:\.(.+))?$/.exec(issue.path);
        let path = issue.path;
        if (assignmentPath) {
          // Both checked assignments belong to the original participant. The
          // virtual protocol's issue date is the editable protocol date.
          const field =
            assignmentPath[1] === "1" && assignmentPath[2] === "documentDate"
              ? "protocolDate"
              : assignmentPath[2];
          path = `items.${row}.assignments.${column}${field ? `.${field}` : ""}`;
        } else path = path.replace(/^items\.0(?=\.|$)/, `items.${row}`);
        contractIssues.push({ ...issue, path });
      }
    }
  }
  const issues: ValidationIssue[] = [];
  const fieldHints: Record<string, string> = {};
  const seen = new Set<string>();
  for (const issue of [...contractIssues, ...current.issues]) {
    const key = JSON.stringify([
      issue.code,
      issue.path,
      issue.rowId,
      issue.message,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    fieldHints[issue.path] ||= issue.message;
  }
  return {
    issues,
    fieldHints,
    locallyComplete: issues.length === 0,
    // Even complete local input still needs the existing authoritative check.
    requiresServerValidation: true as const,
  };
}
