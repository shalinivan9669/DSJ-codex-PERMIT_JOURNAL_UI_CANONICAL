export type Capability =
  | "session"
  | "printing:read"
  | "printing:write"
  | "center:manage"
  | "lms:manage"
  | "lms:assign"
  | "lms:learn"
  | "lms:catalog"
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
  ADMIN: [...staff, "center:manage"],
  DIRECTOR: [...staff, "center:manage"],
  OPERATOR: staff,
  VIEWER: ["session", "printing:read", "lms:catalog"],
  EMPLOYER: ["session", "printing:read", "lms:assign", "lms:catalog"],
  LEARNER: ["session", "lms:learn", "lms:catalog"],
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
      /^\/lms\/(courses|materials)\/[A-Za-z0-9_-]+$/.test(path)
    );
  if (role === "EMPLOYER")
    return (
      /^\/lms\/documents\/bundles\/[A-Za-z0-9_-]+(?:\/parts\/[0-9]+)?$/.test(
        path,
      ) ||
      path === "/portal" ||
      path.startsWith("/portal/") ||
      [
        "/lms/courses",
        "/lms/enrollments",
        "/lms/assignment-context",
        "/lms/results/export",
        "/lms/results/filters",
        "/lms/documents/bundle",
      ].includes(path) ||
      /^\/lms\/(courses|enrollments|groups|documents|artifacts)\/[A-Za-z0-9_-]+$/.test(
        path,
      )
    );
  return true;
}
