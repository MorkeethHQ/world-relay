/**
 * Backfill rep:<address>.verificationLevel from the OWNING source (verified:<address>).
 *
 * Why this exists (2026-07-15): verify-proof/route.ts loaded `task` once at :138
 * and never reloaded it. On the direct-submit path (the app's only real flow in
 * practice: prod shows 5 task_claimed vs 649 proof_submitted) the task is still
 * `open`, so task.claimantVerification is null. :399 passed that stale null into
 * recordCompletion, so rep.verificationLevel was written as the "wallet" default
 * for every Orb human. Measured before the fix: 0 of 33 Orb wallets with a rep
 * record had verificationLevel === "orb". getTrustScore (reputation.ts:119) gives
 * orb a +0.3 levelBonus, so the leaderboard was mis-sorted for every Orb user.
 *
 * The route fix only corrects writes FROM NOW ON. SECURITY-INVARIANTS.md:51:
 * "A write-time invariant is retroactively false for existing data... MUST ship
 * with (a) a backfill that makes existing rows conform and (b) a count of how many
 * rows currently violate it." This is (a); it prints (b) before touching anything.
 *
 * `verified:<address>` is the OWNER of verification level (written by
 * verification-tier.ts from World's on-chain Address Book). rep.verificationLevel
 * is a downstream copy. This backfill only ever copies owner -> copy, never the
 * reverse, and never invents a level.
 *
 * Default is a DRY RUN (reports what it would change, writes nothing). Pass --live
 * to write.
 *
 *   npx tsx scripts/backfill-rep-verification.ts          # dry run
 *   npx tsx scripts/backfill-rep-verification.ts --live   # write
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import { Redis } from "@upstash/redis";

const LIVE = process.argv.includes("--live");
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

async function scanAll(redis: Redis, match: string): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 500 });
    cursor = String(next);
    keys.push(...(batch as string[]));
  } while (cursor !== "0");
  return keys;
}

async function main() {
  const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

  // 1. Read the OWNER of the fact.
  const vkeys = await scanAll(redis, "verified:*");
  if (vkeys.length === 0) {
    console.error("ABORT: zero verified:* keys. That is a wrong-key-pattern smell, not an empty store.");
    process.exit(1);
  }
  const truth = new Map<string, string>();
  for (const k of vkeys) {
    const raw = await redis.get(k);
    const d = raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as any)) : null;
    const lvl = d?.verificationLevel;
    if (lvl && lvl !== "wallet") truth.set(k.replace("verified:", ""), lvl);
  }
  console.log(`verified:* keys: ${vkeys.length}   non-wallet levels (the owner's truth): ${truth.size}`);

  // 2. Compare against the downstream copy.
  const drift: Array<{ addr: string; from: string; to: string }> = [];
  let missingRep = 0;
  let agreed = 0;
  for (const [addr, lvl] of truth) {
    const raw = await redis.get(`rep:${addr}`);
    if (!raw) { missingRep++; continue; }
    const rep = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    if (rep.verificationLevel === lvl) { agreed++; continue; }
    drift.push({ addr, from: String(rep.verificationLevel ?? "(unset)"), to: lvl });
  }

  // (b) the count of violating rows, printed BEFORE any write.
  console.log(`\n=== violating rows ===`);
  console.log(`  rep record agrees with owner : ${agreed}`);
  console.log(`  rep record DRIFTED           : ${drift.length}`);
  console.log(`  no rep record (nothing to fix): ${missingRep}`);
  for (const d of drift.slice(0, 40)) console.log(`   ${short(d.addr)}  ${d.from} -> ${d.to}`);
  if (drift.length > 40) console.log(`   ... +${drift.length - 40} more`);

  if (!drift.length) {
    console.log("\nNothing to backfill.");
    return;
  }
  if (!LIVE) {
    console.log(`\nDRY RUN. Nothing written. Re-run with --live to apply ${drift.length} update(s).`);
    return;
  }

  // 3. Write. Only the one field; never rewrite the whole record from a stale read.
  let written = 0;
  for (const d of drift) {
    const raw = await redis.get(`rep:${d.addr}`);
    if (!raw) continue; // re-read: it may have appeared/changed since the scan
    const rep = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    if (rep.verificationLevel === d.to) continue; // already fixed by a live write
    rep.verificationLevel = d.to;
    await redis.set(`rep:${d.addr}`, JSON.stringify(rep));
    written++;
  }
  console.log(`\nLIVE: updated ${written} reputation record(s).`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
