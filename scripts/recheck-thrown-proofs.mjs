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
//   node scripts/recheck-thrown-proofs.mjs                    dry run
//   node scripts/recheck-thrown-proofs.mjs --only <taskId>    dry run, one favour
//   node scripts/recheck-thrown-proofs.mjs --apply --limit 1  re-check one, for real
//   node scripts/recheck-thrown-proofs.mjs --apply            re-check all of them
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN. --apply also needs
// ANTHROPIC_API_KEY, because it calls the same model the live check calls.
//
// A real run is idempotent: a favour that was re-checked no longer carries the
// fallback text, and a marker (recheck:done:<taskId>:<person>) is taken before
// any credit. It never touches a real model flag, a money favour or a campaign
// task. It moves no money. On a pass it awards the favour's points, exactly as
// the live check would have, and writes the person's History row.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";

const argv = process.argv.slice(2);
const known = new Set(["--apply", "--only", "--limit"]);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--only" || a === "--limit") { i++; continue; }
  if (!known.has(a)) {
    console.error(`unknown argument: ${a}\nusage: recheck-thrown-proofs.mjs [--apply] [--only <taskId>] [--limit <n>]`);
    process.exit(2);
  }
}
const APPLY = argv.includes("--apply");
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

const out = await recheckThrownProofs({ apply: APPLY, verify, only, limit });

const count = (a) => out.filter((o) => o.action === a).length;
for (const o of out) {
  console.log(`${o.action.padEnd(13)} ${o.taskId}  ${(o.claimant ?? "").slice(0, 10)}  "${o.description}"\n              ${o.detail}`);
}
console.log("");
if (!APPLY) {
  console.log(`Dry run. ${count("would-recheck")} would be re-checked, ${count("skipped")} skipped. Nothing was written. Add --apply to re-check.`);
} else {
  console.log(`Applied. passed ${count("passed")}, failed ${count("failed")}, real flag ${count("flagged")}, still failing ${count("still-failing")}, already done ${count("already-done")}, busy ${count("busy")}, changed ${count("changed")}, skipped ${count("skipped")}.`);
  if (count("still-failing") > 0) {
    console.log("Some proofs could not be checked. They are unchanged. Fix the cause and run again.");
    process.exitCode = 1;
  }
}
