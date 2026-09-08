import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
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

// ---------------------------------------------------------------------------
// Widened 2026-09-08 (F1 repair). Everything above this line reads ONE
// hardcoded file, CampaignPage.tsx. That is why two real palette violations
// shipped on 2026-09-08 with the suite green: /task/[id] painted every reward
// in money green, so a 10 pts favour wore money colours on its own detail page,
// and the new /c/[id] route was outside the guard entirely. The guard was
// correct about a narrower object than its name.
//
// This block walks src/app and src/components instead of naming files, so a
// NEW reward surface is covered the day it is created rather than the day
// someone remembers to add it to a list.
// ---------------------------------------------------------------------------

// A file is a "reward surface" if it renders a reward at all.
const REWARD_USAGE = /rewardAmountLabel|isPointsReward|RewardBadge|rewardKind|isRealMoney/;
const MONEY_GREEN = /\b(?:text|bg|border|from|via|to)-(?:success|green|emerald|teal)-\d{2,3}\b/;
const POINTS_AMBER = /\b(?:text|bg|border)-amber-\d{2,3}\b/;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTsx(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const SRC_ROOT = join(__dirname, "..");
const rewardSurfaces = [
  ...walkTsx(join(SRC_ROOT, "app")),
  ...walkTsx(join(SRC_ROOT, "components")),
].filter((f) => REWARD_USAGE.test(readFileSync(f, "utf8")));

// The branch of a points conditional that runs WHEN THE REWARD IS POINTS:
// everything between "isPoints... ?" and the first ":" after it.
function pointsBranches(src: string): string[] {
  const out: string[] = [];
  const re = /isPoints[A-Za-z]*\s*(?:\([^)]*\))?\s*\?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const from = m.index + m[0].length;
    const colon = src.indexOf(":", from);
    if (colon === -1) continue;
    out.push(src.slice(from, colon));
  }
  return out;
}

describe("every reward surface obeys the points/money colour split", () => {
  it("finds the reward surfaces by walking, not by a hardcoded list", () => {
    // A floor, so a broken walk (wrong root, bad filter) reads as failure
    // rather than as a suite with nothing left to check.
    expect(rewardSurfaces.length).toBeGreaterThanOrEqual(9);
    const names = rewardSurfaces.map((f) => f.replace(/.*\/src\//, "src/"));
    // The two files whose violations shipped past the old single-file guard.
    expect(names).toContain("src/app/task/[id]/page.tsx");
    expect(names).toContain("src/app/c/[id]/page.tsx");
    expect(names).toContain("src/components/RewardBadge.tsx");
  });

  // THE BUG THIS EXISTS FOR. Money colours mean real escrowed USDC. A points
  // reward wearing green is the points/money conflation CLAUDE.md bans.
  it("never renders a points reward in money green, on any surface", () => {
    for (const file of rewardSurfaces) {
      const short = file.replace(/.*\/src\//, "src/");
      for (const branch of pointsBranches(readFileSync(file, "utf8"))) {
        expect(branch, `${short}: points branch wears money green`).not.toMatch(MONEY_GREEN);
      }
    }
  });

  // Scoped to a bare className literal, e.g. isPoints ? "text-amber-600" : ...
  // A points branch that is a whole JSX block is prose, not a reward colour, and
  // its greys are captions. The money-green rule above still covers those.
  it("a points colour literal is always amber", () => {
    let checked = 0;
    for (const file of rewardSurfaces) {
      const short = file.replace(/.*\/src\//, "src/");
      for (const branch of pointsBranches(readFileSync(file, "utf8"))) {
        const literal = branch.trim();
        if (!/^"[^"]*"$/.test(literal)) continue;
        if (!/\b(?:text|bg|border)-[a-z]+-\d{2,3}\b/.test(literal)) continue;
        expect(literal, `${short}: points colour literal must be amber`).toMatch(POINTS_AMBER);
        checked++;
      }
    }
    // The assertion is worthless if it never reads a single coloured branch.
    expect(checked, "no points colour literal was checked").toBeGreaterThan(0);
  });
});

describe("the campaign proposition never shows uncommitted money as money", () => {
  const PROP = join(SRC_ROOT, "app", "c", "[id]", "page.tsx");
  const prop = readFileSync(PROP, "utf8");

  // A USDC-denominated campaign with no funded pot pays nothing today: custody
  // is retired and a campaign unlock is the only live cash rail. Rendering its
  // amount in money green promises cash that no pot backs.
  it("green is conditional on a funded unlock, with a grey fallback", () => {
    const decl = prop.slice(prop.indexOf("const amountColour"));
    const expr = decl.slice(0, decl.indexOf(";"));
    expect(expr, "amountColour must exist").toContain("isPoints");
    expect(expr, "green must depend on unlock").toContain("unlock");
    expect(expr, "unfunded USDC must fall back to grey").toContain("text-gray-400");
    // The grey fallback must come after the unlock test, not before it.
    expect(expr.indexOf("unlock")).toBeLessThan(expr.indexOf("text-gray-400"));
  });

  it("says in words that an unfunded campaign pays no cash", () => {
    expect(prop).toMatch(/no pot is committed to this campaign/);
  });
});
