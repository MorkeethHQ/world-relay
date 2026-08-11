#!/usr/bin/env node
/**
 * FAVOUR end-to-end smoke — the loop, watched firing, against the SHIPPED app.
 *
 * WHY THIS EXISTS
 * There are 40 scripts in this directory and not one of them runs the loop.
 * "The agent loop works end to end" has therefore been an unverified claim.
 * This runs it: post -> appears on the board -> claim -> submit proof ->
 * AI verifies -> points settle. It prints a receipt you can screenshot.
 *
 * TWO LANES, AND THE CONTROL IS THE POINT
 *
 *   LANE A - CONTROL (default, fully automatic).
 *     Submits a synthetic image that is NOT a photograph of anything.
 *     A PASS here would be a BUG. The assertion is that the verifier
 *     REJECTS it (flag/fail) and that ZERO points are credited.
 *     This obeys CLAUDE.md "AI-generated proof may appear as content but must
 *     NEVER earn" and "no fake/simulated data, ever" - the synthetic proof is
 *     never presented as a completion, it is the thing that must be refused.
 *
 *   LANE B - POSITIVE (--photo <file>, opt-in).
 *     A real photograph taken by a real human. Expects verdict=pass and a
 *     points delta > 0. This is the half that proves humans can actually earn,
 *     and it cannot be faked by this script by design.
 *
 * A green LANE A alone does not prove a human can earn. It proves the guard
 * fires. Say so on the receipt rather than implying more.
 *
 * USAGE
 *   node scripts/smoke-loop.mjs                    # dry run, no writes (default)
 *   node scripts/smoke-loop.mjs --fire             # LANE A against production
 *   node scripts/smoke-loop.mjs --fire --photo p.jpg   # LANE A + LANE B
 *   node scripts/smoke-loop.mjs --fire --base http://localhost:3000
 *
 * DEFAULT IS DRY RUN ON PURPOSE. --fire writes to a live World App Store app
 * with real users. That is Oscar's decision, not this script's.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

/* ── config ──────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const FIRE = has("--fire");
const BASE = (val("--base") || process.env.SMOKE_BASE_URL || "https://world-relay.vercel.app").replace(/\/$/, "");
const PHOTO = val("--photo");
const KEEP = has("--keep"); // leave the smoke task on the board instead of cancelling
const TIMEOUT_MS = 90_000;

const RUN_ID = process.pid.toString(36) + "-" + Math.floor(process.uptime() * 1000).toString(36);

/* ── env (ADMIN_SECRET / an existing agent key is needed to post) ─────── */

function loadEnv() {
  const out = {};
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
const ADMIN_SECRET = env.ADMIN_SECRET || null;
const AGENT_KEY = env.SMOKE_AGENT_KEY || null;

/* ── tiny http + reporting ───────────────────────────────────────────── */

const steps = [];
let failed = false;

function step(name) {
  const s = { name, status: "pending", detail: "", ms: 0, t0: Date.now() };
  steps.push(s);
  return {
    ok: (detail) => { s.status = "ok"; s.detail = detail ?? ""; s.ms = Date.now() - s.t0; },
    fail: (detail) => { s.status = "FAIL"; s.detail = detail ?? ""; s.ms = Date.now() - s.t0; failed = true; },
    skip: (detail) => { s.status = "skip"; s.detail = detail ?? ""; s.ms = Date.now() - s.t0; },
  };
}

async function http(method, path, { body, auth, cookie } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctl.signal,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── the control image ────────────────────────────────────────────────
 * A 64x64 flat magenta PNG, built here, never a real scene. It exists to be
 * refused. If the verifier passes this, the verifier is broken.
 * Hand-assembled so the file has no image dependency.
 */
import { deflateSync } from "node:zlib";

function controlPng(size = 64) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 3 + 1);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3] = 0xff;
      raw[off + 2 + x * 3] = 0x00;
      raw[off + 3 + x * 3] = 0xff;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}

function realPhoto(path) {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`photo not found: ${p}`);
  const ext = extname(p).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  const b = readFileSync(p);
  if (b.length > 4.5 * 1024 * 1024) throw new Error(`photo too large (${(b.length / 1e6).toFixed(1)}MB, max ~4.5MB)`);
  return { uri: `data:${mime};base64,` + b.toString("base64"), bytes: b.length };
}

/* ── receipt ─────────────────────────────────────────────────────────── */

const facts = {};

function receipt() {
  const line = "─".repeat(64);
  const pad = (s, n) => String(s).padEnd(n);
  console.log("\n" + line);
  console.log(`  FAVOUR — END-TO-END LOOP RECEIPT${FIRE ? "" : "   (DRY RUN — nothing written)"}`);
  console.log(`  ${BASE}`);
  console.log(`  ${new Date().toISOString()}   run ${RUN_ID}`);
  console.log(line);
  for (const s of steps) {
    const mark = s.status === "ok" ? "PASS" : s.status === "FAIL" ? "FAIL" : s.status === "skip" ? "skip" : "····";
    console.log(`  ${pad(mark, 5)} ${pad(s.name, 30)} ${s.detail}`);
  }
  console.log(line);
  if (facts.taskId) console.log(`  task      ${facts.taskId}`);
  if (facts.taskUrl) console.log(`  url       ${facts.taskUrl}`);
  if (facts.controlVerdict) console.log(`  control   synthetic proof -> ${facts.controlVerdict} (a PASS here would be a bug)`);
  if (facts.controlPoints !== undefined) console.log(`  points    control delta ${facts.controlPoints >= 0 ? "+" : ""}${facts.controlPoints} (must be 0)`);
  if (facts.realVerdict) console.log(`  human     real photo -> ${facts.realVerdict}`);
  if (facts.realPoints !== undefined) console.log(`  points    human delta ${facts.realPoints >= 0 ? "+" : ""}${facts.realPoints}`);
  console.log(line);
  const laneB = facts.realVerdict ? "" :
    "\n  NOT PROVEN: no real photo was submitted, so this run does NOT show\n  that a human can earn. Re-run with --photo to prove that half.";
  console.log(failed
    ? `  RESULT: the loop is BROKEN — see FAIL rows above.${laneB}`
    : FIRE
      ? `  RESULT: the loop ran end to end against the live app.${laneB}`
      : `  RESULT: dry run clean — every stage reachable, no writes made.\n  Run with --fire to execute against ${BASE}.`);
  console.log(line + "\n");
}

/* ── stages ──────────────────────────────────────────────────────────── */

async function main() {
  console.log(`FAVOUR smoke — ${FIRE ? "FIRE (writes to " + BASE + ")" : "dry run"}`);

  /* 1. app is up */
  {
    const s = step("app reachable");
    const r = await http("GET", "/api/health");
    if (!r.ok || r.json?.status !== "ok") return s.fail(`health ${r.status} ${r.text}`);
    s.ok(`health ok · chain ${r.json.chain} · xmtp ${r.json.xmtp}`);
  }

  /* 2. baseline board + stats */
  let baseline = null;
  {
    const s = step("board readable");
    const r = await http("GET", "/api/stats");
    if (!r.ok) return s.fail(`stats ${r.status}`);
    baseline = r.json;
    s.ok(`${r.json.tasks.open} open · ${r.json.tasks.completed} completed · ${r.json.users.verified} verified`);
  }

  /* 3. credentials to post as an agent */
  let agentKey = AGENT_KEY;
  let agentId = null;
  {
    const s = step("agent credentials");
    if (!FIRE) {
      s.ok(ADMIN_SECRET || AGENT_KEY ? "present (register deferred — dry run)" : "MISSING: set ADMIN_SECRET or SMOKE_AGENT_KEY");
      if (!ADMIN_SECRET && !AGENT_KEY) failed = true;
    } else if (agentKey) {
      s.ok("reusing SMOKE_AGENT_KEY");
    } else if (!ADMIN_SECRET) {
      return s.fail("no ADMIN_SECRET and no SMOKE_AGENT_KEY — cannot post");
    } else {
      const r = await http("POST", "/api/agent/register", {
        auth: ADMIN_SECRET,
        body: { name: `smoke-${RUN_ID}` },
      });
      if (!r.ok) return s.fail(`register ${r.status} ${r.text}`);
      agentKey = r.json.apiKey || r.json.api_key;
      agentId = r.json.agentId || r.json.agent_id;
      if (!agentKey) return s.fail(`register returned no apiKey: ${r.text}`);
      s.ok(`registered ${agentId} (save as SMOKE_AGENT_KEY to reuse)`);
    }
  }

  const description =
    "[SYSTEM SMOKE TEST — not a real favour, please ignore] " +
    "Automated end-to-end check of the FAVOUR loop. This task is posted by the " +
    "system, is worth no reward to you, and is closed automatically.";

  /* 4. post the task */
  let taskId = null;
  {
    const s = step("post favour");
    if (!FIRE) {
      s.skip(`would POST /api/agent/tasks (points, 1h deadline, marked SMOKE)`);
    } else {
      const r = await http("POST", "/api/agent/tasks", {
        auth: agentKey,
        body: {
          agent_id: agentId || undefined,
          description,
          location: "System test",
          bounty_usdc: 1,
          deadline_hours: 1,
          // no fund / escrow_tx_hash / on_chain_id — points only, custody is retired
        },
      });
      if (r.status === 410) return s.fail(`custody gate rejected a points task (should not happen): ${r.text}`);
      if (!r.ok) return s.fail(`post ${r.status} ${r.text}`);
      taskId = r.json?.task?.id;
      if (!taskId) return s.fail(`no task id in response: ${r.text}`);
      facts.taskId = taskId;
      facts.taskUrl = `${BASE}/task/${taskId}`;
      s.ok(`created ${taskId}`);
    }
  }

  /* 5. it is actually on the board (not just in the POST response) */
  {
    const s = step("appears on board");
    if (!FIRE) {
      s.skip("would re-read GET /api/tasks and find the id");
    } else {
      const r = await http("GET", "/api/tasks");
      const found = (r.json?.tasks || []).find((t) => t.id === taskId);
      if (!found) return s.fail("posted task is NOT in GET /api/tasks — the board never saw it");
      s.ok(`status=${found.status} reward=${found.rewardType} bounty=${found.bountyUsdc}`);
    }
  }

  /* 6. claim it */
  const runner = `dev_smoke_${RUN_ID}`;
  {
    const s = step("claim as runner");
    if (!FIRE) {
      s.skip(`would POST /api/tasks/{id}/claim as ${runner}`);
    } else {
      const r = await http("POST", `/api/tasks/${taskId}/claim`, { body: { claimant: runner } });
      if (!r.ok) return s.fail(`claim ${r.status} ${r.text}`);
      if (r.json?.task?.status !== "claimed") return s.fail(`claim returned status=${r.json?.task?.status}`);
      s.ok(`claimed by ${runner}`);
    }
  }

  /* 7. points baseline for the runner */
  let pointsBefore = 0;
  {
    const s = step("points baseline");
    if (!FIRE) {
      s.skip("would GET /api/proof-of-favour?address=<runner>");
    } else {
      const r = await http("GET", `/api/proof-of-favour?address=${encodeURIComponent(runner)}`);
      if (!r.ok) return s.fail(`points read ${r.status}`);
      pointsBefore = r.json?.profile?.totalPoints ?? 0;
      s.ok(`${pointsBefore} pts before`);
    }
  }

  /* 8. LANE A — the control. Synthetic proof MUST NOT pass, MUST NOT earn. */
  {
    const s = step("CONTROL: fake proof");
    if (!FIRE) {
      s.skip("would submit a generated PNG and assert verdict != pass");
    } else {
      const r = await http("POST", "/api/verify-proof", {
        body: {
          taskId,
          submitter: runner,
          proofImageBase64: controlPng(),
          proofNote: "Automated smoke control. This image is machine-generated and is not a photograph of any place.",
        },
      });
      if (!r.ok) return s.fail(`verify-proof ${r.status} ${r.text}`);
      const verdict = r.json?.verification?.verdict;
      const conf = r.json?.verification?.confidence;
      facts.controlVerdict = `${verdict} (conf ${conf})`;
      if (!verdict) return s.fail(`no verdict returned: ${r.text}`);
      if (verdict === "pass") {
        s.fail(`verifier PASSED a machine-generated image — the AI-proof guard did not fire`);
      } else {
        s.ok(`rejected: verdict=${verdict} conf=${conf} — guard fired`);
      }
    }
  }

  /* 9. the control must not have paid */
  {
    const s = step("CONTROL: zero earned");
    if (!FIRE) {
      s.skip("would assert points delta == 0 after the fake proof");
    } else {
      const r = await http("GET", `/api/proof-of-favour?address=${encodeURIComponent(runner)}`);
      const after = r.json?.profile?.totalPoints ?? 0;
      const delta = after - pointsBefore;
      facts.controlPoints = delta;
      if (delta > 0) s.fail(`fake proof credited ${delta} points — AI proof earned, which must never happen`);
      else s.ok(`delta ${delta} — nothing earned`);
    }
  }

  /* 10. LANE B — a real human photo, opt-in */
  {
    const s = step("HUMAN: real photo");
    if (!PHOTO) {
      s.skip("not run — pass --photo <file> to prove a human can earn");
    } else if (!FIRE) {
      const p = realPhoto(PHOTO);
      s.skip(`would submit ${PHOTO} (${(p.bytes / 1024).toFixed(0)}KB) on a second task`);
    } else {
      // A fresh task: the control task is already completed/closed above.
      const r0 = await http("POST", "/api/agent/tasks", {
        auth: agentKey,
        body: {
          agent_id: agentId || undefined,
          description: description + " [human lane]",
          location: "System test",
          bounty_usdc: 1,
          deadline_hours: 1,
        },
      });
      if (!r0.ok) return s.fail(`post (human lane) ${r0.status} ${r0.text}`);
      const t2 = r0.json?.task?.id;
      const runner2 = `dev_smoke_h_${RUN_ID}`;
      await http("POST", `/api/tasks/${t2}/claim`, { body: { claimant: runner2 } });
      const before = (await http("GET", `/api/proof-of-favour?address=${encodeURIComponent(runner2)}`)).json?.profile?.totalPoints ?? 0;
      const photo = realPhoto(PHOTO);
      const r = await http("POST", "/api/verify-proof", {
        body: { taskId: t2, submitter: runner2, proofImageBase64: photo.uri, proofNote: "Real photograph submitted by a human for the FAVOUR loop check." },
      });
      if (!r.ok) return s.fail(`verify-proof (human) ${r.status} ${r.text}`);
      const verdict = r.json?.verification?.verdict;
      facts.realVerdict = `${verdict} (conf ${r.json?.verification?.confidence})`;
      const after = (await http("GET", `/api/proof-of-favour?address=${encodeURIComponent(runner2)}`)).json?.profile?.totalPoints ?? 0;
      facts.realPoints = after - before;
      if (verdict === "pass" && facts.realPoints > 0) s.ok(`pass · +${facts.realPoints} pts credited · task ${t2}`);
      else if (verdict === "pass") s.fail(`verdict pass but points delta was ${facts.realPoints} — the earn path did not settle`);
      else s.fail(`real photo was ${verdict} — a human doing this favour would not have earned`);
    }
  }

  /* 11. leave the board clean */
  {
    const s = step("board left clean");
    if (!FIRE) {
      s.skip("smoke tasks carry a 1h deadline and are swept by the expire-tasks cron");
    } else if (KEEP) {
      s.skip("--keep: smoke task left on the board deliberately");
    } else {
      const r = await http("GET", "/api/tasks");
      const stray = (r.json?.tasks || []).filter(
        (t) => t.status === "open" && typeof t.description === "string" && t.description.includes("[SYSTEM SMOKE TEST")
      );
      // /cancel is session-cookie owned, so a script cannot cancel; the 1h
      // deadline + expire-tasks cron (0 6 * * *) is the sweep. Report honestly.
      if (stray.length) s.ok(`${stray.length} smoke task(s) still open — expire within 1h, marked SMOKE in the description`);
      else s.ok("no smoke tasks left open");
    }
  }
}

main()
  .catch((err) => {
    failed = true;
    steps.push({ name: "unhandled error", status: "FAIL", detail: String(err && err.message || err), ms: 0 });
  })
  .then(() => {
    receipt();
    process.exit(failed ? 1 : 0);
  });
