export type Capability =
  | "session"
  | "printing:read"
  | "printing:write"
  | "center:manage"
  | "users:manage"
  | "system:manage"
  | "lms:author"
  | "lms:manage"
  | "lms:assign"
  | "lms:learn"
  | "lms:catalog"
  | "lms:teach"
  | "regulatory:manage";
const staff: Capability[] = [
  "session",
  "printing:read",
  "printing:write",
  "lms:manage",
  "lms:assign",
  "lms:catalog",
  "regulatory:manage",
];
const capabilities: Record<string, readonly Capability[]> = {
  SUPER_ADMIN: [
    ...staff,
    "center:manage",
    "users:manage",
    "system:manage",
    "lms:author",
  ],
  ADMIN: [...staff, "center:manage", "users:manage", "lms:author"],
  DIRECTOR: [
    ...staff,
    "center:manage",
    "users:manage",
    "system:manage",
    "lms:author",
  ],
  OPERATOR: staff,
  VIEWER: ["session", "printing:read", "lms:catalog"],
  EMPLOYER: ["session", "printing:read", "lms:assign", "lms:catalog"],
  LEARNER: ["session", "lms:learn", "lms:catalog"],
  TEACHER: ["session", "lms:teach", "lms:catalog"],
  METHODIST: ["session", "lms:teach", "lms:catalog", "lms:author"],
  EXPERT: ["session", "lms:teach", "lms:catalog"],
};
export function hasCapability(role: string, capability: Capability): boolean {
  return (
    Object.hasOwn(capabilities, role) && capabilities[role].includes(capability)
  );
}
export function knownRole(role: string): boolean {
  return Object.hasOwn(capabilities, role);
}

/** Defence in depth before any legacy controller handles a newly introduced role. */
export function roleRouteAllowed(role: string, path: string): boolean {
  if (!knownRole(role)) return false;
  if (role === "SUPER_ADMIN") return true;
  if (/^\/employer-access-requests(?:\/[A-Za-z0-9_-]+\/resolve)?$/.test(path))
    return ["ADMIN", "DIRECTOR", "EMPLOYER"].includes(role);
  if (
    role === "VIEWER" &&
    ["/lms/reports/query", "/lms/reports/filters"].includes(path)
  )
    return true;
  if (path === "/lms/regulatory")
    return hasCapability(role, "lms:author") || role === "EXPERT";
  if (
    /^\/lms\/regulatory-(?:sources(?:\/[A-Za-z0-9_-]+\/revisions)?|tasks(?:\/[A-Za-z0-9_-]+)?)$/.test(
      path,
    )
  )
    return ["ADMIN", "DIRECTOR", "METHODIST", "EXPERT"].includes(role);
  if (path === "/lms/questions/import")
    return ["ADMIN", "DIRECTOR", "METHODIST"].includes(role);
  if (path === "/lms/proctoring")
    return ["ADMIN", "DIRECTOR", "TEACHER", "EXPERT"].includes(role);
  if (/^\/lms\/enrollments\/[A-Za-z0-9_-]+\/proctoring$/.test(path))
    return [
      "ADMIN",
      "DIRECTOR",
      "TEACHER",
      "EXPERT",
      "LEARNER",
      "EMPLOYER",
    ].includes(role);
  if (
    /^\/lms\/(?:groups\/[A-Za-z0-9_-]+\/recordings|teaching-events\/[A-Za-z0-9_-]+\/practice)$/.test(
      path,
    )
  )
    return [
      "ADMIN",
      "DIRECTOR",
      "TEACHER",
      "METHODIST",
      "EXPERT",
      "OPERATOR",
    ].includes(role);
  if (path.startsWith("/auth/mfa/")) return true;
  if (path === "/lms/catalogue") return true;
  if (
    /^\/lms\/(workplace|profile|notifications(?:\/(?:read-all|[A-Za-z0-9_-]+\/read))?)$/.test(
      path,
    )
  )
    return true;
  if (/^\/lms\/applications(?:\/[A-Za-z0-9_-]+(?:\/(?:action|order))?)?$/.test(path))
    return ["ADMIN", "DIRECTOR", "OPERATOR", "EMPLOYER", "LEARNER"].includes(
      role,
    );
  if (
    /^\/lms\/employer-import(?:\/[A-Za-z0-9_-]+(?:\/(?:confirm|action))?)?$/.test(
      path,
    )
  )
    return ["ADMIN", "DIRECTOR", "OPERATOR", "EMPLOYER"].includes(role);
  if (
    /^\/lms\/reports(?:\/[A-Za-z0-9_-]+(?:\/(?:retry|cancel|file))?)?$/.test(
      path,
    )
  )
    return [
      "ADMIN",
      "DIRECTOR",
      "OPERATOR",
      "EMPLOYER",
      "TEACHER",
      "METHODIST",
      "EXPERT",
    ].includes(role);
  if (
    ["/auth/session", "/auth/logout", "/auth/password", "/context"].includes(
      path,
    )
  )
    return true;
  if (role === "LEARNER")
    return (
      path === "/learn" ||
      path.startsWith("/learn/") ||
      path === "/lms/courses" ||
      /^\/lms\/(courses|materials)\/[A-Za-z0-9_-]+$/.test(path) ||
      /^\/lms\/enrollments\/[A-Za-z0-9_-]+\/(assessments(?:\/[A-Za-z0-9_-]+\/attempts)?|assignments\/[A-Za-z0-9_-]+\/(submission(?:\/submit)?|attachments))$/.test(
        path,
      ) ||
      /^\/lms\/submission-attachments\/[A-Za-z0-9_-]+\/download$/.test(path) ||
      /^\/lms\/(calendar|notifications(?:\/[A-Za-z0-9_-]+\/read)?|teaching-events(?:\/[A-Za-z0-9_-]+(?:\/attendance)?)?)$/.test(
        path,
      )
    );
  if (role === "EMPLOYER")
    return (
      /^\/lms\/documents\/bundles\/[A-Za-z0-9_-]+(?:\/parts\/[0-9]+)?$/.test(
        path,
      ) ||
      /^\/lms\/teaching-events\/[A-Za-z0-9_-]+$/.test(path) ||
      path === "/portal" ||
      path.startsWith("/portal/") ||
      [
        "/lms/courses",
        "/lms/enrollments",
        "/lms/assignment-context",
        "/lms/results/export",
        "/lms/results/filters",
        "/lms/documents/bundle",
        "/lms/calendar",
        "/lms/groups",
        "/lms/teaching-events",
      ].includes(path) ||
      /^\/lms\/(courses|enrollments|groups|documents|artifacts)\/[A-Za-z0-9_-]+$/.test(
        path,
      )
    );
  if (["TEACHER", "METHODIST", "EXPERT"].includes(role))
    return (
      roleRouteAllowed("LEARNER", path) ||
      [
        "/lms/results",
        "/lms/results/filters",
        "/lms/results/export",
        "/lms/documents/bundle",
      ].includes(path) ||
      /^\/lms\/documents\/bundles\/[A-Za-z0-9_-]+(?:\/parts\/[0-9]+)?$/.test(
        path,
      ) ||
      /^\/lms\/(documents|artifacts)\/[A-Za-z0-9_-]+$/.test(path) ||
      /^\/lms\/commission(?:\/[A-Za-z0-9_-]+(?:\/(?:confirm|signing|signatures|artifacts\/[A-Za-z0-9_-]+))?)?$/.test(
        path,
      ) ||
      /^\/lms\/(courses(?:\/[A-Za-z0-9_-]+(?:\/(?:versions|materials|pause|archive))?)?|course-versions\/[A-Za-z0-9_-]+(?:\/(?:publish|review))?|questions(?:\/[A-Za-z0-9_-]+(?:\/revisions)?)?|question-library(?:\/[A-Za-z0-9_-]+(?:\/revisions)?)?|material-library|materials\/[A-Za-z0-9_-]+(?:\/(?:bind|state))?|groups(?:\/[A-Za-z0-9_-]+)?|enrollments(?:\/[A-Za-z0-9_-]+)?|reviews(?:\/(?:ATTEMPT|SUBMISSION)\/[A-Za-z0-9_-]+(?:\/decision)?)?|submission-attachments\/[A-Za-z0-9_-]+\/download|teaching-events(?:\/[A-Za-z0-9_-]+(?:\/(?:cancel|attendance))?)?|calendar|notifications(?:\/[A-Za-z0-9_-]+\/read)?|learning-bindings(?:\/[A-Za-z0-9_-]+\/revoke)?|teaching-context)$/.test(
        path,
      )
    );
  return true;
}
