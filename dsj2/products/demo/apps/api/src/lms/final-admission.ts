import type { Enrollment, Prisma } from "@demo/database";
import type { CourseContent, RegulatoryProfile } from "@demo/contracts/src/lms";
import { today } from "@demo/contracts";
import { fail, type Context } from "../core";
import { evaluateLearningEligibility } from "./learning-eligibility";
import { evaluatePracticeRequirement } from "./practice-requirement";
import { proctorAdmission } from "./proctoring";

/** One admission rule for starting the final attempt and notifying about access. */
export async function assertFinalAdmission(
  tx: Prisma.TransactionClient,
  c: Context,
  enrollment: Enrollment,
  content: CourseContent,
  profile: RegulatoryProfile,
  evaluation?: Awaited<ReturnType<typeof evaluateLearningEligibility>>,
) {
  const eligibility =
    evaluation ||
    (await evaluateLearningEligibility(tx, c, enrollment, content));
  if (!eligibility.finalAllowed)
    fail(409, "LESSONS_REQUIRED", "Завершите обязательные элементы обучения", {
      reasons: eligibility.blockingReasons,
    });
  if (content.exam.dueAt && new Date(content.exam.dueAt) <= new Date())
    fail(409, "ASSESSMENT_EXPIRED", "Срок итоговой проверки завершён. Обратитесь в учебный центр");
  if (content.learningOutcome !== "LEARNING") {
    if (profile.assessmentKind === "EXTERNAL_AUTHORIZED")
      fail(
        409,
        "WAITING_EXTERNAL",
        "Для программы требуется результат внешнего экзамена",
      );
    if (
      profile.assessmentKind === "CENTER_EXAM" &&
      (profile.status !== "CONFIRMED" || profile.competency === "GENERAL")
    )
      fail(
        409,
        "ROUTE_REVIEW_REQUIRED",
        "Маршрут экзамена требует проверки учебным центром",
      );
    const practice = await evaluatePracticeRequirement(
      tx,
      c,
      enrollment,
      content,
      profile,
    );
    const proctoringSatisfied = !profile.requiresProctoring || (profile.proctoringMode === "LOCAL_SUPERVISED" && await proctorAdmission(tx, c, enrollment.id));
    if (!proctoringSatisfied || !practice.satisfied)
      fail(
        409,
        "ASSESSMENT_REQUIREMENT",
        !proctoringSatisfied ? "Назначенный наблюдатель должен подтвердить вашу личность и присутствие в действующей сессии экзамена" : "Завершите обязательную практику и получите решение преподавателя",
        {
          reason: !proctoringSatisfied
            ? "PROCTORING_REQUIRED"
            : practice.reason,
        },
      );
    let day: string;
    try {
      new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
      day = today(profile.timezone);
    } catch {
      fail(
        409,
        "ROUTE_REVIEW_REQUIRED",
        "Часовой пояс программы требует проверки",
      );
    }
    if (
      profile.assessmentKind === "CENTER_EXAM" &&
      ((profile.effectiveFrom && day < profile.effectiveFrom) ||
        (profile.effectiveUntil && day > profile.effectiveUntil))
    )
      fail(409, "ROUTE_EXPIRED", "Срок действия маршрута требует проверки");
  }
}
