import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commissionProfilePatch,
  commissionSettingsHref,
  commissionTarget,
} from "../lib/request-commission";
import { requestReturnPath } from "../lib/commission";
import type { Draft } from "../lib/types";

const draft = {
  id: "request-1",
  profileVersionId: "old-profile",
  events: [
    { id: "inherited", title: "БиОТ" },
    { id: "own", title: "Комиссия ИТР", profileVersionId: "own-profile" },
    {
      id: "other",
      title: "Другая комиссия",
      profileVersionId: "other-profile",
    },
  ],
} as Draft;

test("repairing an inherited commission changes only request profile", () => {
  assert.deepEqual(commissionProfilePatch(draft, "new-profile", "inherited"), {
    profileVersionId: "new-profile",
  });
  assert.equal(commissionTarget(draft, "inherited").eventId, undefined);
  assert.equal(draft.profileVersionId, "old-profile");
});

test("repairing an explicitly pinned event preserves the request and other event commissions", () => {
  const patch = commissionProfilePatch(draft, "new-profile", "own");
  assert.equal(patch.profileVersionId, undefined);
  assert.equal(patch.events![0], draft.events![0]);
  assert.equal(patch.events![1].profileVersionId, "new-profile");
  assert.equal(patch.events![2], draft.events![2]);
  assert.equal(draft.events![1].profileVersionId, "own-profile");
  assert.throws(() =>
    commissionProfilePatch(draft, "new-profile", "deleted-event"),
  );
});

test("settings recovery link preserves request and event context through the safe return route", () => {
  const url = new URL(
    commissionSettingsHref("request-1", "own"),
    "https://local.invalid",
  );
  assert.equal(url.searchParams.get("focus"), "commission");
  assert.equal(url.hash, "#profile-commission");
  assert.equal(
    requestReturnPath(url.searchParams.get("returnTo")),
    "/requests/request-1?commission=1&commissionEvent=own",
  );
});

test("other issuer errors return to profile adoption without requiring a BiOT commission", () => {
  const url = new URL(
    commissionSettingsHref("request-1", undefined, false),
    "https://local.invalid",
  );
  assert.equal(url.searchParams.get("focus"), "profile");
  assert.equal(url.hash, "#profile-names");
  assert.equal(
    requestReturnPath(url.searchParams.get("returnTo")),
    "/requests/request-1?profile=1",
  );
});
