/**
 * Course content can be prepared, reviewed and versioned before admitting learners.
 * This only classifies the deployment gate: session, MFA, CSRF, tenant scope
 * and each controller's existing permissions still apply.
 *
 * Never exempt all of /lms or all GETs. Materials are deliberately excluded:
 * their shared store also contains recordings of real teaching sessions.
 */
export function isLmsContentPreparationRequest(
  method: string,
  path: string,
  actor: { role: string; teachingMode?: boolean },
): boolean {
  const staff = [
    "SUPER_ADMIN",
    "ADMIN",
    "DIRECTOR",
    "METHODIST",
    "TEACHER",
    "EXPERT",
  ].includes(actor.role);
  // authenticate derives teachingMode from a live binding, never request input.
  const delegatedTeacher =
    actor.teachingMode === true && ["LEARNER", "VIEWER"].includes(actor.role);
  if (!staff && !delegatedTeacher) return false;
  if (method === "GET")
    return (
      [
        "/lms/courses",
        "/lms/course-options",
        "/lms/questions",
        "/lms/regulatory",
        "/lms/regulatory-sources",
      ].includes(path) ||
      /^\/lms\/courses\/[A-Za-z0-9_-]+$/.test(path) ||
      /^\/lms\/questions\/[A-Za-z0-9_-]+\/revisions$/.test(path)
    );
  if (method === "POST")
    return (
      ["/lms/courses", "/lms/questions", "/lms/questions/import"].includes(
        path,
      ) ||
      /^\/lms\/courses\/[A-Za-z0-9_-]+\/versions$/.test(path) ||
      /^\/lms\/questions\/[A-Za-z0-9_-]+\/revisions$/.test(path) ||
      /^\/lms\/course-versions\/[A-Za-z0-9_-]+\/(?:review|publish)$/.test(path)
    );
  return (
    method === "PUT" && /^\/lms\/course-versions\/[A-Za-z0-9_-]+$/.test(path)
  );
}
