import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// PROFILE FIRST PAINT (15 Oct 2026, carried to the 19 Oct Profile screen). The
// old Profile waited on /api/escrow-stats it never drew. The new one reads only
// the person's own contributions, after the session is renewed, and a failed
// read says so with a Try again (Codex ASTRA minor on 217a13f).
const page = () => readFileSync(`${process.cwd()}/src/components/fv/ProfileScreen.tsx`, "utf8");

describe("the Profile does not wait on data it never shows", () => {
  it("no /api/escrow-stats and no /api/tasks read on the Profile", () => {
    expect(page()).not.toContain("/api/escrow-stats");
    expect(page()).not.toContain("/api/tasks");
  });
  it("renews the session, then reads the person's own contributions", () => {
    expect(page()).toContain('fetch("/api/session"');
    expect(page()).toContain("if (!session.authenticated) return;");
    expect(page()).not.toContain("ensureSession(");
    expect(page()).toContain('fetch("/api/me/contributions"');
  });
});

describe("a failed read says so, and offers a retry", () => {
  it("marks a failure on a bad answer or a network error, and shows Try again", () => {
    const p = page();
    expect(p).toMatch(/if \(!r\.ok\) throw new Error/);
    expect(p).toMatch(/\.catch\(\(\) => \{ setFailed\(true\)/);
    expect(p).toMatch(/onClick=\{onRetry\}>Try again/);
  });
});
