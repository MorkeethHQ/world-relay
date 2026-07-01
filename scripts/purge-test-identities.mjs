// Purge non-wallet (test/dev/anonymous) identities from all leaderboard/reputation keys.
// Real users are wallet addresses (0x + 40 hex). Anything else cannot receive USDC,
// is not a verified human, and must not appear in stats or on the public leaderboard.
//
// Usage:
//   node scripts/purge-test-identities.mjs          # dry run, lists candidates
//   node scripts/purge-test-identities.mjs --commit # actually delete
import { readFileSync } from "fs";
import { Redis } from "@upstash/redis";

// Load creds from .env.local
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN });
const COMMIT = process.argv.includes("--commit");
const isRealWallet = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);

const index = (await redis.smembers("pof:__index")) || [];
const repKeys = (await redis.keys("rep:*")) || [];
const repAddrs = repKeys.map((k) => k.slice("rep:".length));
const weeklyKeys = (await redis.keys("pof:weekly:*")) || [];

const allAddrs = [...new Set([...index, ...repAddrs])];
const bad = allAddrs.filter((a) => !isRealWallet(a));

console.log(`\nTotal identities: ${allAddrs.length} | real wallets: ${allAddrs.filter(isRealWallet).length} | to purge: ${bad.length}`);
console.log(`Weekly leaderboard keys: ${weeklyKeys.join(", ") || "(none)"}\n`);

for (const addr of bad) {
  let pts = "?";
  try {
    const p = await redis.get(`pof:${addr}`);
    const parsed = typeof p === "string" ? JSON.parse(p) : p;
    pts = parsed?.totalPoints ?? "-";
  } catch {}
  console.log(`  PURGE  ${addr}  (${pts} pts)`);
}

if (!COMMIT) {
  console.log(`\nDRY RUN. Re-run with --commit to delete the above.\n`);
  process.exit(0);
}

let removed = 0;
for (const addr of bad) {
  await redis.del(`pof:${addr}`);
  await redis.del(`rep:${addr}`);
  await redis.srem("pof:__index", addr);
  for (const wk of weeklyKeys) await redis.zrem(wk, addr);
  removed++;
}
console.log(`\nDONE. Purged ${removed} test identities from pof/rep/weekly keys.\n`);
