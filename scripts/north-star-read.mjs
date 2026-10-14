#!/usr/bin/env node
// Run by Oscar:  node scripts/north-star-read.mjs <path to .env.local> scripts/claim-and-release.ts
// READ-ONLY north star read from the production store, 14 Oct 2026.
// Allowed commands: SCAN, LRANGE, SMEMBERS, GET. Exclusions: NORTH_STAR_EXCLUDE plus OSCAR_WORLD_APP. Prints counts only: no key, no wallet, no secret.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const URL_ = env.KV_REST_API_URL, TOKEN = env.KV_REST_API_TOKEN;
const READ = new Set(["SCAN", "LRANGE", "SMEMBERS", "GET"]);
async function cmd(...a) { if (!READ.has(a[0])) throw new Error("refused: " + a[0]); const r = await fetch(URL_, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(a) }); const j = await r.json(); if (j.error) throw new Error(a[0] + " " + j.error); return j.result; }
async function scan(match) { let c = "0", out = []; do { const [n, keys] = await cmd("SCAN", c, "MATCH", match, "COUNT", 500); out.push(...keys); c = String(n); } while (c !== "0"); return out; }
const OSCAR = readFileSync(process.argv[3], "utf8").match(/OSCAR_WORLD_APP = "(0x[0-9a-fA-F]{40})"/)[1].toLowerCase();
// No wallet is written here: the operator and Oscar's other wallets come from
// NORTH_STAR_EXCLUDE (in the env file, or in the shell), as on the server.
const EXCLUDE = new Set(String(process.env.NORTH_STAR_EXCLUDE ?? env.NORTH_STAR_EXCLUDE ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean));
EXCLUDE.add(OSCAR);
if (EXCLUDE.size < 2) console.log("WARNING: NORTH_STAR_EXCLUDE is not set, so the operator wallet counts as outside. Set it and run again.");
const out = (w) => { w = String(w).toLowerCase(); return /^0x[0-9a-f]{40}$/.test(w) && !EXCLUDE.has(w) && !w.startsWith("0x7e57da7a"); };
const NOW = Date.now(), DAYS = [...Array(14)].map((_, i) => new Date(NOW - i * 86400e3).toISOString().slice(0, 10));
// Completed favours per day: the History rows (contributions:<wallet>), one per (favour, person).
const ck = await scan("contributions:*");
const comp = Object.fromEntries(DAYS.map((d) => [d, new Set()])), compAll = Object.fromEntries(DAYS.map((d) => [d, new Set()]));
let oldest = null;
for (const k of ck) { const w = k.slice("contributions:".length); const rows = await cmd("LRANGE", k, 0, -1); for (const r of rows) { let c; try { c = typeof r === "string" ? JSON.parse(r) : r; } catch { continue; } const d = String(c.at ?? "").slice(0, 10); if (!oldest || d < oldest) oldest = d; if (compAll[d]) { compAll[d].add(`${c.taskId}:${w}`); if (out(w)) comp[d].add(`${c.taskId}:${w}`); } } }
// Jurors: the jury game's day sets exist only from the cda70a3 deploy (today). Earlier: points history, a lower bound.
const jd = await scan("jury:day:*");
const jur = Object.fromEntries(DAYS.map((d) => [d, new Set()]));
for (const k of jd) { const m = k.match(/^jury:day:(0x[0-9a-fA-F]{40}):(\d{4}-\d{2}-\d{2})$/); if (m && jur[m[2]] && out(m[1])) jur[m[2]].add(m[1].toLowerCase()); }
const pk = (await scan("pof:0x*")); const jurLB = Object.fromEntries(DAYS.map((d) => [d, new Set()]));
for (const k of pk) { const w = k.slice(4).toLowerCase(); if (!out(w)) continue; const raw = await cmd("GET", k); let p; try { p = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; } for (const h of p?.pointsHistory ?? []) { const d = String(h.timestamp ?? "").slice(0, 10); if (h.action === "jury_verdict" && jurLB[d]) jurLB[d].add(w); } }
console.log(`keys read: ${ck.length} history lists, ${jd.length} jury day sets, ${pk.length} points profiles. Oldest History row: ${oldest}.`);
console.log("day         outsideCompleted  allCompleted  outsideJurors(game sets)  outsideJurors(points history, lower bound)");
for (const d of DAYS) console.log(`${d}  ${String(comp[d].size).padStart(16)}  ${String(compAll[d].size).padStart(12)}  ${String(jur[d].size).padStart(24)}  ${String(jurLB[d].size).padStart(10)}`);
