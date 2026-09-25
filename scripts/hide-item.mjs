#!/usr/bin/env node
// HIDE AN ITEM (R16, 2026-09-25). The operator's moderation state. Oscar runs this
// by hand. It sets `hiddenAt` (and `hiddenReason`) on a stored record. It never
// deletes anything: the record, its history and its results stay in the store,
// and --undo puts it back exactly as it was.
//
// What hidden means:
//   task      leaves GET /api/tasks and the board (isPublicTask, isBoardVisible).
//   campaign  leaves GET /api/campaigns/company, and its detail route answers 404.
//             Its piece tasks are hidden with it, so no piece is left behind.
//
// This is the ONLY writer of hiddenAt. No API route writes it (guarded in
// src/__tests__/lead-card.test.ts). It moves no points and no money.
//
//   node scripts/hide-item.mjs                                   list hidden items
//   node scripts/hide-item.mjs campaign <id> [--reason "..."]    dry run
//   node scripts/hide-item.mjs campaign <id> --apply             hide it
//   node scripts/hide-item.mjs task <id> --undo                  show it again
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN.
const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }

async function cmd(...args) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${args[0]} ${r.status}`);
  return (await r.json()).result;
}
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

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
  console.error("usage: hide-item.mjs <task|campaign> <id> [--reason \"...\"] [--apply|--undo]");
  process.exit(2);
}

// Read, change one field pair, write back. Nothing else in the record changes.
async function setHidden(key, label) {
  const d = parse(await cmd("GET", key));
  if (!d) { console.error(`No ${label} at ${key}`); return null; }
  const next = { ...d };
  if (UNDO) { delete next.hiddenAt; delete next.hiddenReason; }
  else { next.hiddenAt = new Date().toISOString(); next.hiddenReason = reason; }
  console.log(`${label} ${key}: ${d.hiddenAt ? "hidden" : "visible"} -> ${UNDO ? "visible" : "hidden"}`);
  if (APPLY || UNDO) {
    await cmd("SET", key, JSON.stringify(next));
    const back = parse(await cmd("GET", key));
    console.log(`  written: hiddenAt=${back.hiddenAt ?? "none"}`);
  }
  return d;
}

if (kind === "task") {
  await setHidden(`task:${id}`, "task");
} else {
  const pre = parse(await cmd("GET", `campaign:draft:${id}`));
  if (!pre) { console.error(`No campaign ${id}`); process.exit(1); }
  if (pre.status !== "published" && pre.status !== "publishing") { console.error(`${id} is a private draft, nothing public to hide`); process.exit(1); }
  const d = await setHidden(`campaign:draft:${id}`, "campaign");
  if (!d) process.exit(1);
  for (const tid of Object.values(d.pieceTaskIds ?? {})) await setHidden(`task:${tid}`, "  piece task");
}
if (!APPLY && !UNDO) console.log("Dry run. Add --apply to write, or --undo to show again.");
