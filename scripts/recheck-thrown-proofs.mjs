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
// the SAME command against the SAME store. It works once, for 30 minutes, and only
// while the list is what that dry run showed. A refusal never prints a code.
// The first line of every run names the store and says whether it is the local fake.
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
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { storeLine, issueCode, redeemCode, codeOnRecord, REFUSAL } from "./confirm-code.mjs";

const argv = process.argv.slice(2);
// The first line of every run names the store, before anything can go wrong.
if (process.env.KV_REST_API_URL) console.log(await storeLine(process.env.KV_REST_API_URL));
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
// THE CONFIRM CODE. A real run needs --apply AND --confirm <code>. The code is
// printed only by the dry run of the same command against the same store; see
// scripts/confirm-code.mjs. Without a code nothing is read or written.
if (APPLY && !codeOnRecord(confirm)) {
  console.error(REFUSAL);
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
    verify = (await import(pathToFileURL(resolve(double)).href)).default;
  } else {
    verify = (await jiti.import(join(root, "src/lib/verify-proof.ts"))).verifyProof;
  }
}

// The plan: always a dry run first, even for a real run. It reads and writes nothing.
const plan = await recheckThrownProofs({ apply: false, verify: async () => { throw new Error("planning: the verifier is never called"); }, only, limit });
// What a code is tied to: this command, these flags, and exactly this list.
const what = ["recheck-thrown-proofs", { only: only ?? null, limit: limit ?? null }, plan.filter((o) => o.action === "would-recheck" || o.action === "would-resume").map((o) => [o.action, o.taskId, o.claimant]).sort()];
if (APPLY && !redeemCode(process.env.KV_REST_API_URL, what, confirm)) {
  console.error(REFUSAL);
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
  if (count("would-recheck") + count("would-resume") > 0) {
    console.log(`To do exactly this list for real, on this store, run the same command again with: --apply --confirm ${issueCode(process.env.KV_REST_API_URL, what)}`);
    console.log("The code works once, for 30 minutes, on this store only, and only while the list above is unchanged.");
  }
} else {
  // Points are summed only from rows that carry them, and a row carries points
  // only after the credit was read back from the store.
  const points = out.reduce((s, o) => s + (o.action === "passed" ? o.points ?? 0 : 0), 0);
  console.log(`Applied. passed ${count("passed")} (${points} points read back), rejected ${count("rejected")}, real flag ${count("flagged")}, FAILED ${count("failed")}, still failing ${count("still-failing")}, already done ${count("already-done")}, busy ${count("busy")}, changed ${count("changed")}, skipped ${count("skipped")}.`);
  if (count("failed") > 0) {
    console.log(`${count("failed")} item(s) are NOT COMPLETE. No points are reported for them. Nothing is lost. To finish: run the same dry run again, then the same apply with the new code it prints.`);
    process.exitCode = 1;
  }
  if (count("still-failing") > 0) {
    console.log("Some proofs could not be checked. They are unchanged. Fix the cause, then run the same dry run again and apply with its new code.");
    process.exitCode = 1;
  }
  if (count("busy") > 0) {
    console.log("Some favours were busy. If a run died, its lock clears after 2 minutes. Then run the same dry run again and apply with its new code.");
    process.exitCode = 1;
  }
}
