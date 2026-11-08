import assert from "node:assert/strict";
import test from "node:test";
import { learningNotificationLink } from "../lib/learning-notification-link";

test("notification keeps its exact event or review destination", () => {
  assert.equal(
    learningNotificationLink(
      { href: "/lms/calendar?eventId=event-1", eventId: "event-1" },
      "/lms/notifications",
    ),
    "/lms/calendar?eventId=event-1",
  );
  assert.equal(
    learningNotificationLink(
      {
        href: "/lms/teaching?type=SUBMISSION&reviewId=review-1&tab=reviews",
        eventId: null,
      },
      "/lms/notifications",
    ),
    "/lms/teaching?reviewId=review-1&type=SUBMISSION&tab=reviews",
  );
});

test("invalid notification links never become external or unrelated navigation", () => {
  for (const href of [
    "https://outside.test",
    "//outside.test/path",
    "/\\outside.test/path",
    "/settings",
    "/learn/recovery?token=secret",
  ]) {
    assert.equal(
      learningNotificationLink({ href, eventId: null }, "/lms/notifications"),
      null,
    );
    assert.equal(
      learningNotificationLink(
        { href, eventId: "event-1" },
        "/learn/notifications",
      ),
      "/learn/calendar?eventId=event-1",
    );
  }
});

test("event fallback preserves learner context and never invents an event", () => {
  assert.equal(
    learningNotificationLink(
      { href: null, eventId: "event-1" },
      "/learn/notifications",
    ),
    "/learn/calendar?eventId=event-1",
  );
  assert.equal(
    learningNotificationLink(
      { href: null, eventId: null },
      "/lms/notifications",
    ),
    null,
  );
});
