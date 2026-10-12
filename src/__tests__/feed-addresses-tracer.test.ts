import { describe, it, expect } from "vitest";
import { PUBLIC_TASK_KEYS } from "@/lib/task-serializer";

// TRACER, not a rule (hardening pass, 2026-10-13).
//
// The public feed carries the full wallet address of the poster and the
// claimant (96 and 132 of 294 live rows on 2026-10-12). It stays that way on
// purpose today, and this test exists so the day it changes is a conscious
// edit and not a side effect:
//
//   - the UI compares `task.poster === userId` and `task.claimant === userId`
//     in Feed.tsx (mine tab, isOwnTask, isClaimant, stats), dashboard/page.tsx
//     (posted, completed), task/[id]/page.tsx (isPoster, isClaimant, the
//     action bodies), CampaignPage.tsx (contributors);
//   - usernames are resolved client side by posting the full address list to
//     usernames.worldcoin.org (src/hooks/useWorldUser.ts), World's own public
//     lookup, which also resolves address to username for any caller;
//   - GET /api/tasks is CDN-cached public, s-maxage=5, so it cannot vary by
//     cookie.
//
// The replacement is designed on the hardening page: a server-issued stable
// public id per wallet, the viewer's own id returned by /api/session, and a
// server-side username proxy. When that lands, move "poster" and "claimant"
// off PUBLIC_TASK_KEYS and delete this file in the same commit.

describe("the feed still carries full poster and claimant addresses", () => {
  it("poster and claimant are on the public list today", () => {
    expect(PUBLIC_TASK_KEYS).toContain("poster");
    expect(PUBLIC_TASK_KEYS).toContain("claimant");
  });
});
