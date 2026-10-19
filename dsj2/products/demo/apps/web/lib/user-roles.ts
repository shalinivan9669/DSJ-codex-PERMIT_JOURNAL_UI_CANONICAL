import { type Role } from "@demo/contracts";

export function userRoleForEditor(role?: Role): Role {
  return role || "OPERATOR";
}

export function userRoleOptions(existingRole?: Role, actorRole?: Role): Role[] {
  const roles: Role[] = ["OPERATOR", "TEACHER", "METHODIST", "EXPERT", "VIEWER"];
  if (actorRole === "SUPER_ADMIN") roles.push("ADMIN", "SUPER_ADMIN", "DIRECTOR");
  if (existingRole && !roles.includes(existingRole)) roles.push(existingRole);
  return roles;
}

export function userRoleUpdate(existingRole: Role | undefined, selected: Role) {
  return existingRole === selected ? {} : { role: selected };
}

export function workspaceStartPath(role: Role, registering = false): string {
  if (registering && ["SUPER_ADMIN", "DIRECTOR"].includes(role)) return "/onboarding";
  if (role === "METHODIST") return "/lms";
  if (role === "TEACHER" || role === "EXPERT") return "/lms/teaching";
  if (role === "LEARNER") return "/learn";
  if (role === "EMPLOYER") return "/portal";
  if (["ADMIN", "SUPER_ADMIN", "OPERATOR"].includes(role)) return "/lms/workplace";
  if (role === "DIRECTOR") return registering ? "/onboarding" : "/approvals";
  return "/requests";
}
