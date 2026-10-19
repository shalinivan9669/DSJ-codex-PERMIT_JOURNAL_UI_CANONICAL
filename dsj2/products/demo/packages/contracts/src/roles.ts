/** Existing director/signatory workflows retain their historical ADMIN access. */
export function isDirectorRole(role: string): boolean {
  return role === "DIRECTOR" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export const canManageCenter = isDirectorRole;
export const canManageUsers = canManageCenter;
export const canManageLearning = canManageCenter;
export const isLmsStaffRole = (role: string): boolean =>
  canManageLearning(role) || role === "OPERATOR";
export const canAuthorPrograms = (role: string): boolean =>
  canManageLearning(role) || role === "METHODIST";
export const canManageSystem = (role: string): boolean =>
  role === "SUPER_ADMIN" || role === "DIRECTOR";

export function roleLabel(role: string): string {
  return (
    {
      SUPER_ADMIN: "Суперадминистратор",
      ADMIN: "Администратор",
      DIRECTOR: "Директор",
      OPERATOR: "Оператор",
      VIEWER: "Просмотр",
      EMPLOYER: "Представитель заказчика",
      LEARNER: "Слушатель",
      TEACHER: "Преподаватель",
      METHODIST: "Методист",
      EXPERT: "Эксперт / член комиссии",
    }[role] || role
  );
}
