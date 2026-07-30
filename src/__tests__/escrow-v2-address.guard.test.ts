/**
 * GUARD: the escrow-v2 contract address has ONE home.
 *
 * Oscar's ruling (Jul 31, 2026): "let's not build ourselves into a corner on
 * the smart contract once again." The answer is versioned replaceability —
 * the address comes from config (src/lib/escrow-v2.ts, env-overridable via
 * ESCROW_V2_CONTRACT) and funded tasks pin the address they were funded on.
 * That property dies the day someone hardcodes the literal address in a
 * second source file, so this test fails the suite if it ever appears
 * anywhere else.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const V2_ADDRESS = "0x61041dfC405D6CeA57653B8E8BCBDA209214682f";
const SRC = join(process.cwd(), "src");

// The config module itself, and the guard tests that pin the deployed value.
const ALLOWED = new Set([
  "lib/escrow-v2.ts",
  "__tests__/escrow-v2.guard.test.ts",
  "__tests__/escrow-v2-address.guard.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("escrow-v2 address isolation", () => {
  it("the literal contract address exists ONLY in the config module (+ its guard tests)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (text.toLowerCase().includes(V2_ADDRESS.toLowerCase())) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("generated/seeded task engines cannot mint usdc-v2 favours (points-only by construction)", () => {
    // The replenish engine, daily generator and seeder must never carry the
    // v2 reward type — money favours are human-funded at claimant-accept,
    // never machine-generated. String-level backstop on top of the behavioral
    // assertions in board-replenish.test.ts.
    for (const rel of ["lib/board-replenish.ts", "lib/daily-generator.ts", "lib/seeder.ts"]) {
      const text = readFileSync(join(SRC, rel), "utf8");
      expect(text.includes("usdc-v2"), `${rel} must not reference usdc-v2`).toBe(false);
    }
  });
});
