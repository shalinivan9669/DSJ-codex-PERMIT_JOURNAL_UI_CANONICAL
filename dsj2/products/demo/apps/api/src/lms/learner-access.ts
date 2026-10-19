import { z } from "@demo/contracts";
import { db, parse, type Context } from "../core";
import { assertLmsStaff } from "./scope";

/** A bounded batch for the visible roster; no credentials or invitation tokens are returned. */
export async function learnerAccess(c: Context, input: unknown) {
  assertLmsStaff(c);
  const { recipientIds, customerId } = parse(z.object({
    recipientIds: z.array(z.string().uuid()).min(1).max(250),
    customerId: z.string().uuid().optional(),
  }).strict(), input);
  const ids = [...new Set(recipientIds)];
  const [recipients, profiles, invitations, enrollments, employments] = await Promise.all([
    db.recipient.findMany({ where: { tenantId: c.tenantId, id: { in: ids }, archived: false } }),
    db.learnerProfile.findMany({ where: { tenantId: c.tenantId, recipientId: { in: ids } } }),
    db.learnerInvite.findMany({ where: { tenantId: c.tenantId, recipientId: { in: ids }, usedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.enrollment.findMany({ where: { tenantId: c.tenantId, recipientId: { in: ids }, ...(customerId ? { customerId } : {}), status: { not: "CANCELLED" } }, select: { recipientId: true, startsAt: true, dueAt: true } }),
    customerId ? db.recipientEmployment.findMany({ where: { tenantId: c.tenantId, recipientId: { in: ids }, employerId: customerId }, select: { recipientId: true } }) : Promise.resolve(null),
  ]);
  const users = await db.user.findMany({ where: { tenantId: c.tenantId, id: { in: profiles.map(p => p.userId) } }, select: { id: true, email: true, active: true, role: true } });
  const now = new Date();
  return { items: recipients.filter(r => !employments || employments.some(e => e.recipientId === r.id)).map(recipient => {
    const person = recipient.data as Record<string, unknown>;
    const profile = profiles.find(p => p.recipientId === recipient.id);
    const user = profile ? users.find(u => u.id === profile.userId) : undefined;
    const invite = invitations.find(i => i.recipientId === recipient.id);
    const assigned = enrollments.filter(e => e.recipientId === recipient.id);
    const available = assigned.some(e => (!e.startsAt || e.startsAt <= now) && (!e.dueAt || e.dueAt > now));
    return {
      recipientId: recipient.id,
      nameRu: String(person.fullNameRu || ""), nameKz: String(person.fullNameKz || ""),
      email: user?.email || invite?.email || String(person.email || ""),
      state: profile ? (user?.active && user.role === "LEARNER" ? "LINKED" : "ACCOUNT_UNAVAILABLE") : invite && invite.expiresAt > now ? "INVITED" : invite ? "INVITE_EXPIRED" : "NOT_LINKED",
      userId: user?.id || null,
      expiresAt: invite && !profile ? invite.expiresAt : null,
      assignedCount: assigned.length,
      available,
      canInvite: assigned.some(e => !e.dueAt || e.dueAt > now),
    };
  }) };
}
