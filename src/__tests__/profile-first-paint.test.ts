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
