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
import { storeLine, storeKind, issueCode, redeemCode, codeOnRecord, REFUSAL } from "./confirm-code.mjs";

const argv = process.argv.slice(2);
// The first line of every run names the store, before anything can go wrong.
const KIND = process.env.KV_REST_API_URL ? await storeKind(process.env.KV_REST_API_URL) : null;
if (KIND) console.log(storeLine(process.env.KV_REST_API_URL, KIND));
// THE REHEARSAL VERIFIER (a double that accepts every proof) may be named only
// when the store itself says it is the shipped rehearsal fake. This is the same
// answer the line above is printed from, so the two cannot disagree. Before
// 2026-10-05 the gate was the host name alone, and a reader got the double to
// write through a local proxy that was not the fake. If the variable is set and
// the store is anything else, nothing runs at all, not even a dry run.
if (process.env.RECHECK_VERIFIER_MODULE && KIND !== "fake") {
  console.error("REFUSED. RECHECK_VERIFIER_MODULE names a rehearsal verifier, and that runs only against the shipped rehearsal fake (the first line above would say LOCAL FAKE). Unset it to work on this store. Nothing was read or written.");
  process.exit(2);
}
const known = new Set(["--apply", "--only", "--limit", "--confirm", "--kind", "--verbose"]);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--only" || a === "--limit" || a === "--confirm" || a === "--kind") { i++; continue; }
  if (!known.has(a)) {
    console.error(`unknown argument: ${a}\nusage: recheck-thrown-proofs.mjs [--only <taskId>] [--kind text|photo] [--limit <n>] [--verbose] [--apply --confirm <code>]\nNothing was read or written.`);
    process.exit(2);
  }
}
const APPLY = argv.includes("--apply");
const confirm = flagValue("--confirm");
const VERBOSE = argv.includes("--verbose");
const kind = flagValue("--kind");
if (kind !== undefined && kind !== "text" && kind !== "photo") {
  console.error("--kind takes text or photo. Nothing was read or written.");
  process.exit(2);
}
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
  // RECHECK_VERIFIER_MODULE swaps in the rehearsal double. The gate at the top of
  // this file has already refused it unless the store is the shipped fake.
  const double = process.env.RECHECK_VERIFIER_MODULE;
  if (double) {
    verify = (await import(pathToFileURL(resolve(double)).href)).default;
  } else {
    verify = (await jiti.import(join(root, "src/lib/verify-proof.ts"))).verifyProof;
  }
}

// The plan: always a dry run first, even for a real run. It reads and writes nothing.
const plan = await recheckThrownProofs({ apply: false, verify: async () => { throw new Error("planning: the verifier is never called"); }, only, limit, kind });
// What a code is tied to: this command, these flags, and exactly this list.
const what = ["recheck-thrown-proofs", { only: only ?? null, limit: limit ?? null, kind: kind ?? null }, plan.filter((o) => o.action === "would-recheck" || o.action === "would-resume").map((o) => [o.action, o.taskId, o.claimant]).sort()];
if (APPLY && !redeemCode(process.env.KV_REST_API_URL, what, confirm)) {
  console.error(REFUSAL);
  process.exit(2);
}

// During a real run the libraries print error traces from the store client when a
// write fails. They bury the line that matters. They are held back unless
// --verbose is given, and counted so the reader knows they exist.
let hidden = 0;
const realError = console.error;
if (APPLY && !VERBOSE) console.error = () => { hidden++; };
const out = APPLY ? await recheckThrownProofs({ apply: true, verify, only, limit, kind }) : plan;
console.error = realError;

const count = (a) => out.filter((o) => o.action === a).length;
const items = () => {
  for (const o of out) console.log(`${o.action.padEnd(13)} ${o.taskId}  ${(o.claimant ?? "").slice(0, 10)}  "${o.description}"\n              ${o.detail}`);
};
if (!APPLY) {
  items();
  console.log("");
  console.log(`Dry run. ${count("would-recheck")} would be re-checked, ${count("would-resume")} would be resumed, ${count("skipped")} skipped. Nothing was written.`);
  if (count("would-recheck") + count("would-resume") > 0) {
    console.log(`To do exactly this list for real, on this store, run the same command again with: --apply --confirm ${issueCode(process.env.KV_REST_API_URL, what)}`);
    console.log("The code works once, for 30 minutes, on this store only, and only while the list above is unchanged.");
  }
} else {
  // THE LINE THAT MATTERS is printed first and last. Points are summed only from
  // rows that carry them, and a row carries points only after the credit was read
  // back from the store.
  const points = out.reduce((s, o) => s + (o.action === "passed" ? o.points ?? 0 : 0), 0);
  const settled = count("passed") + count("rejected") + count("flagged") + count("already-done") + count("skipped") + count("changed");
  const open = count("failed") + count("still-failing") + count("busy");
  const total = out.length;
  const headline = open === 0
    ? `COMPLETE: ${settled} of ${total} item(s) settled. ${points} points written and read back. Nothing left to do for this list.`
    : `NOT COMPLETE: ${open} of ${total} item(s) are not finished (${count("failed")} stopped part way, ${count("still-failing")} could not be checked, ${count("busy")} busy). No points are reported for them. Nothing is lost.`;
  console.log(headline);
  console.log("");
  items();
  console.log("");
  console.log(`Applied. passed ${count("passed")} (${points} points read back), rejected ${count("rejected")}, real flag ${count("flagged")}, FAILED ${count("failed")}, still failing ${count("still-failing")}, already done ${count("already-done")}, busy ${count("busy")}, changed ${count("changed")}, skipped ${count("skipped")}.`);
  if (hidden > 0) console.log(`${hidden} error line(s) from the store client were held back. Add --verbose to the same command to see them.`);
  if (open > 0) {
    process.exitCode = 1;
    if (count("still-failing") > 0) console.log("Some proofs could not be checked. They are unchanged. Fix the cause first.");
    console.log("To finish: WAIT 2 MINUTES, then run the same dry run again, then the same apply with the new code it prints.");
    console.log("Why wait: a failed run can leave a lock behind. A points lock clears by itself in 5 seconds and a favour lock in 2 minutes. Before that, the next run reports the item as busy.");
  }
  console.log(headline);
}
