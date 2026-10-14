import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dayLine, juryGameOn, pips } from "@/lib/jury-game";

// THE JURY GAME SWITCH AND ITS WORDS (day bet, 14 Oct 2026).

const FLAG = "NEXT_PUBLIC_FAVOUR_JURY_GAME";
const ENV = "NEXT_PUBLIC_FAVOUR_DEPLOY_ENV";
afterEach(() => { delete process.env[FLAG]; delete process.env[ENV]; });

describe("juryGameOn", () => {
  it("is off in a production build without the variable, and off locally without it", () => {
    process.env[ENV] = "production";
    expect(juryGameOn()).toBe(false);
    process.env[ENV] = "";
    expect(juryGameOn()).toBe(false);
  });
  it("is on in a preview build, and on with the variable", () => {
    process.env[ENV] = "preview";
    expect(juryGameOn()).toBe(true);
    process.env[ENV] = "production";
    process.env[FLAG] = "1";
    expect(juryGameOn()).toBe(true);
  });
  it("next.config copies VERCEL_ENV into the variable the switch reads", () => {
    expect(readFileSync(`${process.cwd()}/next.config.ts`, "utf8")).toMatch(/NEXT_PUBLIC_FAVOUR_DEPLOY_ENV: process\.env\.VERCEL_ENV \?\? ""/);
  });
  it("the home card and the deck's day marks are drawn only behind the switch", () => {
    const feed = readFileSync(`${process.cwd()}/src/components/Feed.tsx`, "utf8");
    expect(feed).toMatch(/\{juryGameOn\(\) && tab === "available" && !loading && userId && \(\s*<JuryGameCard/);
    const deck = readFileSync(`${process.cwd()}/src/components/JuryMode.tsx`, "utf8");
    expect(deck).toContain("const game = juryGameOn();");
    expect(deck).toMatch(/\{game && day && \(/);
    expect(deck).toMatch(/if \(game && result\.day/);
  });
});

describe("pips and dayLine", () => {
  it("fills one pip per verdict up to the goal", () => {
    expect(pips({ today: 3, goal: 10 }).filter(Boolean)).toHaveLength(3);
    expect(pips({ today: 14, goal: 10 }).filter(Boolean)).toHaveLength(10);
    expect(pips({ today: 0, goal: 10 })).toHaveLength(10);
  });
  it("says what is left, the run, and done, from the server's numbers only", () => {
    expect(dayLine(null)).not.toMatch(/\d/);
    expect(dayLine({ today: 0, goal: 10, streak: 0, best: 0 })).toBe("10 swipes a day. Right calls earn a point.");
    expect(dayLine({ today: 0, goal: 10, streak: 4, best: 4 })).toBe("Play today to keep your 4-day run");
    expect(dayLine({ today: 3, goal: 10, streak: 1, best: 2 })).toBe("7 to go");
    expect(dayLine({ today: 3, goal: 10, streak: 5, best: 5 })).toBe("7 to go · 5 days in a row");
    expect(dayLine({ today: 12, goal: 10, streak: 2, best: 2 })).toBe("Done for today · 2 days in a row");
  });
});
