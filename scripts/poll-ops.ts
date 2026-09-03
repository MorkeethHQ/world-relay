/**
 * Poll operations from the terminal — the same engine the cron and the admin
 * route use, so what you run here is what production runs.
 *
 *   npx tsx scripts/poll-ops.ts list
 *   npx tsx scripts/poll-ops.ts refresh            # top the active list back to the floor
 *   npx tsx scripts/poll-ops.ts delete <id> [...]  # remove spam, irreversible
 *
 * `delete` prints the poll it is about to remove and writes a JSON snapshot to
 * scripts/.poll-deleted-<id>.json first: it destroys the question, the options
 * and every vote cast on it, and there is no undo in Redis.
 *
 * Reads KV_REST_API_URL / KV_REST_API_TOKEN from .env.local, so it talks to the
 * SAME database as the live app. There is no dry-run mode for delete.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Load .env.local before anything imports lib/redis, which reads the env at
// module scope on first getRedis().
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

async function main() {
  const { listPolls, getPoll, deletePoll } = await import("../src/lib/polls-store");
  const { runPollRefresh, activePolls, POLL_MIN_ACTIVE } = await import("../src/lib/poll-refresh");

  const [cmd, ...args] = process.argv.slice(2);

  if (cmd === "list" || !cmd) {
    const polls = await listPolls();
    const active = new Set(activePolls(polls).map((p) => p.id));
    console.log(`${polls.length} polls — ${active.size} active (floor ${POLL_MIN_ACTIVE})\n`);
    for (const p of polls) {
      const tag = active.has(p.id) ? "ACTIVE" : "ended ";
      console.log(`${tag} ${p.id}  ${p.totalVotes} votes  ends ${p.endsAt.slice(0, 16)}  by ${p.creator.slice(0, 12)}`);
      console.log(`       ${p.question}`);
      console.log(`       [${p.options.join(" | ")}]`);
    }
    return;
  }

  if (cmd === "refresh") {
    const receipt = await runPollRefresh();
    console.log(JSON.stringify(receipt, null, 2));
    const after = await listPolls();
    console.log(`\nactive now: ${activePolls(after).length} (floor ${POLL_MIN_ACTIVE})`);
    return;
  }

  if (cmd === "delete") {
    if (args.length === 0) {
      console.error("delete needs at least one poll id");
      process.exit(1);
    }
    for (const id of args) {
      const poll = await getPoll(id);
      if (!poll) {
        console.log(`SKIP ${id} — not found`);
        continue;
      }
      // Look at the target before destroying it, and keep a copy.
      console.log(`\nDELETING ${id}`);
      console.log(`  question: ${poll.question}`);
      console.log(`  options:  [${poll.options.join(" | ")}]`);
      console.log(`  votes:    ${poll.totalVotes} ${JSON.stringify(poll.votes)}`);
      const snap = join(__dirname, `.poll-deleted-${id}.json`);
      writeFileSync(snap, JSON.stringify(poll, null, 2));
      const ok = await deletePoll(id);
      console.log(`  ${ok ? "deleted" : "already gone"} — snapshot ${snap}`);
    }
    return;
  }

  console.error(`unknown command "${cmd}" — expected list, refresh or delete`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
