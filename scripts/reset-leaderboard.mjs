// Season reset: wipe the points leaderboard (Proof-of-Favour points + weekly boards)
// for a fair fresh start. Keeps reputation/verification (rep:*) — trust is not the
// competition. Run dry first, then --commit.
//   node scripts/reset-leaderboard.mjs
//   node scripts/reset-leaderboard.mjs --commit
import { readFileSync } from "fs";
import { Redis } from "@upstash/redis";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf-8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
const COMMIT = process.argv.includes("--commit");

const index = (await redis.smembers("pof:__index")) || [];
const pofKeys = (await redis.keys("pof:*")) || [];
const weeklyKeys = (await redis.keys("pof:weekly:*")) || [];

console.log(`\npof profiles: ${index.length} | pof:* keys: ${pofKeys.length} | weekly boards: ${weeklyKeys.length}`);
console.log(`Weekly keys: ${weeklyKeys.join(", ") || "(none)"}`);
console.log(`Reputation (rep:*) will be KEPT.\n`);

if (!COMMIT) {
  console.log("DRY RUN. Re-run with --commit to wipe the points leaderboard for Season 1.\n");
  process.exit(0);
}

let deleted = 0;
for (const k of pofKeys) { await redis.del(k); deleted++; }   // includes pof:__index + weekly + profiles
console.log(`\nDONE. Wiped ${deleted} pof keys. Leaderboard reset — Season 1 starts fresh.\n`);
