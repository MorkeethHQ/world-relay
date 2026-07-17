/**
 * Backfill rep.totalEarnedUsdc from what actually settled ON-CHAIN.
 *
 * Why this exists (2026-07-17): before 9060dda (Jul 4, "never render points as
 * USDC") recordCompletion did an unconditional
 *
 *     rep.totalEarnedUsdc += bountyUsdc;
 *
 * and a points task carries its POINTS value (0.5-10) in `bountyUsdc`. So every
 * points completion banked as dollars. 9060dda added the isFundedTask split and
 * fixed writes FROM THEN ON — with no backfill, so 13 days of bad rows are still
 * live. Measured before this ran: sum(rep.totalEarnedUsdc) = $299 against a
 * ceiling of $27 ever escrow-funded and $21 actually settled. One wallet reads
 * $150 (25x its real $6). Nothing renders the field, but /api/reputation spreads
 * the whole rep object (`...rep`), so prod serves the false number publicly.
 *
 * This is the third instance of one pattern (Jul 4 points-as-dollars, Jul 12
 * escrow bind, Jul 15 unlock): a correct write-time fix shipped without the data
 * migration SECURITY-INVARIANTS.md:51 requires. That rule exists BECAUSE of the
 * Jul 12 case and still did not catch this one.
 *
 * THE TRUTH SOURCE, and its KNOWN LIMITS (corrected after the first run, 2026-07-17):
 *   totalEarnedUsdc := gross bounty of settled tasks (task.settlementTx, receipt
 *                      verified on-chain here, not trusted from the stored hash)
 *                    + campaign unlock payouts (unlock:*:state:*.paid, verified same)
 * "Paid means settled" (CLAUDE.md, Invariant #2): a hash is not a payment until a
 * success receipt says so. A reverted or unresolvable tx is NOT counted.
 *
 * Two limits, measured, NOT hand-waved. This is GROSS-BOUNTY-SETTLED, not
 * "what reached the wallet" — an earlier version of this header claimed the latter
 * and was wrong:
 *   1. FEES. escrow.ts:296 forwards bounty MINUS feeRate+communityRate (5% live), so
 *      a $2 task lands $1.90 and a $1 task lands $0.95. This script books the gross
 *      bounty. Deliberate: "earned" = the bounty won, the fee is a disclosed cut.
 *   2. settlementTx IS LOSSY. Payments demonstrably happen without it being written
 *      (Jul 17: 3 tasks with no settlementTx were all already paid on-chain). So this
 *      UNDER-counts anyone whose settlement went unrecorded.
 * Net effect measured against the chain: this writes ~$21 where the real total to
 * wallets with rep records is ~$22.40. It errs CONSERVATIVE, which is the right way
 * to err for a number that previously read $299. The authoritative ledger is the
 * relayer's on-chain USDC transfers; reconcile against those, not against this.
 *
 * What this deliberately does NOT do: credit funded+passed tasks that never
 * settled ($3 across 3 real wallets as of today). Those people are genuinely owed
 * money, and the honest fix is to PAY them (they are invisible to the reconcile
 * cron, which only retries pendingRelease===true) — not to inflate a counter so
 * the books look settled. Crediting unpaid work here would recreate exactly the
 * "claims money that never moved" bug this script exists to undo.
 *
 * Writes ONE field, re-read immediately before the write, never a whole-record
 * rewrite from a stale scan. Dry run by default.
 *
 *   npx tsx scripts/backfill-earned-usdc.ts          # dry run
 *   npx tsx scripts/backfill-earned-usdc.ts --live   # write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import { Redis } from "@upstash/redis";
import type { Task } from "../src/lib/types";
import { getCampaign } from "../src/lib/campaigns";
import { getPayoutClients } from "../src/lib/escrow";

const LIVE = process.argv.includes("--live");
const short = (a: string) => `${a.slice(0, 8)}...${a.slice(-4)}`;
const isRealWallet = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const isTxHash = (h: unknown) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

async function scanAll(redis: Redis, match: string): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 1000 });
    cursor = String(next);
    keys.push(...(batch as string[]));
  } while (cursor !== "0");
  return keys;
}

async function main() {
  const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
  const clients = getPayoutClients();
  if (!clients) {
    console.error("ABORT: no chain client (XMTP_WALLET_KEY missing). This backfill must verify receipts.");
    process.exit(1);
  }

  // A hash is only money if its receipt says success. Cache: many tasks share none.
  const receiptCache = new Map<string, boolean>();
  async function txSucceeded(hash: string): Promise<boolean> {
    if (receiptCache.has(hash)) return receiptCache.get(hash)!;
    let ok = false;
    try {
      const r = await clients!.pub.getTransactionReceipt({ hash: hash as `0x${string}` });
      ok = r.status === "success";
    } catch {
      ok = false; // unresolvable => not proven paid => not counted
    }
    receiptCache.set(hash, ok);
    return ok;
  }

  const tkeys = await scanAll(redis, "task:*");
  if (tkeys.length === 0) {
    console.error("ABORT: zero task:* keys. Wrong-key-pattern smell, not an empty store.");
    process.exit(1);
  }
  const tasks: Task[] = [];
  for (const k of tkeys) {
    const raw = await redis.get(k);
    if (raw) tasks.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Task));
  }

  // ── Truth, part 1: settled task bounties ──────────────────────
  const truth = new Map<string, number>();
  const add = (w: string, n: number) => truth.set(w.toLowerCase(), (truth.get(w.toLowerCase()) || 0) + n);
  let settledCount = 0, rejectedTx = 0;
  for (const t of tasks) {
    if (!t.settlementTx || !t.claimant || !isRealWallet(t.claimant)) continue;
    if (!isTxHash(t.settlementTx)) { rejectedTx++; continue; }
    if (!(await txSucceeded(t.settlementTx))) { rejectedTx++; continue; }
    add(t.claimant, Number(t.bountyUsdc || 0));
    settledCount++;
  }

  // ── Truth, part 2: campaign unlock payouts ────────────────────
  let unlockCount = 0;
  for (const k of await scanAll(redis, "unlock:*:state:*")) {
    const raw = await redis.get(k);
    const st = raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as any)) : null;
    if (!st?.paid || !isTxHash(st.payTx)) continue;
    if (!(await txSucceeded(st.payTx))) { rejectedTx++; continue; }
    // key: unlock:{campaignId}:state:{wallet}
    const campaignId = k.split(":")[1];
    const wallet = k.split(":state:")[1];
    const amount = getCampaign(campaignId)?.unlock?.unlockAmount;
    if (!amount || !isRealWallet(wallet)) continue;
    add(wallet, amount);
    unlockCount++;
  }

  console.log(`=== backfill rep.totalEarnedUsdc ${LIVE ? "(LIVE)" : "(DRY RUN)"} ===`);
  console.log(`  tasks scanned            : ${tasks.length}`);
  console.log(`  settlements counted      : ${settledCount} (receipt-verified)`);
  console.log(`  unlock payouts counted   : ${unlockCount} (receipt-verified)`);
  console.log(`  tx rejected (bad/reverted/unresolvable): ${rejectedTx}`);
  console.log(`  wallets with real earnings: ${truth.size}, total $${[...truth.values()].reduce((a, b) => a + b, 0).toFixed(2)}`);

  // ── Compare against the stored copy ───────────────────────────
  const rkeys = await scanAll(redis, "rep:*");
  if (rkeys.length === 0) {
    console.error("ABORT: zero rep:* keys. Wrong-key-pattern smell.");
    process.exit(1);
  }
  const drift: Array<{ key: string; addr: string; from: number; to: number }> = [];
  let agreed = 0;
  for (const k of rkeys) {
    const raw = await redis.get(k);
    if (!raw) continue;
    const rep = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    const addr = String(rep.address ?? k.replace("rep:", ""));
    const to = truth.get(addr.toLowerCase()) || 0;
    const from = Number(rep.totalEarnedUsdc || 0);
    if (from === to) { agreed++; continue; }
    drift.push({ key: k, addr, from, to });
  }

  // (b) the count of violating rows, printed BEFORE any write.
  console.log(`\n=== violating rows ===`);
  console.log(`  rep agrees with on-chain : ${agreed}`);
  console.log(`  rep DRIFTED              : ${drift.length}`);
  const phantom = drift.reduce((a, d) => a + (d.from - d.to), 0);
  console.log(`  phantom dollars to remove: $${phantom.toFixed(2)}`);
  for (const d of drift.sort((a, b) => b.from - a.from).slice(0, 30)) {
    console.log(`   ${short(d.addr)}  $${String(d.from).padEnd(7)} -> $${String(d.to).padEnd(6)} (phantom $${(d.from - d.to).toFixed(2)})`);
  }
  if (drift.length > 30) console.log(`   ... +${drift.length - 30} more`);

  const increases = drift.filter((d) => d.to > d.from);
  if (increases.length) {
    console.log(`\n  NOTE: ${increases.length} record(s) would go UP — on-chain money the app never credited:`);
    for (const d of increases) console.log(`   ${short(d.addr)}  $${d.from} -> $${d.to}`);
  }

  if (!drift.length) { console.log("\nNothing to backfill."); return; }
  if (!LIVE) {
    console.log(`\nDRY RUN. Nothing written. Re-run with --live to correct ${drift.length} record(s).`);
    return;
  }

  // ── Write. One field, re-read first. ──────────────────────────
  let written = 0;
  for (const d of drift) {
    const raw = await redis.get(d.key);
    if (!raw) continue; // may have vanished since the scan
    const rep = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    if (Number(rep.totalEarnedUsdc || 0) === d.to) continue; // already correct via a live write
    rep.totalEarnedUsdc = d.to;
    await redis.set(d.key, JSON.stringify(rep));
    written++;
  }
  console.log(`\nLIVE: corrected ${written} reputation record(s). Removed $${phantom.toFixed(2)} of phantom USDC.`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
