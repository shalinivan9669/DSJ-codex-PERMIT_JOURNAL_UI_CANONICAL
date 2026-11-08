import type { Draft } from "./types";

/** A separately selected event commission is independent of the request's default. */
export function commissionTarget(draft: Draft, eventId?: string) {
  const event = eventId
    ? draft.events?.find((entry) => entry.id === eventId)
    : undefined;
  if (eventId && !event)
    throw new Error("Обучение больше не найдено в заявке. Обновите страницу.");
  return {
    eventId: event?.profileVersionId ? event.id : undefined,
    title: event?.profileVersionId ? event.title : undefined,
    profileVersionId: event?.profileVersionId || draft.profileVersionId,
  };
}

export function commissionProfilePatch(
  draft: Draft,
  profileVersionId: string,
  eventId?: string,
): Partial<Draft> {
  const target = commissionTarget(draft, eventId);
  return target.eventId
    ? {
        events: draft.events!.map((event) =>
          event.id === target.eventId ? { ...event, profileVersionId } : event,
        ),
      }
    : { profileVersionId };
}

export function commissionSettingsHref(
  requestId: string,
  eventId?: string,
  commissionRequired = true,
) {
  const returnQuery = new URLSearchParams(
    commissionRequired ? { commission: "1" } : { profile: "1" },
  );
  if (eventId) returnQuery.set("commissionEvent", eventId);
  const query = new URLSearchParams({
    tab: "profile",
    focus: commissionRequired ? "commission" : "profile",
    returnTo: `/requests/${encodeURIComponent(requestId)}?${returnQuery}`,
  });
  return `/settings?${query}#${commissionRequired ? "profile-commission" : "profile-names"}`;
}
