#!/usr/bin/env node
// MARK ONE ACCEPTED PIECE PAID OR FAILED (2026-09-27). An operator runs this by
// hand after reading the USDC transfer to the participant on World Chain. This
// script moves no money. It records what the operator read. No HTTP route can
// write "paid"; this script is the only writer.
//
//   node scripts/mark-piece-paid.mjs <campaignId> <resultId> <txHash>          dry run
//   node scripts/mark-piece-paid.mjs <campaignId> <resultId> <txHash> --apply
//   node scripts/mark-piece-paid.mjs <campaignId> <resultId> --failed --apply
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN. Refuses unless the pool itself is
// recorded paid (campaign:funding:<id>, written by mark-campaign-paid.mjs).
//
// HELD FOR OSCAR: which wallet sends the payout, under what custody, and the fee.
// The script does not know or choose them. It records a hash he already read.
//
// Local test run: point KV at scripts/local-kv.mjs and use a hash that reads as
// test on sight, e.g. 0x + "7e57" repeated 16 times.

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }

async function cmd(...args) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${args[0]} ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FAILED = argv.includes("--failed");
const [campaignId, resultId, txHash] = argv.filter((a) => !a.startsWith("--"));
if (!campaignId || !resultId || (!FAILED && !txHash)) {
  console.error("Usage: node scripts/mark-piece-paid.mjs <campaignId> <resultId> <txHash> [--apply] | <campaignId> <resultId> --failed [--apply]");
  process.exit(1);
}
if (!FAILED && !TX_RE.test(txHash)) { console.error("That is not a transaction hash."); process.exit(1); }

const funding = parse(await cmd("get", `campaign:funding:${campaignId}`));
if (!funding) { console.error("The pool is not recorded as funded. Nothing can be paid from it."); process.exit(1); }

const key = `campaign:payout:${campaignId}`;
const payout = parse(await cmd("hget", key, resultId));
if (!payout) { console.error("No such payout."); process.exit(1); }
if (payout.status === "paid") { console.error("This piece is already paid."); process.exit(1); }

console.log(`Pool funded: tx ${funding.txHash}, ${funding.amountUsdc} USDC.`);
console.log(`Payout ${resultId}: ${payout.amountUsdc} USDC to ${payout.participant}, status ${payout.status}${payout.reason ? ` (${payout.reason})` : ""}${payout.test ? ", TEST record" : ""}.`);

const now = new Date().toISOString();
const next = FAILED
  ? { ...payout, status: "failed", reason: "payout_failed", failedAt: now }
  : { ...payout, status: "paid", reason: undefined, paidAt: now, paidTxHash: txHash };

if (!APPLY) {
  console.log(`DRY RUN. Would write: ${JSON.stringify(next)}`);
  console.log("Re-run with --apply to record it.");
  process.exit(0);
}

if (!FAILED) {
  const added = await cmd("sadd", "campaign:payout:txs", txHash.toLowerCase());
  if (Number(added) !== 1) { console.error("This transaction is already used for a payout."); process.exit(1); }
}
await cmd("hset", key, resultId, JSON.stringify(next));
const address = await cmd("hget", `campaign:company:result-address:${campaignId}`, resultId);
if (address) {
  const notif = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: address,
    type: FAILED ? "proof_rejected" : "payment_released",
    title: FAILED ? "Payment failed" : "Paid",
    body: FAILED
      ? `The ${payout.amountUsdc} USDC transfer for your piece did not go through. FAVOUR will retry.`
      : `${payout.amountUsdc} USDC for your piece was sent. Tx ${txHash.slice(0, 10)}…`,
    taskId: payout.taskId,
    read: false,
    createdAt: now,
  };
  await cmd("lpush", `notifications:${address}`, JSON.stringify(notif));
  await cmd("ltrim", `notifications:${address}`, 0, 49);
  console.log(`In-app notification written for ${address}. Push: not sent by this script.`);
}
console.log(`Recorded: ${JSON.stringify(next)}`);
