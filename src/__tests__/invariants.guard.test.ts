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

  it("Inv 4: points-spending routes enforce session ownership (anti-grief)", () => {
    // stake/freeze/jury all debit or award points off a body-supplied address.
    // Without the ownershipError gate anyone could spend or farm points as
    // another wallet. The gate is dormant until SESSION_ENFORCE=true but must be
    // present so flipping the flag closes the hole everywhere at once.
    for (const route of [
      join("predictions", "[id]", "stake"),
      join("proof-of-favour", "freeze"),
      join("jury"),
    ]) {
      const f = files.find((p) => p.endsWith(join(route, "route.ts")));
      expect(f, `${route}/route.ts not found`).toBeTruthy();
      expect(read(f!), `${route} route must call ownershipError`).toMatch(/ownershipError\(/);
    }
  });

  it("Inv 2: manual poster-confirm never releases funded escrow (money is AI-verified only)", () => {
    // The confirm route is manual (non-AI) and was the spoofable theft vector.
    // Funded escrow must move only through AI verification, so confirm must not
    // touch releaseEscrow.
    const f = files.find((p) => p.endsWith(join("confirm", "route.ts")));
    expect(f, "confirm/route.ts not found").toBeTruthy();
    expect(read(f!), "confirm route must not release escrow (funded settles via AI verification)").not.toMatch(/releaseEscrow/);
  });

  it("Inv 1: every points mutator serializes its read-modify-write under withWalletLock (no mint)", () => {
    // totalPoints is a JSON blob updated read-modify-write; without a per-wallet
    // lock two concurrent writers lose a deduction = a points MINT (proven: 10
    // concurrent spends of 10 on a 100-pt balance left 90, not 0). Each mutator
    // below must run inside withWalletLock. Mechanical check: the function body
    // (decl → next top-level `export `) must reference withWalletLock.
    const pof = files.find((p) => p.endsWith(join("lib", "proof-of-favour.ts")));
    expect(pof, "proof-of-favour.ts not found").toBeTruthy();
    const src = read(pof!);
    const mutators = [
      "spendPoints", "buyStreakFreeze", "awardPoints", "recordFavourClaimed",
      "recordFavourAttempted", "recordFavourCompleted", "recordFavourFailed",
      "recordFavourPosted", "recordDailyActivity",
    ];
    for (const name of mutators) {
      const start = src.indexOf(`export async function ${name}`);
      expect(start, `${name} not found in proof-of-favour.ts`).toBeGreaterThanOrEqual(0);
      const rest = src.slice(start + 1);
      const nextExport = rest.indexOf("\nexport ");
      const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
      expect(body, `${name} must wrap its read-modify-write in withWalletLock`).toMatch(/withWalletLock\(/);
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

  it("Inv 2: funder reward fires only on confirmed settlement, never at fund/post time (farm-proof)", () => {
    // recordFundingReward pays the funder points; it must ride the settlement
    // choke point (store.markSettled), NOT a create/fund/PATCH route — otherwise
    // a fund-then-cancel refund would farm points with no money ever moving.
    const callers = files.filter((f) => /recordFundingReward\s*\(/.test(read(f)));
    const offenders = callers.filter(
      (f) => !f.endsWith(join("lib", "store.ts")) && !f.endsWith(join("lib", "proof-of-favour.ts"))
    );
    expect(offenders, `recordFundingReward must only run from store.markSettled, not: ${offenders.join(", ")}`).toEqual([]);
    const store = files.find((p) => p.endsWith(join("lib", "store.ts")));
    const s = read(store!);
    const start = s.indexOf("export async function markSettled");
    expect(start, "markSettled not found").toBeGreaterThanOrEqual(0);
    const body = s.slice(start, s.indexOf("\nexport ", start + 1));
    expect(body, "markSettled must award the funder via recordFundingReward").toMatch(/recordFundingReward\(/);
  });

  it("Inv 2: funder reward is idempotent and funded-only (a task pays its funder at most once)", () => {
    // Two settlement paths (verify-proof pass + reconcile cron) and retries must
    // never double-pay; and points tasks / unfunded posts must never pay.
    const pof = read(files.find((p) => p.endsWith(join("lib", "proof-of-favour.ts")))!);
    const start = pof.indexOf("export async function recordFundingReward");
    expect(start, "recordFundingReward not found").toBeGreaterThanOrEqual(0);
    const body = pof.slice(start, pof.indexOf("\nexport ", start + 1));
    expect(body, "recordFundingReward must guard once-per-task with a redis set").toMatch(/sadd\(["']funding_rewarded["']/);
    expect(body, "recordFundingReward must skip points tasks and unfunded posts").toMatch(/rewardType === "points"/);
  });

  it("Inv 2: escrow release refuses a task claimed on-chain by a non-relayer (no payout hijack)", () => {
    // releasePayment pays the ON-CHAIN claimant. Anyone can call claimTask()
    // directly, so releaseEscrow must compare the claimant to the relayer and
    // bail if a third party (or a self-claiming runner) holds the claim — else it
    // pays them AND double-forwards to the recipient from the relayer's funds.
    const f = files.find((p) => p.endsWith(join("lib", "escrow.ts")));
    expect(f, "escrow.ts not found").toBeTruthy();
    const s = read(f!);
    const start = s.indexOf("export async function releaseEscrow");
    expect(start, "releaseEscrow not found").toBeGreaterThanOrEqual(0);
    const body = s.slice(start, s.indexOf("\nexport ", start + 1));
    expect(body, "releaseEscrow must compare the on-chain claimant against the relayer").toMatch(/relayer[\s\S]*claimant|claimant[\s\S]*relayer/);
  });

  it("Inv 5: feedback-tasks route gates unverified point minting (ownership + daily earn cap)", () => {
    // The endpoint awards points off a public `address` with no proof; without a
    // gate it minted ~120 pts/day/wallet across templates. It must enforce session
    // ownership AND cap the earn to once per wallet per day.
    const f = files.find((p) => p.endsWith(join("feedback-tasks", "route.ts")));
    expect(f, "feedback-tasks/route.ts not found").toBeTruthy();
    const s = read(f!);
    expect(s, "feedback-tasks must call ownershipError").toMatch(/ownershipError\(/);
    expect(s, "feedback-tasks must cap the daily earn (once-per-day earn lock)").toMatch(/earned:/);
  });
});
