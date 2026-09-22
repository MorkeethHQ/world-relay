import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// THE STEP-0 LEAK (2026-09-22). On 21 Sep, 4 people signed in and 0 started the
// mission (/api/stats/retention). A production walk at 07:18Z showed the mission
// path works end to end (mission_started fired, the answer screen opened). The
// leak was the tour: "How FAVOUR works" led through terms and sign-in to "You are
// all set" and a "See open favours" button, with no mission queued. Source guards,
// because the suite has no React renderer; the proof is the production walk.
const onboarding = readFileSync(join(__dirname, "../components/Onboarding.tsx"), "utf8");

describe("the tour ends on the mission, not on the board", () => {
  it("the last tour screen's main button is the mission when there is one", () => {
    expect(onboarding).toMatch(/step === 4 && mission \? \([\s\S]*?onClick=\{finishWithMission\}[\s\S]*?Do today&apos;s mission/);
  });
  it("it queues the mission through the same key the Feed reads", () => {
    const fn = onboarding.slice(onboarding.indexOf("const finishWithMission"), onboarding.indexOf("const finishWithMission") + 500);
    expect(fn).toMatch(/localStorage\.setItem\(PENDING_MISSION_KEY/);
    expect(fn).toMatch(/onComplete\(\)/);
  });
  it("the board stays one tap away", () => {
    expect(onboarding).toMatch(/onClick=\{onComplete\}[^>]*>\s*See open favours/);
  });
});

describe("every step-0 way in reports which one it was", () => {
  const fnBody = (name: string) => onboarding.slice(onboarding.indexOf(`const ${name}`), onboarding.indexOf(`const ${name}`) + 300);
  it("Do today's mission", () => expect(fnBody("startMission")).toMatch(/trackFunnelEvent\("mission_tapped"\)/));
  it("Do a piece and earn", () => expect(fnBody("startPiece")).toMatch(/trackFunnelEvent\("piece_tapped"\)/));
  it("How FAVOUR works, and Get started when there is no mission", () => {
    expect(onboarding).toMatch(/trackFunnelEvent\("get_started_tapped"\); next\(\); \}\}[^>]*>\s*How FAVOUR works/);
    expect(onboarding).toMatch(/step === 0 \? \(\) => \{ trackFunnelEvent\("get_started_tapped"\)/);
  });
  it("For companies, on both of its buttons, counted when it opens", () => {
    expect(onboarding.match(/if \(!forCompanies\) trackFunnelEvent\("for_companies_tapped"\)/g)?.length).toBe(2);
  });
});
