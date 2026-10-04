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
// EVERY command is a dry run until --apply is added. That includes --undo.
//
//   node scripts/hide-item.mjs                                        list hidden items (read only)
//   node scripts/hide-item.mjs campaign <id> [--reason "..."]         dry run of a hide
//   node scripts/hide-item.mjs campaign <id> --reason "..." --apply   hide it
//   node scripts/hide-item.mjs task <id> --undo                       dry run of an undo
//   node scripts/hide-item.mjs task <id> --undo --apply               undo it
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
const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }

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
const [kind, id] = argv.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1));

if (!kind) {
  const ids = (await cmd("SMEMBERS", "campaign:company:published")) ?? [];
  for (const i of ids) {
    const d = parse(await cmd("GET", `campaign:draft:${i}`));
    if (d) console.log(`campaign ${i}  ${d.hiddenAt ? "HIDDEN " + d.hiddenAt : "visible"}  "${d.company}"  brief: ${d.brief}`);
  }
  process.exit(0);
}
if ((kind !== "task" && kind !== "campaign") || !id) {
  console.error("usage: hide-item.mjs <task|campaign> <id> [--reason \"...\"] [--undo] [--apply]");
  process.exit(2);
}

const backupKey = (key) => `hide:backup:${key}`;
const state = (d) => (d.hiddenAt ? `hidden (${d.hiddenReason ?? "no reason"})` : "visible");
let changedUnderUs = false;

// One record. Reads it, works out the new record, and (with --apply) writes it by
// compare-and-set. Returns the record as read, or null when there is none.
async function setHidden(key, label) {
  const raw = await cmd("GET", key);
  if (raw === null || raw === undefined) { console.error(`No ${label} at ${key}`); return null; }
  if (typeof raw !== "string") { console.error(`${key}: the store did not return the record as text, so it cannot be compared before a write. Nothing written.`); process.exit(1); }
  const d = JSON.parse(raw);
  const next = { ...d };
  let script = CAS_HIDE;
  let entry = "";

  if (UNDO) {
    if (!d.hiddenAt) { console.log(`${label} ${key}: already visible, nothing to undo`); return d; }
    script = CAS_UNDO;
    entry = (await cmd("LINDEX", backupKey(key), 0)) ?? "";
    delete next.hiddenAt;
    delete next.hiddenReason;
    if (entry) {
      const prior = JSON.parse(JSON.parse(entry).prior);
      if (prior.hiddenAt) { next.hiddenAt = prior.hiddenAt; next.hiddenReason = prior.hiddenReason; }
      console.log(`${label} ${key}: ${state(d)} -> ${state(next)}  (the state saved before the last hide)`);
    } else {
      console.log(`${label} ${key}: ${state(d)} -> visible  (no saved prior state: it was hidden before this script kept one)`);
    }
  } else {
    if (d.hiddenAt && d.hiddenReason === reason) { console.log(`${label} ${key}: already hidden for this reason, nothing to write`); return d; }
    next.hiddenAt = new Date().toISOString();
    next.hiddenReason = reason;
    entry = JSON.stringify({ at: next.hiddenAt, action: "hide", key, reason, prior: raw });
    console.log(`${label} ${key}: ${state(d)} -> ${state(next)}`);
  }

  if (APPLY) {
    const ok = await cmd("EVAL", script, "2", key, backupKey(key), raw, JSON.stringify(next), entry);
    if (ok !== 1) {
      changedUnderUs = true;
      console.error(`  NOT WRITTEN: ${key} changed between the read and the write (a claim, a proof or a cron). Nothing was lost. Run the same command again.`);
      return d;
    }
    const back = parse(await cmd("GET", key));
    console.log(`  written: hiddenAt=${back.hiddenAt ?? "none"}${UNDO ? "" : `  prior record saved in ${backupKey(key)}`}`);
  }
  return d;
}

if (kind === "task") {
  if (!(await setHidden(`task:${id}`, "task"))) process.exit(1);
} else {
  const pre = parse(await cmd("GET", `campaign:draft:${id}`));
  if (!pre) { console.error(`No campaign ${id}`); process.exit(1); }
  if (pre.status !== "published" && pre.status !== "publishing") { console.error(`${id} is a private draft, nothing public to hide`); process.exit(1); }
  const d = await setHidden(`campaign:draft:${id}`, "campaign");
  if (!d) process.exit(1);
  for (const tid of Object.values(d.pieceTaskIds ?? {})) await setHidden(`task:${tid}`, "  piece task");
}
if (changedUnderUs) process.exit(1);
if (!APPLY) console.log(`Dry run. Nothing was written. Add --apply to ${UNDO ? "undo" : "hide"}.`);
