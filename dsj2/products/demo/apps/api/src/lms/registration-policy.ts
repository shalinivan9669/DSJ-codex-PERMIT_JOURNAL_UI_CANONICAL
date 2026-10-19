import { canManageCenter, z } from "@demo/contracts";
import { audit, db, fail, parse, transaction, type Context } from "../core";
import { assertLmsDeploymentAllowed } from "./deployment-gate";

export function registrationIsOpen(tenant: {id: string; active: boolean; learnerRegistrationEnabled: boolean | null}) {
  return tenant.active && (tenant.learnerRegistrationEnabled ?? tenant.id === process.env.DEMO_LMS_REGISTRATION_TENANT_ID);
}
export async function availableRegistrationCenters() {
  const configuredId = process.env.DEMO_LMS_REGISTRATION_TENANT_ID || "";
  const tenants = await db.tenant.findMany({
    where: { active: true, OR: [{ learnerRegistrationEnabled: true }, { id: configuredId, learnerRegistrationEnabled: null }] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const centers: { key: string; name: string }[] = [];
  for (const tenant of tenants) {
    try { await assertLmsDeploymentAllowed(tenant); }
    catch (error) {
      if (error && typeof error === "object" && "getStatus" in error && typeof error.getStatus === "function" && error.getStatus() === 503) continue;
      throw error;
    }
    centers.push({ key: tenant.id, name: tenant.name });
  }
  return { enabled: centers.length > 0, centers };
}
export async function registrationTenant(centerKey?: string) {
  const choices = await availableRegistrationCenters();
  const key = centerKey || (choices.centers.length === 1 ? choices.centers[0].key : undefined);
  if (!key || !choices.centers.some((center) => center.key === key))
    fail(409, choices.enabled ? "REGISTRATION_CENTER_REQUIRED" : "REGISTRATION_CLOSED", choices.enabled ? "Выберите учебный центр" : "Регистрация закрыта. Используйте приглашение центра");
  return db.tenant.findUniqueOrThrow({ where: { id: key } });
}
export async function getRegistrationPolicy(c: Context) {
  if (!canManageCenter(c.role)) fail(403, "ROLE_DENIED", "Недостаточно прав");
  const tenant = await db.tenant.findUniqueOrThrow({where: {id: c.tenantId}});
  return { enabled: registrationIsOpen(tenant) };
}
export async function saveRegistrationPolicy(c: Context, input: unknown) {
  const { enabled } = parse(z.object({enabled: z.boolean()}).strict(), input);
  if (!canManageCenter(c.role)) fail(403, "ROLE_DENIED", "Недостаточно прав");
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${c.tenantId} FOR UPDATE`;
    const actor = await tx.user.findFirst({where: {id: c.userId, tenantId: c.tenantId, active: true}});
    if (!actor || actor.role !== c.role || !canManageCenter(actor.role)) fail(403, "ROLE_DENIED", "Полномочия изменились. Войдите заново");
    const tenant = await tx.tenant.findUniqueOrThrow({where: {id: c.tenantId}});
    if (enabled) await assertLmsDeploymentAllowed(tenant);
    await tx.tenant.update({where: {id: c.tenantId}, data: {learnerRegistrationEnabled: enabled}});
    await audit(tx, c, "LMS_REGISTRATION_POLICY_CHANGED", c.tenantId, {before: {enabled: registrationIsOpen(tenant)}, after: {enabled}});
    return {enabled};
  });
}
