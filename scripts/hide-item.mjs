#!/usr/bin/env node
// HIDE AN ITEM (R16, 2026-09-25). The operator's moderation state. Oscar runs this
// by hand. It sets `hiddenAt` (and `hiddenReason`) on a stored record. It never
// deletes anything: the record, its history and its results stay in the store.
//
// What hidden means:
//   task      leaves GET /api/tasks and the board (isPublicTask, isBoardVisible).
//   campaign  leaves GET /api/campaigns/company, and its detail route answers 404.
//             Its piece tasks are hidden with it, so no piece is left behind.
//
// This is the ONLY writer of hiddenAt. No API route writes it (guarded in
// src/__tests__/lead-card.test.ts). It moves no points and no money.
//
// EVERY command is a dry run until --apply is added. That includes --undo. And
// --apply does nothing without --confirm <code>, where the code is printed by the
// dry run of the same command and changes when the records change.
//
//   node scripts/hide-item.mjs                                                       list hidden items (read only)
//   node scripts/hide-item.mjs campaign <id> --reason "..."                          dry run of a hide, prints a code
//   node scripts/hide-item.mjs campaign <id> --reason "..." --apply --confirm <code>   hide it
//   node scripts/hide-item.mjs task <id> --undo                                      dry run of an undo, prints a code
//   node scripts/hide-item.mjs task <id> --undo --apply --confirm <code>             undo it
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN.
//
// REWRITTEN 2026-10-05 after a cold walk found four faults in the first version:
//   1. --undo wrote at once, with no --apply.
//   2. Nothing was saved before a write, so there was nothing to restore from.
//   3. Undo always made the item visible. An item that had been hidden earlier for
//      another reason came back visible.
//   4. Hide and undo were a GET followed by a SET of the whole record. A claim, a
//      proof or a cron write landing in between was overwritten and lost.
//
// What it does now:
//   - Before a hide writes, the exact prior record is saved to the list
//     hide:backup:<key>, newest first.
//   - The write is a compare-and-set that runs inside the store: it happens only
//     if the record is still byte for byte what this script read. If anything
//     changed in between, NOTHING is written, the script exits 1, and you run it
//     again.
//   - Undo puts back exactly the hidden state from the newest saved record (hidden
//     with its old time and reason, or visible), and only those two fields. Every
//     other field keeps its current value, so a claim made after the hide survives.
//   - Hiding an item that is already hidden for the same reason writes nothing, so
//     a campaign hide that stopped part way can be run again.
//
// What it still cannot do: a campaign and its pieces are separate records, so a
// campaign hide is not one atomic step. If it exits 1 part way, run it again.
import { storeLine, issueCode, redeemCode, REFUSAL } from "./confirm-code.mjs";

const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }
// The first line of every run names the store, before anything can go wrong.
console.log(await storeLine(U));

async function cmd(...args) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${args[0]} ${r.status}`);
  return (await r.json()).result;
}
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

// Compare-and-set, run by the store in one step. KEYS[1] the record, KEYS[2] its
// backup list. ARGV[1] the record exactly as read, ARGV[2] the new record,
// ARGV[3] the backup entry. Returns 1 when written, 0 when the record had changed.
const CAS_HIDE = `-- hide-item:cas-hide
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
// Same, for undo. ARGV[3] is the backup entry the undo was computed from ('' when
// there is none). It must still be the newest entry, and it is removed in the same step.
const CAS_UNDO = `-- hide-item:cas-undo
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[3] ~= '' then
  if redis.call('LINDEX', KEYS[2], 0) ~= ARGV[3] then return 0 end
  redis.call('LPOP', KEYS[2])
end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const UNDO = argv.includes("--undo");
const ri = argv.indexOf("--reason");
const reason = ri >= 0 ? argv[ri + 1] : "operator: spam or not completable";
const ciEarly = argv.indexOf("--confirm");
const positional = argv.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1) && !(ciEarly >= 0 && i === ciEarly + 1));
// Anything left over is a mistake, for example the words of a pasted comment in
// a shell that does not treat # as one. Refuse it instead of guessing.
if (positional.length > 2 || argv.some((a) => a.startsWith("--") && !["--apply", "--undo", "--reason", "--confirm"].includes(a))) {
  console.error(`unexpected argument(s): ${[...positional.slice(2), ...argv.filter((a) => a.startsWith("--") && !["--apply", "--undo", "--reason", "--confirm"].includes(a))].join(" ")}\nusage: hide-item.mjs [<task|campaign> <id> [--reason "..."] [--undo] [--apply --confirm <code>]]\nNothing was read or written.`);
  process.exit(2);
}
const [kind, id] = positional;
// --apply with no code is refused here, before anything is read from the store.
if (argv.includes("--apply") && !(ciEarly >= 0 && argv[ciEarly + 1])) {
  console.error(REFUSAL);
  process.exit(2);
}

if (!kind) {
  const ids = (await cmd("SMEMBERS", "campaign:company:published")) ?? [];
  for (const i of ids) {
    const d = parse(await cmd("GET", `campaign:draft:${i}`));
    if (d) console.log(`campaign ${i}  ${d.hiddenAt ? "HIDDEN " + d.hiddenAt : "visible"}  "${d.company}"  brief: ${d.brief}`);
  }
  process.exit(0);
}
if ((kind !== "task" && kind !== "campaign") || !id) {
  console.error("usage: hide-item.mjs [<task|campaign> <id> [--reason \"...\"] [--undo] [--apply --confirm <code>]]");
  process.exit(2);
}

const backupKey = (key) => `hide:backup:${key}`;
const state = (d) => (d.hiddenAt ? `hidden (${d.hiddenReason ?? "no reason"})` : "visible");
const ci = argv.indexOf("--confirm");
const confirm = ci >= 0 ? argv[ci + 1] : undefined;

// PLAN one record: read it and work out the new record. Writes nothing.
// Returns null when there is no record, or { key, label, raw, d, next, script, entry, note, write }.
async function plan(key, label) {
  const raw = await cmd("GET", key);
  if (raw === null || raw === undefined) { console.error(`No ${label} at ${key}`); return null; }
  if (typeof raw !== "string") { console.error(`${key}: the store did not return the record as text, so it cannot be compared before a write. Nothing written.`); process.exit(1); }
  const d = JSON.parse(raw);
  const next = { ...d };
  const p = { key, label, raw, d, next, script: CAS_HIDE, entry: "", write: true, note: "" };

  if (UNDO) {
    if (!d.hiddenAt) { p.write = false; p.note = `${label} ${key}: already visible, nothing to undo`; return p; }
    p.script = CAS_UNDO;
    p.entry = (await cmd("LINDEX", backupKey(key), 0)) ?? "";
    delete next.hiddenAt;
    delete next.hiddenReason;
    if (p.entry) {
      const prior = JSON.parse(JSON.parse(p.entry).prior);
      if (prior.hiddenAt) { next.hiddenAt = prior.hiddenAt; next.hiddenReason = prior.hiddenReason; }
      p.note = `${label} ${key}: ${state(d)} -> ${state(next)}  (the state saved before the last hide)`;
    } else {
      p.note = `${label} ${key}: ${state(d)} -> visible  (no saved prior state: it was hidden before this script kept one)`;
    }
  } else {
    if (d.hiddenAt && d.hiddenReason === reason) { p.write = false; p.note = `${label} ${key}: already hidden for this reason, nothing to write`; return p; }
    next.hiddenAt = new Date().toISOString();
    next.hiddenReason = reason;
    p.entry = JSON.stringify({ at: next.hiddenAt, action: "hide", key, reason, prior: raw });
    p.note = `${label} ${key}: ${state(d)} -> ${state(next)}`;
  }
  return p;
}

// The whole plan first: every record this command would touch.
const plans = [];
if (kind === "task") {
  const p = await plan(`task:${id}`, "task");
  if (!p) process.exit(1);
  plans.push(p);
} else {
  const pre = parse(await cmd("GET", `campaign:draft:${id}`));
  if (!pre) { console.error(`No campaign ${id}`); process.exit(1); }
  if (pre.status !== "published" && pre.status !== "publishing") { console.error(`${id} is a private draft, nothing public to hide`); process.exit(1); }
  const c = await plan(`campaign:draft:${id}`, "campaign");
  if (!c) process.exit(1);
  plans.push(c);
  for (const tid of Object.values(c.d.pieceTaskIds ?? {})) {
    const p = await plan(`task:${tid}`, "  piece task");
    if (p) plans.push(p);
  }
}
// The plan is shown by the dry run. An apply prints it only after its code was accepted.
if (!APPLY) for (const p of plans) console.log(p.note);

// THE CONFIRM CODE. A write needs --apply AND --confirm <code>. The code is printed
// only by the dry run of the same command against the same store, and it is tied
// to the action, the reason and the exact records that dry run read; see
// scripts/confirm-code.mjs. A block of commands pasted whole cannot hide or undo
// anything, and a code from a rehearsal store does nothing on another store.
const what = ["hide-item", kind, id, UNDO ? "undo" : "hide", UNDO ? "" : reason, plans.map((p) => [p.key, p.raw, p.write])];
const toWrite = plans.filter((p) => p.write);

if (!APPLY) {
  console.log(`Dry run. Nothing was written. ${toWrite.length} record(s) would change.`);
  if (toWrite.length > 0) {
    console.log(`To ${UNDO ? "undo" : "hide"}, on this store, run the same command again with: --apply --confirm ${issueCode(U, what)}`);
    console.log("The code works once, for 30 minutes, on this store only, and only while these records are unchanged.");
  }
  process.exit(0);
}
if (!redeemCode(U, what, confirm)) {
  console.error(REFUSAL);
  process.exit(2);
}

for (const p of plans) console.log(p.note);
let changedUnderUs = false;
for (const p of toWrite) {
  const ok = await cmd("EVAL", p.script, "2", p.key, backupKey(p.key), p.raw, JSON.stringify(p.next), p.entry);
  if (ok !== 1) {
    changedUnderUs = true;
    console.error(`  NOT WRITTEN: ${p.key} changed between the read and the write (a claim, a proof or a cron). Nothing was lost. Run the dry run again.`);
    continue;
  }
  const back = parse(await cmd("GET", p.key));
  console.log(`  written ${p.key}: hiddenAt=${back.hiddenAt ?? "none"}${UNDO ? "" : `  prior record saved in ${backupKey(p.key)}`}`);
}
if (changedUnderUs) process.exit(1);
