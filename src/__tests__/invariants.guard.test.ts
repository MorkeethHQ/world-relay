import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Mechanical guardrails for the SECURITY-INVARIANTS.md classes that ~20 broad
// reviews missed. These catch the easy-to-regress anti-patterns so a future
// change can't silently reintroduce them. They are intentionally conservative
// (exact anti-patterns, not heuristics) to avoid flaky failures.

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (f: string) => readFileSync(f, "utf8");

describe("invariant guards", () => {
  it("Inv 3: no placeholder escrow tx hash — funded means a real 0x+64hex hash", () => {
    // The seed route once shipped escrowTxHash: "funded", which passed every
    // truthiness-based funding guard with no on-chain backing.
    const offenders = files.filter((f) => /escrowTxHash:\s*["']funded["']/.test(read(f)));
    expect(offenders, `placeholder funded string in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("Inv 5: verifyProofStub (random verdict) is never awarded in production unguarded", () => {
    // Any file that calls verifyProofStub must also reference a production guard
    // (NODE_ENV) so a random 70%-pass verdict can't earn in prod.
    const callers = files.filter((f) => {
      const s = read(f);
      return /verifyProofStub\s*\(/.test(s) && !/verify-proof\.ts$/.test(f);
    });
    for (const f of callers) {
      expect(read(f), `verifyProofStub used without a production guard in ${f}`).toMatch(/NODE_ENV/);
    }
  });

  it("Inv 4: spoofable poster/claimant routes enforce session ownership", () => {
    // confirm/cancel/dispute release or refund escrow off a public address; they
    // must call ownershipError (the SESSION_ENFORCE gate).
    for (const route of ["confirm", "cancel", "dispute"]) {
      const f = files.find((p) => p.endsWith(join(route, "route.ts")));
      expect(f, `${route}/route.ts not found`).toBeTruthy();
      expect(read(f!), `${route} route must enforce session ownership`).toMatch(/ownershipError/);
    }
  });

  it("Inv 2: escrow release sites record settlement (no fire-and-forget)", () => {
    // Every route that calls releaseEscrow must also record the outcome via
    // markSettled/markSettlementPending, never discard it.
    const releasers = files.filter((f) => /releaseEscrow\s*\(/.test(read(f)) && /app\/api\//.test(f));
    for (const f of releasers) {
      const s = read(f);
      expect(s, `releaseEscrow in ${f} must record settlement`).toMatch(/markSettl(ed|ementPending)/);
    }
  });
});
