#!/usr/bin/env node
// SEED THE LOCAL REVIEW FIXTURE (2026-10-05). TEST DATA only.
//
// It fills the in-memory fake store (scripts/fake-store.mjs) behind a locally
// running app so a person can walk: first visit, Welcome, a company campaign, a
// proof sent, Discover more, an open poll, and the one Review entry.
//
//   node scripts/review-fixture.mjs [--app http://localhost:3210] [--store http://127.0.0.1:8079]
//
// WHAT IT REFUSES. It writes only to a store on 127.0.0.1 that answers /__log
// with "fake": true, and only through an app on localhost. Any other address
// stops it before the first write. It reads no env file of the real app and
// needs no cloud credential.
//
// HOW IT SEEDS. Through the app's own endpoints wherever one exists (the seed
// route, polls, campaign draft and publish, the hand-check script). Direct store
// writes are used only for state no endpoint can produce, and each is named:
//   - the 8 Welcome rows held "claimed" by an earlier flagged proof, which is the
//     state public GET /api/tasks showed on production on 5 Oct 2026,
//   - two closed polls (a poll cannot be created already closed),
//   - a graded record for three TEST reviewers (10 of 12), so a human decision
//     can be rehearsed without playing 30 cards first,
//   - three finished TEST proofs for the Review deck to deal.
// It adds no vote to any poll and no completion to any person.
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const APP = arg("--app", "http://localhost:3210").replace(/\/$/, "");
const STORE = arg("--store", "http://127.0.0.1:8079").replace(/\/$/, "");
const fx = JSON.parse(readFileSync(join(here, "review-fixture.json"), "utf8"));

export function isLoopbackStore(u) { return /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(u); }
export function isLocalApp(u) { return /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(u); }

function stop(msg) { console.error(`REFUSED: ${msg}`); process.exit(2); }
if (!isLoopbackStore(STORE)) stop(`the store must be the local fake on 127.0.0.1, got ${STORE}`);
if (!isLocalApp(APP)) stop(`the app must be running on localhost, got ${APP}`);
const log = await fetch(`${STORE}/__log`).then((r) => r.json()).catch(() => null);
if (!log || log.fake !== true) stop(`${STORE} did not answer as the fake store. Start it first: node scripts/fake-store.mjs --empty --fixture scripts/review-fixture.json`);
console.log(`TEST DATA. Store: ${STORE} (the local fake, in memory). App: ${APP}.`);

async function cmd(...args) {
  const r = await fetch(STORE, { method: "POST", headers: { Authorization: "Bearer local-fake-not-a-secret", "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${args[0]} ${r.status} ${j.error ?? ""}`);
  return j.result;
}
function cookieFor(address) {
  const payload = `${address.toLowerCase()}.${Date.now() + 3600_000}`;
  const sig = createHmac("sha256", fx.sessionSecret).update(payload).digest("base64url");
  return `favour_session=${Buffer.from(payload).toString("base64url")}.${sig}`;
}
async function api(path, { method = "GET", body, as } = {}) {
  const r = await fetch(`${APP}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookieFor(as) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} answered ${r.status}: ${j.error ?? JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const who = (k) => fx.participants.find((p) => p.key === k);
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

if ((await cmd("EXISTS", "fixture:seeded")) === 1) stop("this store is already seeded. Restart the fake store for a clean one.");

// 1. THE ORIGINAL WELCOME FAVOURS, through the app's seed route. The texts are
//    scripts/first-favour.json, unchanged. The first 8 are the ones still running
//    on production; the last 2 expired there, so they are not seeded as open.
const original = JSON.parse(readFileSync(join(here, "first-favour.json"), "utf8")).tasks.slice(0, 8);
const seeded = await api("/api/seed", { method: "POST", body: { secret: fx.adminSecret, tasks: original } });
console.log(`1. Welcome: ${seeded.seeded} original favours posted through POST /api/seed.`);

// 1b. DIRECT WRITE: hold all 8 with an earlier person's flagged photo, as on
//     production on 5 Oct 2026. This is the state the fixture exists to show.
let held = 0;
for (const t of seeded.tasks) {
  const row = JSON.parse(await cmd("GET", `task:${t.id}`));
  Object.assign(row, {
    status: "claimed",
    claimant: fx.earlierHolder,
    proofSubmissionId: randomUUID(),
    proofImageUrl: `${APP}/hero/sticky-notes.jpg`,
    proofImages: [`${APP}/hero/sticky-notes.jpg`],
    proofNote: "TEST DATA: an earlier person's proof, flagged and never decided.",
    verificationResult: { verdict: "flag", reasoning: "TEST DATA copy of the production state on 5 Oct 2026: flagged, nobody could decide it.", confidence: 0.5 },
    completionCount: 1,
    createdAt: "2026-07-05T10:00:00.000Z",
  });
  await cmd("SET", `task:${t.id}`, JSON.stringify(row));
  held++;
}
console.log(`   ${held} of ${seeded.tasks.length} are held "claimed" by an earlier flagged proof (direct write, the production state).`);

// 2. OPEN POLLS, through POST /api/polls. Zero votes. The fixture never votes.
for (const p of fx.polls) await api("/api/polls", { method: "POST", body: { ...p, creator: fx.pollAuthor, category: "test-data", durationHours: 72 } });
console.log(`2. Polls: ${fx.polls.length} open polls created through POST /api/polls, 0 votes on each.`);
// 2b. DIRECT WRITE: two closed polls, 0 votes, for the closed-history control.
for (const [i, p] of fx.closedPolls.entries()) {
  const id = randomUUID();
  await cmd("SET", `poll:${id}`, JSON.stringify({ id, ...p, creator: fx.pollAuthor, category: "test-data", createdAt: iso(now - (10 + i) * 86400_000), endsAt: iso(now - (7 + i) * 86400_000) }));
  await cmd("SADD", "poll_ids", id);
  await cmd("HSET", `poll:${id}:votes`, ...p.options.flatMap((o) => [o, "0"]));
}
console.log(`   ${fx.closedPolls.length} closed polls written directly (a poll cannot be created closed), 0 votes on each.`);

// 3. A COMPANY CAMPAIGN, through the real draft and publish routes, then marked
//    checked with the real hand-check script, pointed at the fake.
const company = who("company").address;
const draft = (await api("/api/campaigns/drafts", { method: "POST", as: company, body: fx.company })).draft;
const published = (await api(`/api/campaigns/drafts/${draft.id}/publish`, { method: "POST", as: company })).campaign;
const mark = spawnSync(process.execPath, [join(here, "mark-company-checked.mjs"), published.id, "--apply"], {
  env: { PATH: process.env.PATH, KV_REST_API_URL: STORE, KV_REST_API_TOKEN: "local-fake-not-a-secret" }, encoding: "utf8",
});
if (mark.status !== 0) throw new Error(`mark-company-checked failed: ${mark.stderr || mark.stdout}`);
console.log(`3. Company campaign "${published.company}" drafted, published and hand-checked (id ${published.id}).`);

// 4. DIRECT WRITE: a graded record for the three TEST reviewers.
for (const k of ["rev1", "rev2", "rev3"]) await cmd("HSET", `jury:stats:${who(k).address.toLowerCase()}`, "judged", "12", "correct", "10");
console.log("4. Reviewers: TEST Reviewer 1, 2 and 3 given a graded record of 10 of 12 (direct write).");

// 5. DIRECT WRITE: three finished TEST proofs, so the Review deck has cards.
const finished = [
  ["TEST DATA favour: photo a coffee where you are", "/hero/coffee.jpg", "TEST DATA proof: a flat white, Lisbon."],
  ["TEST DATA favour: photo your desk right now", "/hero/desk.jpg", "TEST DATA proof: my desk on a Monday."],
  ["TEST DATA favour: photo something cold on a hot day", "/hero/icecream.jpg", "TEST DATA proof: pistachio, one scoop."],
];
for (const [i, [description, img, note]] of finished.entries()) {
  const id = randomUUID();
  await cmd("SET", `task:${id}`, JSON.stringify({
    id, poster: "agent:relay", claimant: `0x7e57da7a0000000000000000000000000000090${i}`, category: "photo", description,
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 5, deadline: iso(now + 30 * 86400_000), status: "completed",
    // Absolute, like a real stored proof (blob storage always is).
    proofImageUrl: `${APP}${img}`, proofImages: [`${APP}${img}`], proofNote: note,
    verificationResult: { verdict: "pass", reasoning: "TEST DATA: written by the fixture, no model was called.", confidence: 0.9 },
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, claimantVerification: null,
    requiresClaim: false, pendingRelease: false, maxCompletions: 1, completionCount: 1, createdAt: iso(now - (2 + i) * 3600_000),
  }));
  await cmd("SADD", "task_ids", id);
}
console.log(`5. Review deck: ${finished.length} finished TEST proofs written directly.`);

// 6. A few open TEST favours for "Discover more favours", through POST /api/seed.
const more = await api("/api/seed", { method: "POST", body: { secret: fx.adminSecret, tasks: [
  { description: "TEST DATA favour: what does the air smell like where you are right now? One honest line.", location: "Anywhere", category: "feedback", bountyUsdc: 5, rewardType: "points", deadlineHours: 240, maxCompletions: 100 },
  { description: "TEST DATA favour: which sound near you right now would you turn off, if you could?", location: "Anywhere", category: "feedback", bountyUsdc: 5, rewardType: "points", deadlineHours: 240, maxCompletions: 100 },
  { description: "TEST DATA favour: photo the nearest door to you and say where it leads.", location: "Anywhere", category: "photo", bountyUsdc: 8, rewardType: "points", deadlineHours: 240, maxCompletions: 100 },
] } });
console.log(`6. Board: ${more.seeded} open TEST favours posted through POST /api/seed.`);

await cmd("SET", "fixture:seeded", iso(now));
console.log("\nDONE. Open this in a browser:\n");
console.log(`  ${APP}/__fixture/            the TEST DATA start page (first visit, or sign in as a participant)`);
for (const p of fx.participants) console.log(`  ${APP}/__fixture/signin?as=${p.key}`.padEnd(52) + `${p.name}: ${p.role}`);
console.log(`  ${APP}/__fixture/signout`.padEnd(52) + "back to the signed-out first visit");
console.log("\nIn a proof note, type TEST FLAG to get a flagged proof, TEST FAIL for a rejected one, TEST DOWN for a check that does not run. Anything else is accepted. No model is called.");
console.log("\nStaged open polls (exact text):");
for (const p of fx.polls) console.log(`  "${p.question}"  [${p.options.join(" | ")}]`);
