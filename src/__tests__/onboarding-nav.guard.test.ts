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
