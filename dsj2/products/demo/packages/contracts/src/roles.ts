/** ADMIN remains an equivalent legacy director value; stored accounts are not rewritten. */
export function isDirectorRole(role: string): boolean {
  return role === "DIRECTOR" || role === "ADMIN";
}

export const canManageCenter = isDirectorRole;

export function roleLabel(role: string): string {
  if (isDirectorRole(role)) return "Директор";
  return (
    {
      OPERATOR: "Менеджер",
      VIEWER: "Просмотр",
      EMPLOYER: "Представитель заказчика",
    }[role] || role
  );
}
