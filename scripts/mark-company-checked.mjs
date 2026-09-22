#!/usr/bin/env node
// MARK A COMPANY CHECKED (T3, 2026-09-22). Oscar runs this by hand, after he has
// checked that a published campaign's company is real. Until then the campaign
// reads "Unverified company" everywhere it is shown.
//
// This is the ONLY writer of companyCheckedAt. No API route writes it, and the
// draft form never copies it from a request body (guarded in
// src/__tests__/campaign-drafts.test.ts). It moves no points and no money.
//
//   node scripts/mark-company-checked.mjs                list published campaigns
//   node scripts/mark-company-checked.mjs <id>           dry run for one campaign
//   node scripts/mark-company-checked.mjs <id> --apply   mark it checked
//   node scripts/mark-company-checked.mjs <id> --undo    mark it unverified again
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
const show = (d) => `${d.id}  ${d.companyCheckedAt ? "CHECKED " + d.companyCheckedAt : "unverified"}  "${d.company}"  link: ${d.productUrl ?? "none"}  brief: ${d.brief}`;

const id = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");

if (!id) {
  const ids = (await cmd("SMEMBERS", "campaign:company:published")) ?? [];
  for (const i of ids) { const d = parse(await cmd("GET", `campaign:draft:${i}`)); if (d) console.log(show(d)); }
  process.exit(0);
}

const key = `campaign:draft:${id}`;
const d = parse(await cmd("GET", key));
if (!d) { console.error(`No campaign ${id}`); process.exit(1); }
if (d.status !== "published" && d.status !== "publishing") { console.error(`${id} is a private draft, not a published campaign`); process.exit(1); }
console.log("before:", show(d));
const next = { ...d };
if (UNDO) delete next.companyCheckedAt; else next.companyCheckedAt = new Date().toISOString();
console.log("after: ", show(next));
if (!APPLY && !UNDO) { console.log("Dry run. Add --apply to write."); process.exit(0); }
await cmd("SET", key, JSON.stringify(next));
console.log("written:", show(parse(await cmd("GET", key))));
