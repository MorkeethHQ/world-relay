#!/usr/bin/env node
// BACKFILL the per-person completion record from the completion log (2026-09-21).
//
// WHY. The record in lib/completions.ts (completed_claimants:<taskId>,
// contributions:<addr>) only exists for passes from PR 16 on. A pass before that
// left no trace of WHO completed a multi-completion favour, because completeTask
// resets it. So a person who did today's mission before PR 16 was still offered it,
// and the one-pass guard could not stop a second pass (observed: one wallet passed
// the mission at 05:08Z and again at 17:08Z).
//
// SOURCE OF TRUTH. verify-proof logs `loop_complete` {taskId, submitter} on every
// AI-verified pass, into the capped events:log. That is the authoritative record of
// who passed which favour, as far back as the log window reaches.
//
// WHAT IT WRITES, and nothing else:
//   SADD  completed_claimants:<taskId> <wallet>   (the guard and the done state)
//   LPUSH contributions:<wallet> <row>            (History "Yours"), marked recovered
// Only for multi-completion favours, only for (task, wallet) pairs not already
// recorded. No points, no money, no task is touched. Every key written is saved to a
// receipt file so the backfill can be undone exactly.
//
// Dry run by default. --apply writes. Needs KV_REST_API_URL and KV_REST_API_TOKEN.
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }

async function cmd(...args) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${args[0]} ${r.status}`);
  return (await r.json()).result;
}

const WALLET = /^0x[0-9a-fA-F]{40}$/;
const log = await cmd("LRANGE", "events:log", "0", "4999");
const passes = new Map(); // key task|wallet -> earliest ts
let oldest = null;
for (const raw of log) {
  let e; try { e = JSON.parse(raw); } catch { continue; }
  if (e.ts && (!oldest || e.ts < oldest)) oldest = e.ts;
  if (e.event !== "loop_complete" || !e.taskId || !WALLET.test(e.submitter || "")) continue;
  const k = `${e.taskId}|${e.submitter.toLowerCase()}`;
  if (!passes.has(k) || e.ts < passes.get(k)) passes.set(k, e.ts);
}

const taskCache = new Map();
async function task(id) {
  if (!taskCache.has(id)) {
    const raw = await cmd("GET", `task:${id}`);
    taskCache.set(id, raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);
  }
  return taskCache.get(id);
}

const plan = [];
for (const [k, ts] of passes) {
  const [taskId, wallet] = k.split("|");
  const t = await task(taskId);
  if (!t || !(t.maxCompletions > 1)) continue; // single-completion favours keep their claimant
  const already = await cmd("SISMEMBER", `completed_claimants:${taskId}`, wallet);
  if (already === 1) continue;
  const points = t.rewardType === "points" ? Math.min(Math.max(Math.round(t.bountyUsdc), 1), 25) : 0;
  const row = {
    taskId,
    description: String(t.description || "").slice(0, 279),
    points,
    streakBonus: 0,
    proofImageUrl: null,
    proofNote: null,
    campaignId: t.campaignId ?? t.companyCampaignId ?? null,
    campaignLabel: null,
    at: ts,
    recovered: true, // from the completion log: the favour's points; any streak bonus was not logged
  };
  plan.push({ taskId, wallet, ts, row });
}

console.log(`log window: ${log.length} events, oldest ${oldest}`);
console.log(`passes on multi-completion favours missing a record: ${plan.length}`);
for (const p of plan) console.log(`  ${p.ts}  ${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}  ${p.taskId.slice(0, 8)}  +${p.row.points} pts`);

if (!APPLY) { console.log("DRY RUN. Nothing written. Re-run with --apply."); process.exit(0); }

const written = [];
for (const p of plan.sort((a, b) => a.ts.localeCompare(b.ts))) {
  const added = await cmd("SADD", `completed_claimants:${p.taskId}`, p.wallet);
  if (added !== 1) continue; // someone recorded it meanwhile
  await cmd("LPUSH", `contributions:${p.wallet}`, JSON.stringify(p.row));
  await cmd("LTRIM", `contributions:${p.wallet}`, "0", "49");
  written.push({ set: `completed_claimants:${p.taskId}`, member: p.wallet, list: `contributions:${p.wallet}`, row: p.row });
}
const receipt = `backfill-completions-receipt-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), written }, null, 2));
console.log(`APPLIED ${written.length}. Undo receipt: ${receipt}`);
