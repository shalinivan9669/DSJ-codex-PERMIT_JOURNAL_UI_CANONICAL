import { z } from "@demo/contracts";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import { listEnrollmentPage } from "./enrollment-list";
import { learningCalendar } from "./calendar";
import { isLmsStaff } from "./scope";
import { listEmployerImports } from "./employer-import";
import { applicationScope } from "./applications";

const preferencesSchema = z
  .object({
    language: z.enum(["ru", "kz"]).optional(),
    showUnreadBadge: z.boolean().optional(),
  })
  .strict();
export async function ownLmsProfile(c: Context) {
  const user = await db.user.findFirst({
    where: { tenantId: c.tenantId, id: c.userId, active: true },
    select: {
      displayName: true,
      email: true,
      lmsPreferences: true,
      role: true,
    },
  });
  if (!user) fail(404, "NOT_FOUND", "Профиль не найден");
  const learner = await db.learnerProfile.findFirst({
    where: { tenantId: c.tenantId, userId: c.userId },
    select: { recipientId: true },
  });
  const recipient = learner
    ? await db.recipient.findFirst({
        where: { tenantId: c.tenantId, id: learner.recipientId },
        select: { data: true },
      })
    : null;
  const data = recipient?.data as
    | { fullNameRu?: string; phone?: string; iin?: string }
    | undefined;
  const preferences = preferencesSchema.parse(user.lmsPreferences);
  return {
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    fullNameRu: data?.fullNameRu || null,
    phone: data?.phone || null,
    preferences,
    revision: hash({ displayName: user.displayName, preferences }),
  };
}
export async function saveOwnLmsProfile(c: Context, raw: unknown) {
  const data = parse(
    z
      .object({
        revision: z.string().length(64),
        displayName: z.string().trim().min(2).max(300),
        preferences: preferencesSchema,
      })
      .strict(),
    raw,
  );
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "User" WHERE id=${c.userId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const current = await tx.user.findFirst({
      where: { id: c.userId, tenantId: c.tenantId, active: true },
      select: { displayName: true, lmsPreferences: true },
    });
    if (!current) fail(404, "NOT_FOUND", "Профиль не найден");
    const preferences = preferencesSchema.parse(current.lmsPreferences);
    if (
      hash({ displayName: current.displayName, preferences }) !== data.revision
    )
      fail(
        409,
        "REVISION_CONFLICT",
        "Настройки изменены в другом окне. Ваш ввод сохранён",
      );
    await tx.user.update({
      where: { id: c.userId },
      data: {
        displayName: data.displayName,
        lmsPreferences: json(data.preferences),
      },
    });
    await audit(tx, c, "LMS_PROFILE_PREFERENCES_UPDATED", c.userId, {
      displayNameChanged: current.displayName !== data.displayName,
      before: preferences,
      after: data.preferences,
    });
  });
  return ownLmsProfile(c);
}
export async function lmsWorkplace(c: Context) {
  const staff = isLmsStaff(c) && !c.learningMode;
  const employer = c.role === "EMPLOYER";
  const applicationsScope =
    staff || employer || c.role === "LEARNER"
      ? await applicationScope(c)
      : { tenantId: c.tenantId, id: "unavailable" };
  const now = new Date(),
    to = new Date(now.getTime() + 30 * 86400000);
  const [enrollments, calendar, applications, imports] = await Promise.all([
    listEnrollmentPage(c, { page: 1, pageSize: 10 }),
    learningCalendar(c, {
      from: now.toISOString(),
      to: to.toISOString(),
      pageSize: 5,
    }),
    db.lmsApplication.findMany({
      where: {
        ...applicationsScope,
        ...(staff ? { OR: [
          { state: { in: ["NEW", "PROCESSING", "RETURNED"] } },
          { state: "ACCEPTED", kind: "B2B" },
          { state: "ACCEPTED", enrollmentId: null },
        ] } : {}),
      },
      select: {
        id: true,
        state: true,
        reason: true,
        enrollmentId: true,
        createdAt: true,
        courseVersionId: true,
        contact: true,
        quantity: true,
        orderId: true,
      },
      take: 5,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    }),
    staff || employer
      ? listEmployerImports(c).then((rows) =>
          rows
            .filter((row) => !["COMPLETED", "CANCELLED"].includes(row.state))
            .slice(0, 5),
        )
      : [],
  ]);
  const tenant = await db.tenant.findFirstOrThrow({
    where: { id: c.tenantId },
    select: { timezone: true },
  });
  const versions = await db.courseVersion.findMany({
    where: { tenantId: c.tenantId, id: { in: applications.map((item) => item.courseVersionId) } },
    select: { id: true, content: true },
  });
  const courses = new Map(versions.map((version) => [version.id, version.content as { titleRu?: string; titleKz?: string }]));
  return {
    enrollments,
    calendar,
    applications: applications.map(({ contact, courseVersionId, ...item }) => {
      const details = contact as { contactName?: string; organization?: string };
      return {
        ...item,
        name: details.organization || details.contactName || "",
        titleRu: courses.get(courseVersionId)?.titleRu || "",
        titleKz: courses.get(courseVersionId)?.titleKz || "",
      };
    }),
    imports,
    timezone: tenant.timezone,
  };
}
