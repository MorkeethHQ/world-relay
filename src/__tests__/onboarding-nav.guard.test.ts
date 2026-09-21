import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The signed-out bottom nav must be reachable (2026-09-21). The onboarding panel was
// `fixed inset-0 z-[60]`, a full-screen layer over the nav (z-50), so at 390 px a
// Playwright tap on "Favours" timed out: the panel's own footer intercepted it.
// The real proof is the hosted Playwright tap; this pins the cause so it cannot
// quietly come back.
const onboarding = readFileSync(join(__dirname, "../components/Onboarding.tsx"), "utf8");
const jury = readFileSync(join(__dirname, "../components/JuryMode.tsx"), "utf8");

describe("onboarding leaves the nav uncovered", () => {
  it("the onboarding panel is not a full-screen inset-0 layer", () => {
    expect(onboarding).not.toMatch(/className="fixed inset-0 z-\[60\]/);
  });

  it("it stops above the nav, including the safe-area inset the nav pads by", () => {
    expect(onboarding).toMatch(/bottom: "calc\(var\(--favour-nav-h, 56px\) \+ env\(safe-area-inset-bottom/);
  });

  it("JuryMode still covers the nav on purpose, so the fix did not raise the nav", () => {
    expect(jury).toMatch(/fixed inset-0 z-\[60\]/);
  });
});

// Image heights (2026-09-21). The kit's unlayered `img, video { height: auto }`
// beats Tailwind v4's layered utilities, so an `h-*` on an <img> did nothing: on
// production a card image classed h-40 rendered 756 px tall. Every height class the
// app puts on an <img> must be re-asserted unlayered in globals.css.
describe("image height utilities actually apply", () => {
  const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
  const { execSync } = require("child_process");
  const src = execSync(`grep -rhoE "(<img|object-cover|object-contain)[^\\n]*" ${join(__dirname, "..")} --include=*.tsx || true`).toString();
  const used = new Set((src.match(/\b(?:max-)?h-(?:\[[0-9]+px\]|[0-9]+|full)\b/g) || []));
  it("finds the classes it guards (a guard that matches nothing is not a guard)", () => {
    expect(used.size).toBeGreaterThan(2);
  });
  for (const cls of ["h-40", "h-full", "h-16", "h-[72px]", "max-h-80", "max-h-72"]) {
    it(`${cls} is re-asserted unlayered`, () => {
      const sel = cls.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      expect(css).toContain(`img.${sel}`);
    });
  }
  it("no media height class is used that is not re-asserted", () => {
    const covered = ["h-40", "h-full", "h-16", "h-[72px]", "max-h-80", "max-h-72"];
    for (const c of used) expect(covered, `unguarded ${c}`).toContain(c);
  });
});
