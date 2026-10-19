import { teachingBindingPermissionSql } from "./learning-permissions";
import { Prisma, type Enrollment, type RegulatoryReview } from "@demo/database";

export type NotificationKind =
  | "ENROLLED"
  | "ASSIGNED"
  | "STARTED"
  | "TEST_AVAILABLE"
  | "RESULT"
  | "DOCUMENT_READY"
  | "ACCESS_EXPIRING"
  | "ACCESS_EXPIRED";
export const notificationTitles: Record<NotificationKind, [string, string]> = {
  ENROLLED: [
    "Заявка принята: обучение доступно",
    "Өтінім қабылданды: оқу қолжетімді",
  ],
  ASSIGNED: ["Вам назначено обучение", "Сізге оқу тағайындалды"],
  STARTED: ["Обучение началось", "Оқу басталды"],
  TEST_AVAILABLE: ["Итоговый тест доступен", "Қорытынды тест қолжетімді"],
  RESULT: ["Результат обучения готов", "Оқу нәтижесі дайын"],
  DOCUMENT_READY: ["Документ готов к скачиванию", "Құжат жүктеп алуға дайын"],
  ACCESS_EXPIRING: [
    "Срок доступа к обучению заканчивается",
    "Оқуға қол жеткізу мерзімі аяқталуға жақын",
  ],
  ACCESS_EXPIRED: [
    "Срок доступа к обучению завершён",
    "Оқуға қол жеткізу мерзімі аяқталды",
  ],
};

/** Regulatory changes target only administrators and current course authors, never the learner roster. */
export async function enqueueRegulatoryNotification(
  tx: Prisma.TransactionClient,
  review: Pick<RegulatoryReview, "id" | "tenantId" | "courseId" | "status" | "updatedAt">,
) {
  if (review.status === "CURRENT") return 0;
  const key = `REGULATORY:${review.id}:${review.updatedAt.toISOString()}`;
  const href = `/lms/courses/${encodeURIComponent(review.courseId)}?section=overview`;
  return tx.$executeRaw(Prisma.sql`INSERT INTO "LmsNotificationEvent" (id,"tenantId","userId","sourceType","sourceId",kind,"deliveryKey","titleRu","titleKz",href)
    SELECT gen_random_uuid()::text,c."tenantId",u.id,'REGULATORY',${review.id},'REGULATORY_REVIEW_REQUIRED',${key},
      'Требуется актуализация учебной программы: '||c."titleRu",
      'Оқу бағдарламасын жаңарту қажет: '||COALESCE(NULLIF(c."titleKz",''),c."titleRu"),${href}
    FROM "Course" c JOIN "User" u ON u."tenantId"=c."tenantId" AND u.active
    WHERE c."tenantId"=${review.tenantId} AND c.id=${review.courseId} AND NOT c.archived
      AND (u.role IN ('ADMIN','SUPER_ADMIN') OR EXISTS (
        SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=c."tenantId" AND b."courseId"=c.id AND b."userId"=u.id
          AND b.role='METHODIST' AND b."groupId" IS NULL AND b."revokedAt" IS NULL AND b.permissions @> '["READ","EDIT"]'::jsonb))
    ON CONFLICT ("tenantId","userId","deliveryKey") DO NOTHING`);
}
/** Transactional internal outbox; the same fact never produces enrollment+assignment duplicates. */
export async function enqueueEnrollmentNotification(
  tx: Prisma.TransactionClient,
  enrollment: Pick<Enrollment, "id" | "tenantId">,
  kind: NotificationKind,
  options: {
    sourceType?: string;
    sourceId?: string;
    key?: string;
    titleRu?: string;
    titleKz?: string;
  } = {},
) {
  const titles = notificationTitles[kind],
    sourceType = options.sourceType || "ENROLLMENT",
    sourceId = options.sourceId || enrollment.id;
  const key = options.key || `${kind}:${sourceId}`;
  return tx.$executeRaw(Prisma.sql`INSERT INTO "LmsNotificationEvent" (id,"tenantId","userId","sourceType","sourceId","enrollmentId",kind,"deliveryKey","titleRu","titleKz",href)
    SELECT gen_random_uuid()::text,n."tenantId",r."userId",${sourceType},${sourceId},n.id,${kind},${key},${options.titleRu || titles[0]},${options.titleKz || titles[1]},CASE WHEN r.role='LEARNER' THEN '/learn/'||n.id ELSE '/lms/results?enrollmentId='||n.id END
    FROM "Enrollment" n CROSS JOIN LATERAL (
      SELECT p."userId",'LEARNER' AS role FROM "LearnerProfile" p JOIN "User" u ON u.id=p."userId" AND u."tenantId"=p."tenantId" AND u.active WHERE p."tenantId"=n."tenantId" AND p."recipientId"=n."recipientId"
      UNION SELECT m."userId",'EMPLOYER' AS role FROM "EmployerMembership" m JOIN "User" u ON u.id=m."userId" AND u."tenantId"=m."tenantId" AND u.active AND u.role='EMPLOYER' WHERE m."tenantId"=n."tenantId" AND m."customerId"=n."customerId" AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AND m.permissions @> '["READ"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(n."recipientId"))
    ) r WHERE n.id=${enrollment.id} AND n."tenantId"=${enrollment.tenantId} AND n.status<>'CANCELLED'
    ON CONFLICT ("tenantId","userId","deliveryKey") DO NOTHING`);
}

/** A review enters the existing internal queue only for current reviewers of this assignment. */
export async function enqueueReviewNotification(
  tx: Prisma.TransactionClient,
  enrollment: Pick<Enrollment, "id" | "tenantId">,
  target: { type: "SUBMISSION" | "ATTEMPT"; id: string; revision: number },
) {
  const sourceType = `REVIEW_${target.type}`;
  const deliveryKey = `REVIEW:${target.type}:${target.id}:${target.revision}`;
  const href = `/lms/teaching?type=${target.type}&reviewId=${encodeURIComponent(target.id)}`;
  return tx.$executeRaw(Prisma.sql`INSERT INTO "LmsNotificationEvent" (id,"tenantId","userId","sourceType","sourceId","enrollmentId",kind,"deliveryKey","titleRu","titleKz",href)
    SELECT gen_random_uuid()::text,n."tenantId",u.id,${sourceType},${target.id},n.id,'REVIEW_REQUESTED',${deliveryKey},
      'Работа ожидает проверки: '||COALESCE(rec.data->>'fullNameRu',''),
      'Жұмыс тексеруді күтуде: '||COALESCE(NULLIF(rec.data->>'fullNameKz',''),rec.data->>'fullNameRu',''),${href}
    FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId"
    JOIN "Recipient" rec ON rec."tenantId"=n."tenantId" AND rec.id=n."recipientId"
    JOIN "User" u ON u."tenantId"=n."tenantId" AND u.active
    WHERE n."tenantId"=${enrollment.tenantId} AND n.id=${enrollment.id} AND n.status<>'CANCELLED'
      AND (u.role IN ('SUPER_ADMIN','ADMIN','DIRECTOR') OR EXISTS (
        SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=n."tenantId" AND b."userId"=u.id AND b."courseId"=v."courseId"
          AND b."revokedAt" IS NULL AND b.permissions @> '["READ"]'::jsonb AND ${teachingBindingPermissionSql("REVIEW")}
          AND (b."groupId" IS NULL OR (b."groupId"=n."groupId" AND EXISTS (SELECT 1 FROM "LmsGroupMember" gm WHERE gm."tenantId"=n."tenantId" AND gm."groupId"=b."groupId" AND gm."enrollmentId"=n.id AND gm."excludedAt" IS NULL)))))
      AND NOT EXISTS (SELECT 1 FROM "LearnerProfile" self WHERE self."tenantId"=n."tenantId" AND self."userId"=u.id AND self."recipientId"=n."recipientId")
    ON CONFLICT ("tenantId","userId","deliveryKey") DO NOTHING`);
}
