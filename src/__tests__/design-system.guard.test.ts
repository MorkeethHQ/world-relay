import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CAMPAIGNS } from "@/lib/campaigns";

// DESIGN-SYSTEM.md is law: money = green-600 ONLY; points = amber-600 ONLY;
// NO blue, NO purple; the info-* palette is banned from user surfaces. This
// guard exists because on 2026-09-03 the campaign page painted a POINTS
// campaign teal/emerald from its own accentColor, ran a blue->indigo unlock
// bar, and a green->cyan progress bar — three violations on one screen, all
// invisible in a green test suite. Oscar: "the design is green" / "design is
// off". Source assertions are a doc aid, not a behavioural gate — but for
// palette tokens the source IS the behaviour.
const SRC = join(__dirname, "..", "components", "CampaignPage.tsx");
const src = readFileSync(SRC, "utf8");

describe("CampaignPage obeys DESIGN-SYSTEM colour law", () => {
  it("never uses the banned info/blue/purple palette", () => {
    expect(src).not.toMatch(/info-\d/);
    expect(src).not.toMatch(/\b(blue|indigo|violet|purple|cyan|sky)-\d/);
    // the exact hexes that were live: blue-400, indigo-500, cyan-400
    for (const hex of ["#60a5fa", "#6366f1", "#22d3ee"]) expect(src.toLowerCase()).not.toContain(hex);
  });

  it("never uses the success-* alias for a non-money state", () => {
    expect(src).not.toMatch(/success-\d/);
  });

  it("never paints a background from a campaign's accentColor", () => {
    expect(src).not.toMatch(/backgroundColor:\s*campaign\.accentColor/);
  });

  it("renders a points campaign's hero in ink, never its declared gradient", () => {
    expect(src).toMatch(/rewardKind === "points" \? inkHero : campaign\.heroGradient/);
    expect(src).toMatch(/rewardKind === "points" \? "from-gray-950 via-gray-900 to-gray-800" : campaign\.heroGradient/);
  });

  it("keeps green for the one thing that is money: the paid unlock bar", () => {
    expect(src).toContain('unlockView.paid ? "#16a34a" : "#111827"');
  });
});

describe("campaign data agrees with the render rule", () => {
  it("no points campaign declares a green/teal/emerald gradient or accent", () => {
    for (const c of CAMPAIGNS) {
      if (c.rewardKind !== "points") continue;
      expect(c.heroGradient, `${c.id} heroGradient`).not.toMatch(/teal|emerald|green|lime|cyan|sky|blue|indigo|violet|purple/);
      expect(c.accentColor.toLowerCase(), `${c.id} accentColor`).not.toMatch(/^#(0d9488|16a34a|22c55e|10b981|14b8a6|06b6d4|3b82f6|6366f1|8b5cf6)$/);
    }
  });

  it("the comeback campaign's copy does not sell USDC on points cards or a photo-only gate", () => {
    const c = CAMPAIGNS.find((x) => x.id === "comeback-2026")!;
    expect(c.tagline).not.toMatch(/real USDC/i);
    expect(c.description).not.toMatch(/clean photo favour/i);
  });
});
