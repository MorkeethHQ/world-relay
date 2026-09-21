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

  it("loop_start_intent is stored — tap before proof", async () => {
    await POST(post({ event: "loop_start_intent" }));
    expect(tracked[0].event).toBe("loop_start_intent");
  });

  it("loop_arrive is stored — the funnel entry", async () => {
    await POST(post({ event: "loop_arrive" }));
    expect(tracked[0].event).toBe("loop_arrive");
  });

  it("a tracked event is NOT also counted as a page view", async () => {
    await POST(post({ event: "fund_wall_hit", data: { needed: 1, balance: 0 }, page: "/" }));
    expect(tracked.map((t) => t.event)).toEqual(["fund_wall_hit"]);
  });

  it("page_view still works — the pre-existing path is untouched", async () => {
    await POST(post({ page: "/dashboard" }));
    expect(tracked).toEqual([{ event: "page_view", data: { page: "/dashboard" } }]);
  });
});

describe("the distribution funnel is recorded", () => {
  it("records only the named handoff and share events", async () => {
    for (const event of [
      "world_app_handoff_clicked",
      "world_app_deep_link_opened",
      "task_share_opened",
      "invite_share_opened",
    ]) {
      await POST(post({ event }));
    }

    expect(tracked).toEqual([
      { event: "world_app_handoff_clicked", data: {} },
      { event: "world_app_deep_link_opened", data: {} },
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

// THE FIRST-VISIT FUNNEL (2026-09-21). Four steps a stranger walks, counted per day.
// The names come from one module that both the client and this route read, so a
// step cannot be fired by the client and silently dropped here.
describe("the first-visit funnel is recorded", () => {
  const STEPS = ["mission_viewed", "terms_accepted", "sign_in_completed", "mission_started"];

  it("each of the four steps is accepted and counted under its own name", async () => {
    for (const event of STEPS) {
      const res = await POST(post({ event }));
      expect(res.status, event).toBe(200);
    }
    expect(tracked.map((t) => t.event)).toEqual(STEPS);
  });

  it("the route's list IS the client's list, so they cannot drift apart", async () => {
    const { FUNNEL_EVENTS } = await import("@/lib/funnel-events");
    expect([...FUNNEL_EVENTS]).toEqual(STEPS);
  });

  it("an unknown name is REFUSED with 400 and nothing is written", async () => {
    // Before this, an unlisted name fell through to the page-view path and got 200,
    // so a misspelled funnel step looked exactly like success while recording
    // nothing. A near-miss spelling is the realistic failure, so that is the probe.
    for (const event of ["mission_view", "mission_started ", "Mission_Viewed", "sign_in_complete"]) {
      const res = await POST(post({ event }));
      expect(res.status, JSON.stringify(event)).toBe(400);
    }
    expect(tracked).toHaveLength(0);
  });

  it("no identifier can ride along on a funnel event, even if a client sends one", async () => {
    // The client sends these with no data. This pins what happens if a future
    // client gets it wrong: the address, username and free text are all dropped.
    await POST(post({
      event: "sign_in_completed",
      data: {
        address: "0x1111111111111111111111111111111111111111",
        wallet: "0x1111111111111111111111111111111111111111",
        username: "someone",
        note: "free text",
      },
    }));
    expect(tracked).toEqual([{ event: "sign_in_completed", data: {} }]);
    expect(JSON.stringify(tracked)).not.toMatch(/0x1111|someone|free text/);
  });

  it("the retention report lists all four, so the funnel is readable, not just written", async () => {
    // A counter nobody can read is a claim. /api/stats/retention reads a fixed list
    // of names; if a step is missing there, it is recorded forever and never shown.
    const src = (await import("fs")).readFileSync(
      (await import("path")).join(__dirname, "../lib/retention.ts"),
      "utf8",
    );
    for (const event of STEPS) expect(src, event).toContain(`"${event}"`);
  });
});
