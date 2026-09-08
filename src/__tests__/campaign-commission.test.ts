import { describe, it, expect } from "vitest";
import { CAMPAIGNS, getCampaignCommission } from "@/lib/campaigns";

// Guard for the requester brief rendered by /c/[id]. The brief is what makes a
// campaign readable to a cold visitor: who asks, what counts as done, what
// proof, why it repeats. These rules stop it drifting back into decoration.

describe("campaign commission brief", () => {
  it("returns null for a campaign with no brief, so the page can show an honest empty state", () => {
    expect(getCampaignCommission("relay-launch")).toBeNull();
  });

  it("returns null for an unknown campaign id", () => {
    expect(getCampaignCommission("no-such-campaign")).toBeNull();
  });

  it("at least one campaign publishes a brief", () => {
    expect(CAMPAIGNS.filter((c) => c.commission).length).toBeGreaterThan(0);
  });

  it("every published brief answers all four journey questions", () => {
    for (const c of CAMPAIGNS) {
      const b = c.commission;
      if (!b) continue;
      expect(b.requester.trim().length, `${c.id} requester`).toBeGreaterThan(0);
      expect(b.requesterKind.trim().length, `${c.id} requesterKind`).toBeGreaterThan(0);
      expect(b.asks.trim().length, `${c.id} asks`).toBeGreaterThan(0);
      expect(b.completion.length, `${c.id} completion`).toBeGreaterThan(0);
      expect(b.proof.trim().length, `${c.id} proof`).toBeGreaterThan(0);
      expect(b.repeats.trim().length, `${c.id} repeats`).toBeGreaterThan(0);
      expect(b.repeatsMechanic.trim().length, `${c.id} repeatsMechanic`).toBeGreaterThan(0);
    }
  });

  // reward.ts owns every reward label. A brief that restates an amount in prose
  // is a second source for the number, and second sources drift.
  it("no brief states a reward amount in prose", () => {
    for (const c of CAMPAIGNS) {
      const b = c.commission;
      if (!b) continue;
      const prose = [b.asks, b.proof, b.repeats, b.repeatsMechanic, b.requesterKind, ...b.completion].join(" ");
      expect(prose, `${c.id} must not contain a $ amount`).not.toMatch(/\$\s?\d/);
      expect(prose, `${c.id} must not contain a pts amount`).not.toMatch(/\d+\s?(pts|points)\b/i);
    }
  });

  // A points campaign never wears money colours, and it must not promise cash
  // in words either. Only a campaign with a funded unlock may say USDC.
  it("a points campaign with no unlock never mentions USDC in its brief", () => {
    for (const c of CAMPAIGNS) {
      const b = c.commission;
      if (!b || c.unlock) continue;
      const prose = [b.asks, b.proof, b.repeats, b.repeatsMechanic, ...b.completion].join(" ");
      expect(prose, `${c.id} has no funded unlock`).not.toMatch(/USDC/i);
    }
  });
});
