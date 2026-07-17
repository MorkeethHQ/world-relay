/**
 * Backfill the campaign-unlock payouts the stale-claimantVerification bug never paid.
 *
 * Why this exists (2026-07-17): 0dffe41 fixed verify-proof/route.ts passing a stale
 * `task.claimantVerification` (null on the direct-submit path) into
 * recordCampaignCompletion. The Orb gate therefore returned `none` BEFORE writing
 * progress, so the unlock never fired once: prod shows `unlock:*` = 0 keys. The
 * route fix only corrects submissions FROM NOW ON. SECURITY-INVARIANTS.md:51: a
 * write-time invariant is retroactively false for existing data, so the fix ships
 * with a backfill or the money owed before the fix stays unpaid forever.
 *
 * Method: REPLAY the stored tasks through recordCampaignCompletion — the same
 * audited path a live submission takes. This is deliberate. A hand-rolled USDC
 * transfer loop would bypass the four guards that make this path safe:
 *   - the clean gate (verdict pass + Orb + real wallet)
 *   - the pot HARD cap (slot reserved before send, so the pot can't overdraw)
 *   - per-wallet idempotency (state.paid + maxCountedPerUser=1 -> one unlock each)
 *   - the double-pay guard (resolve any prior broadcast before re-sending)
 * The stored task rows already carry the truth (`claimantVerification: "orb"` was
 * persisted by b84d349); only the unlock's copy was stale. So replaying the rows
 * reproduces exactly what should have happened, with no invented facts.
 *
 * Ordering: tasks are replayed oldest-first by createdAt, so if the pot ever does
 * bind, the slots go first-come-first-unlocked — the rule the campaign publicly
 * advertises ("First come, first unlocked — the pot covers 5 humans").
 *
 * Counted 2026-07-17 against prod: 6 clean tasks, but only 4 DISTINCT wallets
 * (0x3648 and 0x24fc each posted 2 clean tasks). maxCountedPerUser=1 means one $2
 * unlock per wallet: 4 x $2 = $8 against a $10 pot. Paying "6 x $2" would have
 * double-paid two people and overdrawn the pot.
 *
 * Default is a DRY RUN (reports, writes nothing, sends nothing). Pass --live.
 *
 *   npx tsx scripts/backfill-unlock-payouts.ts          # dry run
 *   npx tsx scripts/backfill-unlock-payouts.ts --live   # send real USDC
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import { Redis } from "@upstash/redis";
import { formatUnits } from "viem";
import type { Task } from "../src/lib/types";
import { getCampaign } from "../src/lib/campaigns";
import { recordCampaignCompletion } from "../src/lib/campaign-unlock";
import { getPayoutClients, USDC_ADDRESS } from "../src/lib/escrow";

const CAMPAIGN_ID = "say-it-out-loud";
const LIVE = process.argv.includes("--live");
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const isRealWallet = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

const BALANCE_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }],
}] as const;

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
  const campaign = getCampaign(CAMPAIGN_ID);
  if (!campaign?.unlock) throw new Error(`${CAMPAIGN_ID} has no unlock config`);
  const { pot, unlockAmount } = campaign.unlock;

  // 1. Read the tasks (the OWNER of who completed what).
  const keys = await scanAll(redis, "task:*");
  if (keys.length === 0) {
    console.error("ABORT: zero task:* keys. Wrong-key-pattern smell, not an empty store.");
    process.exit(1);
  }
  const tasks: Task[] = [];
  for (const k of keys) {
    const raw = await redis.get(k);
    if (raw) tasks.push(typeof raw === "string" ? JSON.parse(raw) : (raw as Task));
  }
  const campaignTasks = tasks.filter((t) => t.campaignId === CAMPAIGN_ID);
  if (campaignTasks.length === 0) {
    console.error(`ABORT: zero ${CAMPAIGN_ID} tasks among ${tasks.length}. Wrong-key smell.`);
    process.exit(1);
  }

  // 2. Apply the SAME clean gate recordCampaignCompletion applies, so the dry run
  //    reports exactly what the live run will do (dry run must not write).
  const clean = campaignTasks
    .filter((t) => t.verificationResult?.verdict === "pass")
    .filter((t) => t.claimantVerification === "orb")
    .filter((t) => t.claimant && isRealWallet(t.claimant))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // first come, first unlocked

  // One unlock per wallet (maxCountedPerUser=1): dedupe to the EARLIEST clean task.
  const firstByWallet = new Map<string, Task>();
  for (const t of clean) {
    const w = t.claimant!.toLowerCase();
    if (!firstByWallet.has(w)) firstByWallet.set(w, t);
  }

  console.log(`=== ${CAMPAIGN_ID} unlock backfill ${LIVE ? "(LIVE)" : "(DRY RUN)"} ===`);
  console.log(`  campaign tasks           : ${campaignTasks.length}`);
  console.log(`  clean (pass + orb + real): ${clean.length} task(s)`);
  console.log(`  DISTINCT wallets owed    : ${firstByWallet.size}  <- one $${unlockAmount} unlock each`);
  console.log(`  pot                      : $${pot} (covers ${Math.floor(pot / unlockAmount)})`);

  // 3. (b) the count of violating rows, printed BEFORE any write.
  const paidCount = Number((await redis.get(`unlock:${CAMPAIGN_ID}:paidCount`)) || 0);
  let owed = 0;
  console.log(`\n=== per-wallet state (reserved slots so far: ${paidCount}) ===`);
  for (const [w, t] of firstByWallet) {
    const raw = await redis.get(`unlock:${CAMPAIGN_ID}:state:${w}`);
    const st = raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as any)) : null;
    const status = st?.paid ? `PAID (${st.payTx})` : st?.reserved ? "reserved, unpaid" : "no state -> OWED";
    if (!st?.paid) owed++;
    console.log(`  ${short(w)}  task=${t.id.slice(0, 8)}  ${t.createdAt}  ${status}`);
  }
  console.log(`\n  wallets still owed: ${owed}  -> $${owed * unlockAmount} USDC`);

  // 4. Funds check against the real relayer, before promising anything.
  const clients = getPayoutClients();
  if (!clients) {
    console.error("ABORT: no payout clients (XMTP_WALLET_KEY missing).");
    process.exit(1);
  }
  const relayer = clients.wallet.account.address;
  const bal = (await clients.pub.readContract({
    address: USDC_ADDRESS, abi: BALANCE_ABI, functionName: "balanceOf", args: [relayer],
  })) as bigint;
  const balUsdc = Number(formatUnits(bal, 6));
  console.log(`  relayer ${short(relayer)} holds $${balUsdc} USDC -> covers $${owed * unlockAmount}: ${balUsdc >= owed * unlockAmount}`);
  if (owed > 0 && balUsdc < owed * unlockAmount) {
    console.error("ABORT: relayer cannot cover what is owed. Top up before running --live.");
    process.exit(1);
  }

  if (owed === 0) {
    console.log("\nNothing to backfill.");
    return;
  }
  if (!LIVE) {
    console.log(`\nDRY RUN. Nothing written, no USDC sent. Re-run with --live to pay ${owed} wallet(s).`);
    return;
  }

  // 5. Replay through the audited path. recordCampaignCompletion writes progress,
  //    enforces the pot cap, and is idempotent per wallet.
  console.log(`\n=== LIVE: replaying ${firstByWallet.size} task(s) oldest-first ===`);
  const results: Array<{ wallet: string; tx: string | null }> = [];
  for (const [w, t] of firstByWallet) {
    const res = await recordCampaignCompletion(t);
    console.log(`  ${short(w)}  counted=${res.counted}  unlockTx=${res.unlockTx ?? "(none)"}`);
    results.push({ wallet: w, tx: res.unlockTx });
  }

  // 6. Verify every payout on-chain. A hash is not a payment until the receipt says so.
  console.log(`\n=== on-chain verification ===`);
  let lastBlock = 0n;
  for (const { wallet, tx } of results) {
    const raw = await redis.get(`unlock:${CAMPAIGN_ID}:state:${wallet}`);
    const st = raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as any)) : null;
    const hash = tx ?? st?.payTx;
    if (!hash) {
      console.log(`  ${short(wallet)}  NO TX (check unlock:retry / pot)`);
      continue;
    }
    try {
      const rcpt = await clients.pub.getTransactionReceipt({ hash: hash as `0x${string}` });
      if (rcpt.blockNumber > lastBlock) lastBlock = rcpt.blockNumber;
      console.log(`  ${short(wallet)}  ${rcpt.status.toUpperCase().padEnd(8)} block=${rcpt.blockNumber}  ${hash}`);
    } catch {
      console.log(`  ${short(wallet)}  UNRESOLVED (may still mine) ${hash}`);
    }
  }
  // Pin the closing read to the last payout's block. A plain "latest" read can be
  // served from state that predates the final transfer, which reports a balance
  // that looks like a payout went missing (observed on the 2026-07-17 run: it
  // printed $5.06 mid-settle, while the true post-run balance was $3.06).
  const after = (await clients.pub.readContract({
    address: USDC_ADDRESS, abi: BALANCE_ABI, functionName: "balanceOf", args: [relayer],
    ...(lastBlock > 0n ? { blockNumber: lastBlock } : {}),
  })) as bigint;
  const afterUsdc = Number(formatUnits(after, 6));
  const spent = Number((balUsdc - afterUsdc).toFixed(2));
  const expected = Number((owed * unlockAmount).toFixed(2));
  console.log(`\n  relayer USDC: $${balUsdc} -> $${afterUsdc}  (spent $${spent}, expected $${expected})`);
  if (spent !== expected) {
    console.error(`  WARNING: spend does not match the ${owed} unlock(s) owed. Investigate before re-running.`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
