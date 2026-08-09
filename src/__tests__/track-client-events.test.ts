import { describe, it, expect, beforeEach, vi } from "vitest";

// Guard for /api/track's client-event allowlist.
//
// Why this needs a gate: the route is PUBLIC and unauthenticated, and trackEvent
// writes the event name straight into a redis hash field (`events:counts`, see
// track.ts:45). An unfiltered name would let any caller mint unbounded hash fields,
// bury the real funnel under junk, and churn the 5000-entry capped events:log —
// which is exactly the surface we are adding in order to MEASURE something. A
// polluted counter is worse than no counter: it looks like data.
//
// The funnel it protects (added 2026-07-17): usdc_post_attempt (denominator) and
// fund_wall_hit (numerator). 0 of 22 escrow-funded tasks came from a real user, and
// we could not tell whether the funding wall blocks people or nobody tries, because
// the wall returns before writing any record.

const tracked: Array<{ event: string; data: any }> = [];

vi.mock("@/lib/track", () => ({
  trackEvent: async (event: string, data?: any) => { tracked.push({ event, data }); },
  trackReach: async () => {},
}));

import { POST } from "@/app/api/track/route";

const post = (body: any) =>
  new Request("http://localhost/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;

beforeEach(() => { tracked.length = 0; });

describe("the funding funnel is recorded", () => {
  it("fund_wall_hit is stored with its numbers", async () => {
    const res = await POST(post({ event: "fund_wall_hit", data: { needed: 3, balance: 0 } }));
    expect(res.status).toBe(200);
    expect(tracked).toEqual([{ event: "fund_wall_hit", data: { needed: 3, balance: 0 } }]);
  });

  it("usdc_post_attempt is stored — the denominator", async () => {
    await POST(post({ event: "usdc_post_attempt", data: { needed: 5 } }));
    expect(tracked[0].event).toBe("usdc_post_attempt");
    expect(tracked[0].data.needed).toBe(5);
  });

  it("a tracked event is NOT also counted as a page view", async () => {
    await POST(post({ event: "fund_wall_hit", data: { needed: 1, balance: 0 }, page: "/" }));
    expect(tracked.map((t) => t.event)).toEqual(["fund_wall_hit"]);
  });

  it("page_view still works — the pre-existing path is untouched", async () => {
    await POST(post({ page: "/leaderboard" }));
    expect(tracked).toEqual([{ event: "page_view", data: { page: "/leaderboard" } }]);
  });
});

describe("the distribution funnel is recorded", () => {
  it("records only the named handoff and share events", async () => {
    for (const event of [
      "world_app_handoff_clicked",
      "task_share_opened",
      "invite_share_opened",
    ]) {
      await POST(post({ event }));
    }

    expect(tracked).toEqual([
      { event: "world_app_handoff_clicked", data: {} },
      { event: "task_share_opened", data: {} },
      { event: "invite_share_opened", data: {} },
    ]);
  });
});

describe("the allowlist holds against a hostile caller", () => {
  it("an arbitrary event name is NOT written", async () => {
    await POST(post({ event: "unlock_paid", data: { needed: 1 } }));
    expect(tracked.filter((t) => t.event === "unlock_paid")).toHaveLength(0);
  });

  it("a caller cannot forge a money event to pollute the funnel", async () => {
    for (const e of ["feed_loaded", "cap_hit", "proof_submitted", "task_claimed"]) {
      await POST(post({ event: e }));
    }
    expect(tracked).toHaveLength(0);
  });

  it("non-numeric payload fields are dropped, not stored", async () => {
    await POST(post({ event: "fund_wall_hit", data: { needed: "not-a-number", balance: {} } }));
    expect(tracked[0].data).toEqual({});
  });

  it("NaN / Infinity never reach the counter", async () => {
    await POST(post({ event: "fund_wall_hit", data: { needed: Number.POSITIVE_INFINITY, balance: Number.NaN } }));
    expect(tracked[0].data).toEqual({});
  });

  it("an absurd number is clamped, not stored raw", async () => {
    await POST(post({ event: "fund_wall_hit", data: { needed: 9e18, balance: -50 } }));
    expect(tracked[0].data.needed).toBe(1_000_000);
    expect(tracked[0].data.balance).toBe(0);
  });

  it("a malformed body does not throw", async () => {
    const bad = new Request("http://localhost/api/track", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    }) as any;
    const res = await POST(bad);
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(0);
  });
});
