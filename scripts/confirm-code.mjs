// THE CONFIRM CODE AND THE STORE LINE, shared by the operator scripts that write
// (recheck-thrown-proofs.mjs and hide-item.mjs). 2026-10-05, third cold read.
//
// WHAT A CODE IS. A dry run that would change something ends by printing a code.
// The same command with --apply does nothing unless it is given that code.
//
// The first version made the code by hashing the list of favours. A cold reader
// showed what that was worth: two stores holding the same list printed the same
// code, so a code from a rehearsal on the local fake would have started the run
// on production, and anyone could work a code out from public data.
//
// Now a code is RANDOM, and the dry run keeps a small record of it in a folder on
// THIS machine: which store, which command, which flags, and exactly what the dry
// run showed. --apply looks the code up and goes ahead only if all of those are
// the same now. So a code works:
//   - on the store whose dry run printed it, and on no other;
//   - for that command with those flags, and no other;
//   - while what the dry run showed is still what the store holds;
//   - once, and for CODE_TTL_MS at most.
// Nothing is written to the store to do this. The record is a local file.
//
// A refusal never says why, never prints a code and never prints the list. It
// says to run the dry run. The dry run is the only place a code appears.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CODE_TTL_MS = 30 * 60 * 1000;
export const REFUSAL = "NOT STARTED. Run the dry run of this exact command against this store, read what it prints, and use the code it gives. Nothing was written.";

const codeDir = () => process.env.FAVOUR_CONFIRM_DIR || join(tmpdir(), "favour-confirm-codes");
const fileFor = (code) => join(codeDir(), `${code}.json`);
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

// The store, as the operator should think of it: the host and port of the endpoint.
export function storeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}
const isLocalHost = (url) => {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
};

// The first line of every run. It names the endpoint and says in words what it is.
// "LOCAL FAKE" is printed only when the address is on this machine AND the thing
// answering there says it is the fake (scripts/fake-store.mjs answers GET /__log
// with fake: true). A remote address is never asked anything here.
export async function storeLine(url) {
  const host = storeHost(url);
  if (!isLocalHost(url)) return `STORE: ${host}   NOT LOCAL. This is a real store on another machine. A write here is real.`;
  let fake = false;
  try {
    const r = await fetch(new URL("/__log", url), { signal: AbortSignal.timeout(1500) });
    fake = r.ok && (await r.json()).fake === true;
  } catch {
    fake = false;
  }
  return fake
    ? `STORE: ${host}   LOCAL FAKE. A rehearsal store on this machine, in memory. Nothing here is real.`
    : `STORE: ${host}   on this machine, but it did not identify itself as the rehearsal fake. Treat a write here as real.`;
}

// Called by a dry run that would change something. `what` is everything the code
// must be tied to: the command, the flags, and what the dry run showed.
export function issueCode(url, what) {
  const code = randomBytes(5).toString("hex");
  mkdirSync(codeDir(), { recursive: true });
  writeFileSync(fileFor(code), JSON.stringify({ host: storeHost(url), fingerprint: digest(what), issuedAt: Date.now() }), { mode: 0o600 });
  return code;
}

// Called by --apply. True only if this code was issued by a dry run on this
// machine, for this store, for exactly `what`, within the time limit. The record
// is removed on success, so a code starts one run.
export function redeemCode(url, what, code) {
  if (typeof code !== "string" || !/^[0-9a-f]{10}$/.test(code)) return false;
  const file = fileFor(code);
  if (!existsSync(file)) return false;
  let rec;
  try {
    rec = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  if (Date.now() - rec.issuedAt > CODE_TTL_MS) {
    rmSync(file, { force: true });
    return false;
  }
  if (rec.host !== storeHost(url) || rec.fingerprint !== digest(what)) return false;
  rmSync(file, { force: true });
  return true;
}
