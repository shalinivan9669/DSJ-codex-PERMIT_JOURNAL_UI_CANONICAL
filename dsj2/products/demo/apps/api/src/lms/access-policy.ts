import {
  accessPolicySchema,
  type AccessPolicy,
  type CourseContent,
} from "@demo/contracts/src/lms";
import { addZonedDays } from "@demo/contracts/src/lms/time";
import { fail } from "../core";

export function validateAccessPolicy(policy: AccessPolicy) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: policy.timezone }).format();
  } catch {
    fail(400, "TIMEZONE_INVALID", "Выберите часовой пояс IANA");
  }
  if (policy.mode === "DAYS" && !policy.days)
    fail(400, "ACCESS_DAYS_REQUIRED", "Укажите число дней доступа");
  if (policy.mode === "FIXED" && (!policy.startsAt || !policy.endsAt))
    fail(400, "ACCESS_PERIOD_REQUIRED", "Укажите начало и окончание периода");
  if (
    policy.startsAt &&
    policy.endsAt &&
    new Date(policy.endsAt) <= new Date(policy.startsAt)
  )
    fail(
      400,
      "ACCESS_PERIOD_INVALID",
      "Окончание доступа должно быть позже начала",
    );
}
export function resolveAccessPolicy(
  content: CourseContent,
  assignedAt: Date,
  override?: AccessPolicy,
  legacyDueAt?: string | null,
) {
  const policy = accessPolicySchema.parse(
    override ||
      content.accessPolicy || {
        mode: "DAYS",
        days: content.accessDays,
        timezone: "Asia/Qyzylorda",
      },
  );
  validateAccessPolicy(policy);
  const startsAt = policy.startsAt ? new Date(policy.startsAt) : null;
  const anchor = startsAt && startsAt > assignedAt ? startsAt : assignedAt;
  const dueAt =
    legacyDueAt !== undefined
      ? legacyDueAt
        ? new Date(legacyDueAt)
        : null
      : policy.mode === "UNLIMITED"
        ? null
        : policy.mode === "FIXED"
          ? new Date(policy.endsAt!)
          : addZonedDays(anchor, policy.days!, policy.timezone);
  if (startsAt && dueAt && dueAt <= startsAt)
    fail(
      400,
      "ACCESS_PERIOD_INVALID",
      "Окончание доступа должно быть позже начала",
    );
  return { startsAt, dueAt, policy };
}
