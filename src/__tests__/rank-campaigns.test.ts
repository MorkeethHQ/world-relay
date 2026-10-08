import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DAY_MS, rankCampaigns } from "@/lib/rank-campaigns";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const c = (id: string, publishedAt: string, extra: object = {}) => ({
  id, company: `Co ${id}`, rewardPerPiecePoints: 10, publishedAt, ...extra,
});
const pass = (at: string) => ({ verdict: "pass" as const, at });

describe("the top list of the day", () => {
  it("with no reviews at all: newest first, zeros shown, and it says so", () => {
    const top = rankCampaigns([
      { campaign: c("old", "2026-09-21T17:05:13Z"), results: [] },
      { campaign: c("new", "2026-09-22T05:05:13Z"), results: [] },
    ], NOW);
    expect(top.rows.map((r) => [r.rank, r.id, r.acceptedToday])).toEqual([[1, "new", 0], [2, "old", 0]]);
    expect(top).toMatchObject({ products: 2, acceptedToday: 0, acceptedTotal: 0, rankedBy: "newest" });
  });

  it("ranks by reviews accepted in the last 24 hours, before the total", () => {
    const top = rankCampaigns([
      { campaign: c("big", "2026-09-01T00:00:00Z"), results: [pass(ago(3 * DAY_MS)), pass(ago(4 * DAY_MS)), pass(ago(5 * DAY_MS))] },
      { campaign: c("hot", "2026-09-01T00:00:00Z"), results: [pass(ago(1000))] },
      { campaign: c("cold", "2026-10-07T00:00:00Z"), results: [] },
    ], NOW);
    expect(top.rows.map((r) => r.id)).toEqual(["hot", "big", "cold"]);
    expect(top).toMatchObject({ acceptedToday: 1, acceptedTotal: 4, rankedBy: "today" });
  });

  it("counts only a pass: a failed or flagged review never lifts a product", () => {
    const top = rankCampaigns([
      { campaign: c("spam", "2026-10-07T00:00:00Z"), results: [{ verdict: "fail", at: ago(1) }, { verdict: "flag", at: ago(2) }, { verdict: "flag", at: ago(3) }] },
      { campaign: c("real", "2026-09-01T00:00:00Z"), results: [pass(ago(2 * DAY_MS))] },
    ], NOW);
    expect(top.rows.map((r) => r.id)).toEqual(["real", "spam"]);
    expect(top.rows[1]).toMatchObject({ acceptedToday: 0, acceptedTotal: 0, reviewedTotal: 3 });
    expect(top.rankedBy).toBe("total");
  });

  it("does not count a review dated in the future or with a broken date as today's", () => {
    const top = rankCampaigns([{ campaign: c("x", "2026-10-01T00:00:00Z"), results: [pass(ago(-60_000)), pass("not a date"), pass(ago(DAY_MS))] }], NOW);
    expect(top.rows[0]).toMatchObject({ acceptedToday: 0, acceptedTotal: 3 });
  });

  it("leaves a hidden campaign out and names a product before its company", () => {
    const top = rankCampaigns([
      { campaign: c("h", "2026-10-07T00:00:00Z", { hidden: true }), results: [pass(ago(1))] },
      { campaign: c("p", "2026-10-01T00:00:00Z", { productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app" }), results: [] },
    ], NOW);
    expect(top.rows).toHaveLength(1);
    expect(top.rows[0]).toMatchObject({ name: "STRIVE", company: "Co p", productUrl: "https://agentic-strava.vercel.app" });
    expect(top.acceptedToday).toBe(0);
  });
});

describe("TopProducts shows only what is real", () => {
  const src = readFileSync(join(__dirname, "..", "components", "TopProducts.tsx"), "utf8");

  it("never shows a proposed pool, and uses no money green", () => {
    expect(src).not.toMatch(/proposedPoolUsdc|USDC|>\$/);
    expect(src).not.toMatch(/success-\d|\b(green|emerald|teal|blue|indigo|violet|purple|cyan|sky)-\d/);
    expect(src).not.toMatch(/info-\d/);
  });

  it("shows points in amber and nothing that pulses or bounces", () => {
    expect(src).toMatch(/text-amber-600/);
    expect(src).not.toMatch(/animate-/);
  });
});
