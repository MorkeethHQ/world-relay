#!/usr/bin/env node
// RE-CHECK PROOFS THE CHECK NEVER JUDGED (2026-10-05). Oscar runs this by hand,
// and only after the live proof check works again.
//
// It finds favours whose stored verdict is the fallback written when the proof
// check THROWS ("AI verification error - proof flagged for manual review." at
// confidence 0) and runs the same verifier on the proof that is already stored.
// The rules live in src/lib/recheck.ts; this file only parses flags and prints.
//
// DRY RUN BY DEFAULT. Without --apply it reads the task list, prints what it
// would re-check and what it would skip, and writes nothing.
//
//   node scripts/recheck-thrown-proofs.mjs                                      dry run, prints a code
//   node scripts/recheck-thrown-proofs.mjs --limit 1                            dry run of one favour, prints a code
//   node scripts/recheck-thrown-proofs.mjs --limit 1 --apply --confirm <code>   re-check that one, for real
//   node scripts/recheck-thrown-proofs.mjs --apply --confirm <code>             re-check the whole list, for real
//
// --apply does nothing without --confirm <code>. The code comes from the dry run of
// the SAME command and names the exact list it showed. If the list has changed
// since (a favour expired, a run finished), the real run does not start.
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN. --apply also needs
// ANTHROPIC_API_KEY, because it calls the same model the live check calls.
//
// A real run can be repeated safely. Each item has a journal
// (recheck:job:<taskId>:<person>) that is "in-progress" until every credit was
// written AND read back, then "done". If a run stops part way, for any reason,
// the item is printed as "failed" with no points, and the next run finishes it:
// every run first resumes the journals still in progress. Credits are keyed by
// favour and person, so a repeat never credits twice. Exit code 1 means run again.
//
// It never touches a real model flag, a money favour or a campaign task. It moves
// no money. On a pass it awards the favour's points, exactly as the live check
// would have, and writes the person's History row.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";

const argv = process.argv.slice(2);
const known = new Set(["--apply", "--only", "--limit", "--confirm"]);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--only" || a === "--limit" || a === "--confirm") { i++; continue; }
  if (!known.has(a)) {
    console.error(`unknown argument: ${a}\nusage: recheck-thrown-proofs.mjs [--only <taskId>] [--limit <n>] [--apply --confirm <code>]\nNothing was read or written.`);
    process.exit(2);
  }
}
const APPLY = argv.includes("--apply");
const confirm = flagValue("--confirm");
const only = flagValue("--only");
const limitRaw = flagValue("--limit");
const limit = limitRaw === undefined ? undefined : Number(limitRaw);
if (limitRaw !== undefined && (!Number.isInteger(limit) || limit < 1)) {
  console.error("--limit takes a whole number above 0");
  process.exit(2);
}

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required");
  process.exit(2);
}
// THE CONFIRM CODE (2026-10-05). A real run needs --apply AND --confirm <code>.
// The code is printed only by the dry run of the same command, and it is made
// from the exact list of favours that dry run showed. So a real run cannot start
// by pasting a block of commands, and it will not start if the list has changed
// since the dry run was read.
if (APPLY && !confirm) {
  console.error("--apply needs --confirm <code>. Run the same command without --apply first; it prints the code. Nothing was read or written.");
  process.exit(2);
}
if (APPLY && !process.env.ANTHROPIC_API_KEY) {
  console.error("--apply needs ANTHROPIC_API_KEY: it calls the same model the live check calls. Nothing was read or written.");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { recheckThrownProofs } = await jiti.import(join(root, "src/lib/recheck.ts"));

// The verifier is loaded only for a real run. A dry run never calls it.
let verify = async () => { throw new Error("dry run: the verifier is never called"); };
if (APPLY) {
  // RECHECK_VERIFIER_MODULE swaps in a local double. It exists for the script's
  // own test and is refused unless the store is on this machine.
  const double = process.env.RECHECK_VERIFIER_MODULE;
  if (double) {
    const host = new URL(process.env.KV_REST_API_URL).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      console.error("RECHECK_VERIFIER_MODULE is for local tests only and is refused against a remote store");
      process.exit(2);
    }
    verify = (await import(double)).default;
  } else {
    verify = (await jiti.import(join(root, "src/lib/verify-proof.ts"))).verifyProof;
  }
}

// The plan: always a dry run first, even for a real run. It reads and writes nothing.
const plan = await recheckThrownProofs({ apply: false, verify: async () => { throw new Error("planning: the verifier is never called"); }, only, limit });
const code = createHash("sha256")
  .update(JSON.stringify(plan.filter((o) => o.action === "would-recheck" || o.action === "would-resume").map((o) => [o.action, o.taskId, o.claimant]).sort()))
  .digest("hex")
  .slice(0, 10);
if (APPLY && confirm !== code) {
  for (const o of plan) console.log(`${o.action.padEnd(13)} ${o.taskId}  ${(o.claimant ?? "").slice(0, 10)}  "${o.description}"\n              ${o.detail}`);
  console.error(`\nNOT STARTED: --confirm ${confirm} does not match this list. The list above is what a real run would do now. It differs from the dry run that gave that code (a favour expired, a run finished, or --only / --limit differ). Read it, then use its code: ${code}. Nothing was written.`);
  process.exit(2);
}

const out = APPLY ? await recheckThrownProofs({ apply: true, verify, only, limit }) : plan;

const count = (a) => out.filter((o) => o.action === a).length;
for (const o of out) {
  console.log(`${o.action.padEnd(13)} ${o.taskId}  ${(o.claimant ?? "").slice(0, 10)}  "${o.description}"\n              ${o.detail}`);
}
console.log("");
if (!APPLY) {
  console.log(`Dry run. ${count("would-recheck")} would be re-checked, ${count("would-resume")} would be resumed, ${count("skipped")} skipped. Nothing was written.`);
  if (count("would-recheck") + count("would-resume") > 0) console.log(`To do exactly this list for real, run the same command again with: --apply --confirm ${code}`);
} else {
  // Points are summed only from rows that carry them, and a row carries points
  // only after the credit was read back from the store.
  const points = out.reduce((s, o) => s + (o.action === "passed" ? o.points ?? 0 : 0), 0);
  console.log(`Applied. passed ${count("passed")} (${points} points read back), rejected ${count("rejected")}, real flag ${count("flagged")}, FAILED ${count("failed")}, still failing ${count("still-failing")}, already done ${count("already-done")}, busy ${count("busy")}, changed ${count("changed")}, skipped ${count("skipped")}.`);
  if (count("failed") > 0) {
    console.log(`${count("failed")} item(s) are NOT COMPLETE. No points are reported for them. Nothing is lost: run the dry run again, then --apply with its new code, and it finishes them.`);
    process.exitCode = 1;
  }
  if (count("still-failing") > 0) {
    console.log("Some proofs could not be checked. They are unchanged. Fix the cause and run again.");
    process.exitCode = 1;
  }
  if (count("busy") > 0) {
    console.log("Some favours were busy. If a run died, its lock clears after 2 minutes. Run again.");
    process.exitCode = 1;
  }
}
