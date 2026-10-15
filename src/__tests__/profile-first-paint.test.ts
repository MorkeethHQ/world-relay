import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// PROFILE FIRST PAINT (15 Oct 2026). The Profile showed a spinner until
// /api/escrow-stats answered (on-chain reads: 7.4 s of a 7.7 s cold load on a
// local production build, 14 Oct). Its answer was stored and never drawn: the
// on-chain section was removed in 8e845da. The page must not wait on it.
const page = () => readFileSync(`${process.cwd()}/src/app/dashboard/page.tsx`, "utf8");

describe("the Profile does not wait on data it never shows", () => {
  it("no /api/escrow-stats read on the Profile", () => {
    expect(page()).not.toContain("/api/escrow-stats");
  });
  it("the spinner ends when the tasks answer", () => {
    expect(page()).toMatch(/fetch\("\/api\/tasks"\)[\s\S]{0,200}\.finally\(\(\) => setLoading\(false\)\)/);
  });
});

// Codex ASTRA on 217a13f (MINOR): a failed task read ended the spinner and
// showed "No favours yet", so an outage read as an empty history.
describe("a failed task read says so, and offers a retry", () => {
  it("the read marks a failure on a bad answer or a network error", () => {
    const p = page();
    expect(p).toMatch(/if \(!r\.ok\) throw new Error/);
    expect(p).toMatch(/\.catch\(\(\) => setTasksFailed\(true\)\)/);
  });
  it("the empty state is not shown for a failed read; a Try again button is", () => {
    const p = page();
    const empty = p.indexOf("No favours yet");
    const failed = p.indexOf("Could not load your favours");
    expect(failed).toBeGreaterThan(0);
    expect(failed).toBeLessThan(empty);
    expect(p).toMatch(/if \(tasksFailed\)/);
    expect(p).toMatch(/onClick=\{retryTasks\}[\s\S]{0,200}Try again/);
  });
});
