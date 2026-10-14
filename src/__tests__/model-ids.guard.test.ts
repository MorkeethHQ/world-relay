import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ONE HAIKU MODEL ID (14 Oct 2026). /api/proof-precheck named
// claude-haiku-4-5-20250414, which the API answers with "model not found"
// (checked by the orchestrator with the production key, 14 Oct). The route
// caught the error and told every person "Pre-check unavailable". Every other
// caller names claude-haiku-4-5-20251001. This pins them all to that one id.

const HAIKU = "claude-haiku-4-5-20251001";
const root = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("every Haiku call names the one model id that answers", () => {
  const uses = files(root).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/claude-haiku-[0-9a-z.-]+/g)].map((m) => ({ file: f.slice(root.length + 1), id: m[0] })),
  );

  it("finds the callers, so the check below reads something", () => {
    expect(uses.map((u) => u.file)).toContain("app/api/proof-precheck/route.ts");
  });

  it(`each one is ${HAIKU}`, () => {
    expect(uses.filter((u) => u.id !== HAIKU)).toEqual([]);
  });
});
