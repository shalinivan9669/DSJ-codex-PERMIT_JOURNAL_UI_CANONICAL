import type { CourseContent, RegulatoryProfile } from "@demo/contracts/src/lms";
import { fail } from "../core";

export function regulatoryEffectiveFromIssue(
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  return content.learningOutcome !== "LEARNING" &&
    profile.assessmentKind !== "PRACTICE" &&
    !profile.effectiveFrom
    ? {
        code: "POLICY_EFFECTIVE_FROM_REQUIRED",
        target: "overview" as const,
        messageRu:
          "Укажите дату «Действует с» в основании программы. Без даты начала действия результат экзамена не допускает оформление документов.",
        messageKz:
          "Бағдарлама негізіндегі «Басталуы» күнін көрсетіңіз. Күшіне ену күні болмаса, емтихан нәтижесі бойынша құжаттарды рәсімдеуге болмайды.",
      }
    : null;
}

/** Drafts may retain legal requirements; an unsupported local exam must never be offered to learners. */
export function localAssessmentIssues(
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  const issues: Array<{
    code: string;
    messageRu: string;
    messageKz: string;
    target: "overview";
  }> = [];
  if (
    content.learningOutcome === "LEARNING" ||
    profile.assessmentKind === "EXTERNAL_AUTHORIZED"
  )
    return issues;
  if (
    profile.requiresProctoring &&
    profile.proctoringMode !== "LOCAL_SUPERVISED"
  )
    issues.push({
      code: "LOCAL_PROCTORING_UNAVAILABLE",
      target: "overview",
      messageRu:
        "Выберите поддерживаемый контроль: местный экзамен под наблюдением. Назначенный наблюдатель подтвердит личность, присутствие и конкретную попытку. Иной обязательный прокторинг требует согласования маршрута; не снимайте требование ради допуска.",
      messageKz:
        "Қолжетімді бақылауды таңдаңыз: бақылаушы қатысатын жергілікті емтихан. Тағайындалған бақылаушы жеке басты, қатысуды және нақты әрекетті растайды. Басқа міндетті прокторинг үшін жолды келісу қажет; талапты алып тастамаңыз.",
    });
  if (profile.requiresPractice) {
    if (content.metadata?.format === "IN_PERSON" && profile.practiceEvidenceMode !== "IN_PERSON")
      issues.push({ code: "LOCAL_PRACTICE_MODE_REQUIRED", target: "overview", messageRu: "Для очной практики выберите подтверждение по очному занятию и критериям преподавателя.", messageKz: "Күндізгі практика үшін күндізгі сабақ және оқытушы критерийлері бойынша растауды таңдаңыз." });
    if (profile.practiceEvidenceMode === "IN_PERSON") {
      if (
        !content.modules.some((module) =>
          module.lessons.some(
            (lesson) => lesson.required && lesson.kind === "SESSION",
          ),
        )
      )
        issues.push({
          code: "LOCAL_PRACTICE_SESSION_REQUIRED",
          target: "overview",
          messageRu:
            "Добавьте обязательное занятие для очной практики. Преподаватель назначит дату, критерии и отдельно оценит результат каждого участника.",
          messageKz:
            "Күндізгі практика үшін міндетті сабақ қосыңыз. Оқытушы күн мен критерийлерді белгілеп, әр қатысушының нәтижесін бөлек бағалайды.",
        });
    } else if (profile.practiceEvidenceMode !== "REVIEWED_ASSIGNMENTS")
      issues.push({
        code: "LOCAL_PRACTICE_MODE_REQUIRED",
        target: "overview",
        messageRu:
          "Выберите основание подтверждения обязательной практики. Для поддерживаемого онлайн-маршрута используются принятые преподавателем обязательные практические работы.",
        messageKz:
          "Міндетті практиканы растау негізін таңдаңыз. Қолжетімді онлайн жол үшін оқытушы қабылдаған міндетті практикалық жұмыстар қолданылады.",
      });
    else if (
      !content.modules.some((module) =>
        module.lessons.some(
          (lesson) => lesson.required && lesson.kind === "ASSIGNMENT",
        ),
      )
    )
      issues.push({
        code: "LOCAL_PRACTICE_ASSIGNMENT_REQUIRED",
        target: "overview",
        messageRu:
          "Добавьте обязательную практическую работу: без принятой преподавателем работы нельзя подтвердить практику и допустить к итоговому экзамену.",
        messageKz:
          "Міндетті практикалық жұмысты қосыңыз: оқытушы қабылдаған жұмыссыз практиканы растауға және қорытынды емтиханға жіберуге болмайды.",
      });
  }
  return issues;
}

export function assertLocalAssessmentSupported(
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  const issue = localAssessmentIssues(content, profile)[0];
  if (issue) fail(409, issue.code, issue.messageRu);
}
