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
  // R2 finding 6, 14 Oct 2026: unset means off in EVERY environment. A
  // preview build no longer turns it on by itself.
  it("is on only with the variable, also in a preview build", () => {
    process.env[ENV] = "preview";
    expect(juryGameOn()).toBe(false);
    process.env[FLAG] = "1";
    expect(juryGameOn()).toBe(true);
  });
  it("the switch reads no deploy environment", () => {
    expect(readFileSync(`${process.cwd()}/src/lib/jury-game.ts`, "utf8")).not.toMatch(/DEPLOY_ENV|VERCEL_ENV/);
  });
  it("the home card and the deck's day marks are drawn only behind the switch", () => {
    const feed = readFileSync(`${process.cwd()}/src/components/Feed.tsx`, "utf8");
    expect(feed).not.toContain("<JuryGameCard");
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

// R2 re-review, 14 Oct 2026: a slow first GET landed after the tenth verdict
// and the deck went from 10 back to 9.
describe("newerDay keeps the latest answer when replies arrive out of order", () => {
  const d = (date: string, today: number) => ({ date, today, goal: 10, streak: 1, best: 1 });
  it("a late, smaller count on the same day does not replace a larger one", async () => {
    const { newerDay } = await import("@/lib/jury-game");
    expect(newerDay(d("2026-10-14", 10), d("2026-10-14", 9)).today).toBe(10);
    expect(newerDay(d("2026-10-14", 9), d("2026-10-14", 10)).today).toBe(10);
    expect(newerDay(null, d("2026-10-14", 3)).today).toBe(3);
  });
  it("a new day replaces yesterday, and yesterday never replaces today", async () => {
    const { newerDay } = await import("@/lib/jury-game");
    expect(newerDay(d("2026-10-13", 10), d("2026-10-14", 1)).date).toBe("2026-10-14");
    expect(newerDay(d("2026-10-14", 1), d("2026-10-13", 10)).date).toBe("2026-10-14");
  });
  it("the deck sets the day and the goal moment only through acceptDay", () => {
    const deck = readFileSync(`${process.cwd()}/src/components/JuryMode.tsx`, "utf8");
    expect(deck.match(/setDay\(/g)?.length).toBe(1);
    expect(deck).toContain("acceptDay(dayRef.current, next)");
    // The goal moment is set in one place, inside takeDay, and only on celebrate.
    expect(deck.match(/setGoalMoment\((?!null)/g)?.length).toBe(1);
    expect(deck).toMatch(/if \(celebrate\) \{\s*goalTimers\.current = \[\s*setTimeout\(\(\) => \{ if \(dayRef\.current\?\.date === next\.date\) \{ hapticSuccess\(\); setGoalMoment\(next\)/);
    expect(deck.match(/takeDay\(/g)?.length).toBe(2); // called for the GET and for each verdict
  });
  // R2c, 14 Oct 2026: yesterday's late 10/10 stamped over today's 1/10.
  it("a late answer from yesterday that reached the goal does not celebrate", async () => {
    const { acceptDay } = await import("@/lib/jury-game");
    const today = { date: "2026-10-14", today: 1, goal: 10, streak: 2, best: 2 };
    const lateGoal = { date: "2026-10-13", today: 10, goal: 10, streak: 1, best: 2, goalReachedNow: true };
    expect(acceptDay(today, lateGoal)).toEqual({ day: today, celebrate: false });
    const nowGoal = { ...lateGoal, date: "2026-10-14" };
    expect(acceptDay({ ...today, today: 9 }, nowGoal)).toEqual({ day: nowGoal, celebrate: true });
  });
});

// R2d, 14 Oct 2026: the deck dropped a "not saved" answer, and a queued
// celebration fired after a newer day landed.
describe("a verdict that was not saved comes back, and a stale celebration does not fire", () => {
  it("verdictRetryable is true for the server's not-saved answer only", async () => {
    const { verdictRetryable } = await import("@/lib/jury-game");
    expect(verdictRetryable(409, { error: "Your verdict was not saved. Try again." })).toBe(true);
    expect(verdictRetryable(409, { error: "Already judged" })).toBe(false);
    expect(verdictRetryable(409, { error: "Card expired or was never issued" })).toBe(false);
    expect(verdictRetryable(500, { error: "not saved" })).toBe(false);
    expect(verdictRetryable(409, null)).toBe(false);
  });
  it("the deck puts the card back and says so, and checks the day before it celebrates (source read)", () => {
    const deck = readFileSync(`${process.cwd()}/src/components/JuryMode.tsx`, "utf8");
    expect(deck).toMatch(/if \(verdictRetryable\(res\.status, err\)\) \{\s*\/\/[^\n]*\n\s*setTimeout\(\(\) => setCards\(\(c\) => \(c\.some\(\(x\) => x\.cardId === cardId\) \? c : \[votedCard, \.\.\.c\]\)\), 140\);\s*setNotSaved\(cardId\);/);
    expect(deck).toContain("Not saved. Your last card is back on top: swipe it again.");
    // R2e: no card leaves the deck by position.
    expect(deck).not.toMatch(/setCards\(\(c\) => c\.slice\(1\)\)/);
    expect(deck).toContain("setCards((c) => c.filter((x) => x.cardId !== cardId));");
    // Only the returned card's own success clears its note.
    expect(deck).toContain("setNotSaved((id) => (id === cardId ? null : id));");
    expect(deck).toContain("if (dayRef.current?.date === next.date) { hapticSuccess(); setGoalMoment(next); }");
    expect(deck).toMatch(/if \(shown\.date !== dayRef\.current\?\.date\) \{\s*goalTimers\.current\.forEach\(clearTimeout\)/);
  });
});

// Edge 2, 14 Oct 2026: the 11th verdict, landing inside the 700 ms before the
// stamp, cancelled the 10/10. Only a new DATE cancels a queued stamp.
describe("a later count on the same day keeps the queued stamp", () => {
  it("source read: the stamp is cancelled on a date change and fires while the date is the same", () => {
    const deck = readFileSync(`${process.cwd()}/src/components/JuryMode.tsx`, "utf8");
    expect(deck).toContain("if (shown.date !== dayRef.current?.date) {");
    expect(deck).toContain("if (dayRef.current?.date === next.date) { hapticSuccess(); setGoalMoment(next); }");
  });
});
