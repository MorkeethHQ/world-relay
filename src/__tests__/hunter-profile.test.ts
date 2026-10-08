import { describe, expect, it } from "vitest";
import { githubNameOrNull, hunterProfile } from "@/lib/hunter-profile";

const d = (campaignId: string | null, at: string, extra: object = {}) => ({ campaignId, campaignLabel: campaignId ? `Product ${campaignId}` : null, points: 10, at, ...extra });

describe("the profile as a hunter", () => {
  it("is all zeros for a person with nothing on record, and claims nothing", () => {
    expect(hunterProfile([])).toEqual({ reviews: 0, products: 0, favours: 0, points: 0, launched: 0, firstAt: null, latest: [] });
  });

  it("counts reviews, the different products they were for, and plain favours apart", () => {
    const p = hunterProfile([
      d("a", "2026-10-01T10:00:00Z"), d("a", "2026-10-02T10:00:00Z"), d("b", "2026-10-03T10:00:00Z", { streakBonus: 2 }),
      d(null, "2026-09-01T10:00:00Z", { points: 3 }),
    ]);
    expect(p).toMatchObject({ reviews: 3, products: 2, favours: 1, points: 35, firstAt: "2026-09-01T10:00:00.000Z" });
    expect(p.latest).toEqual([{ label: "Product b", at: "2026-10-03T10:00:00Z" }, { label: "Product a", at: "2026-10-02T10:00:00Z" }]);
  });

  it("counts a launch only when it is published and names a product with a link", () => {
    const p = hunterProfile([], [
      { status: "published", productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app" },
      { status: "published" }, // no product: not a launch
      { status: "draft", productName: "Later", productUrl: "https://later.test/" },
    ]);
    expect(p.launched).toBe(1);
  });

  it("accepts only a GitHub name in GitHub's shape", () => {
    expect(githubNameOrNull("@Morkeeth")).toBe("Morkeeth");
    for (const bad of ["", "a--b", "-a", "a-", "a/b", "https://github.com/x", "x".repeat(40), null, 7]) expect(githubNameOrNull(bad), String(bad)).toBeNull();
  });
});
