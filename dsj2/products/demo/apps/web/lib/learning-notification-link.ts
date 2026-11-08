import { safeLmsReturnTo } from "./lms-navigation";

export function learningNotificationLink(
  notification: { href: string | null; eventId: string | null },
  pathname: string,
): string | null {
  const destination = safeLmsReturnTo(notification.href);
  if (destination) return destination;
  return notification.eventId
    ? `${pathname.startsWith("/learn") ? "/learn" : "/lms"}/calendar?eventId=${encodeURIComponent(notification.eventId)}`
    : null;
}
