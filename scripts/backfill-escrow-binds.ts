/**
 * Backfill escrow:bind:<onChainId> -> taskId for every existing task that carries
 * an onChainId. The C1 fix (claimOnChainId) only writes a bind on NEW
 * createTask/setOnChainId; any task funded BEFORE the fix deployed has no bind,
 * so the cross-task escrow-drain (task B references task A's funded onChainId and
 * settles against the live on-chain amount) is still live against those escrows.
 * This one-time backfill closes that window by binding each existing funded task
 * to itself.
 *
 * Default is a DRY RUN (reports what it would bind, writes nothing). Pass --live
 * to actually write the binds.
 *
 *   npx tsx scripts/backfill-escrow-binds.ts          # dry run
 *   npx tsx scripts/backfill-escrow-binds.ts --live   # write binds
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import { Redis } from "@upstash/redis";

const LIVE = process.argv.includes("--live");
const BIND_PREFIX = "escrow:bind:";

async function main() {
  const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
  const ids: string[] = (await redis.smembers("task_ids")) ?? [];

  // Group tasks by onChainId so we can DETECT any escrow already referenced by
  // more than one app task — a pre-existing collision the backfill must NOT
  // silently paper over (it would bind whichever it hits first and leave the
  // other task able to settle nothing / signal an in-flight drain).
  const byOnChain = new Map<number, { id: string; status: string }[]>();
  for (const id of ids) {
    const raw = await redis.get(`task:${id}`);
    if (!raw) continue;
    const t: any = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (t.onChainId == null) continue;
    const arr = byOnChain.get(t.onChainId) ?? [];
    arr.push({ id: t.id, status: t.status });
    byOnChain.set(t.onChainId, arr);
  }

  const collisions = [...byOnChain.entries()].filter(([, arr]) => arr.length > 1);
  if (collisions.length) {
    console.error("REFUSING TO BACKFILL — escrow(s) referenced by multiple tasks (resolve by hand first):");
    for (const [oc, arr] of collisions) {
      console.error(`  #${oc}: ${arr.map(a => `${a.id}(${a.status})`).join(", ")}`);
    }
    process.exit(1);
  }

  console.log(`${byOnChain.size} funded task(s) to check. Mode: ${LIVE ? "LIVE (writing)" : "DRY RUN"}\n`);
  let bound = 0, alreadyOk = 0, conflict = 0;
  for (const [onChainId, [task]] of [...byOnChain.entries()].sort((a, b) => a[0] - b[0])) {
    const key = `${BIND_PREFIX}${onChainId}`;
    const existing = await redis.get(key);
    if (existing != null) {
      if (existing === task.id) { alreadyOk++; console.log(`#${onChainId}: already bound to ${task.id} ✓`); }
      else { conflict++; console.error(`#${onChainId}: CONFLICT — bound to ${existing}, not the owning task ${task.id}`); }
      continue;
    }
    if (LIVE) {
      // SET NX so we never clobber a bind written concurrently by live traffic.
      const ok = await redis.set(key, task.id, { nx: true });
      if (ok) { bound++; console.log(`#${onChainId}: bound -> ${task.id}`); }
      else { conflict++; console.error(`#${onChainId}: lost race, someone else bound it`); }
    } else {
      bound++; console.log(`#${onChainId}: WOULD bind -> ${task.id}`);
    }
  }
  console.log(`\n${LIVE ? "Bound" : "Would bind"}: ${bound}  |  already ok: ${alreadyOk}  |  conflicts: ${conflict}`);
  if (conflict) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
