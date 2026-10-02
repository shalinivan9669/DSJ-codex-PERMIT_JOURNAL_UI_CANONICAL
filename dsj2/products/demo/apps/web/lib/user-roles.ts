import { isDirectorRole, type Role } from "@demo/contracts";

/** Legacy accounts keep their stored role unless the director explicitly changes it. */
export function userRoleForEditor(role?: Role): Role {
  return role && isDirectorRole(role) ? "DIRECTOR" : role || "OPERATOR";
}

export function userRoleOptions(existingRole?: Role): Role[] {
  const roles: Role[] = ["OPERATOR", "DIRECTOR"];
  if (existingRole === "VIEWER" || existingRole === "EMPLOYER")
    roles.push(existingRole);
  return roles;
}

export function userRoleUpdate(existingRole: Role | undefined, selected: Role) {
  return existingRole && userRoleForEditor(existingRole) === selected
    ? {}
    : { role: selected };
}

export function workspaceStartPath(role: Role, registering = false): string {
  if (role === "EMPLOYER") return "/portal";
  if (registering) return isDirectorRole(role) ? "/onboarding" : "/requests";
  return isDirectorRole(role) ? "/approvals" : "/requests";
}
