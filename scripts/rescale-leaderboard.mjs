// Season 1 re-scale: keep real completions, re-derive points in the new capped
// economy so the leaderboard is fair. Points = favoursCompleted*10 + longestStreak*2.
// Weekly board is reset fresh. Reputation (rep:*) untouched.
//   node scripts/rescale-leaderboard.mjs           (dry run)
//   node scripts/rescale-leaderboard.mjs --commit
import { readFileSync } from "fs";
import { Redis } from "@upstash/redis";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf-8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
const COMMIT = process.argv.includes("--commit");

const LEVELS = [
  { name: "Legend", min: 1000 }, { name: "Veteran Runner", min: 400 },
  { name: "Trusted Runner", min: 150 }, { name: "Local Runner", min: 50 }, { name: "New Runner", min: 0 },
];
const levelFor = (p) => (LEVELS.find((l) => p >= l.min) || LEVELS[LEVELS.length - 1]).name;

const index = (await redis.smembers("pof:__index")) || [];
const weeklyKeys = (await redis.keys("pof:weekly:*")) || [];
console.log(`\nprofiles: ${index.length} | weekly boards to reset: ${weeklyKeys.length}\n`);

const isRealWallet = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
let changed = 0;
let purged = 0;
for (const addr of index) {
  // Non-wallet (test/dev/demo) ids must never appear on the season leaderboard.
  if (!isRealWallet(addr)) {
    console.log(`  PURGE non-wallet ${addr}`);
    if (COMMIT) { await redis.del(`pof:${addr}`); await redis.srem("pof:__index", addr); }
    purged++;
    continue;
  }
  const raw = await redis.get(`pof:${addr}`);
  const p = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!p) continue;
  const completed = p.favoursCompleted || 0;
  const longest = p.longestStreak || 0;
  const newPoints = completed * 10 + longest * 2;
  console.log(`  ${addr.slice(0, 10)}  ${p.totalPoints} -> ${newPoints} pts  (${completed} done, ${longest}d streak)`);
  if (COMMIT) {
    p.totalPoints = newPoints;
    p.level = levelFor(newPoints);
    await redis.set(`pof:${addr}`, JSON.stringify(p));
  }
  changed++;
}

if (!COMMIT) { console.log(`\nDRY RUN. Re-run with --commit to re-scale ${changed} profiles + reset weekly.\n`); process.exit(0); }
for (const wk of weeklyKeys) await redis.del(wk);
console.log(`\nDONE. Re-scaled ${changed} real wallets to Season 1 economy, purged ${purged} non-wallet ids, reset ${weeklyKeys.length} weekly boards.\n`);
