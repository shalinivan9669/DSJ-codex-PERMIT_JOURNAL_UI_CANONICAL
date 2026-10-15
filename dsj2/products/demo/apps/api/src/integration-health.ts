import { db } from "./core";

export const INTEGRATION_WORKER_VERSION = "integration-local-v1";
export const INTEGRATION_STALE_MS = 30_000;

/** Operational details are returned only from the administrator readiness route. */
export async function integrationHealth(tenantId: string, now = new Date()) {
  const [beat, pendingCount, oldest, failedCount] = await Promise.all([
    db.workerHeartbeat.findFirst({
      where: { version: INTEGRATION_WORKER_VERSION },
      orderBy: [{ seenAt: "desc" }, { id: "desc" }],
    }),
    db.regulatoryOutbox.count({
      where: { tenantId, status: { in: ["PENDING", "PROCESSING"] } },
    }),
    db.regulatoryOutbox.findFirst({
      where: { tenantId, status: { in: ["PENDING", "PROCESSING"] } },
      select: { createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.regulatoryOutbox.count({ where: { tenantId, status: "NEEDS_REVIEW" } }),
  ]);
  const ageMs = beat
    ? Math.max(0, now.getTime() - beat.seenAt.getTime())
    : null;
  const reason = !beat
    ? "NOT_STARTED"
    : beat.stoppedAt
      ? "STOPPED"
      : ageMs! > INTEGRATION_STALE_MS
        ? "HEARTBEAT_STALE"
        : beat.lastError
          ? beat.lastError
          : null;
  return {
    status: reason ? "degraded" : "ok",
    reason,
    seenAt: beat?.seenAt || null,
    stoppedAt: beat?.stoppedAt || null,
    heartbeatAgeSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    pendingCount,
    oldestPendingAt: oldest?.createdAt || null,
    oldestPendingAgeSeconds: oldest
      ? Math.max(
          0,
          Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1000),
        )
      : null,
    failedCount,
    connection: "NOT_CONNECTED",
  };
}
