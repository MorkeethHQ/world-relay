#!/usr/bin/env node
// THE TEST PRODUCT WALK (14 Oct 2026). TEST DATA only, local only.
//
// One labelled favour, "FAVOUR TEST, not real", walks the whole loop through
// the app's own endpoints, as the people who would do each step:
//   1. TEST Ana posts the favour.
//   2. TEST Ben claims it.
//   3. Ben runs the photo precheck (with no model key this is the app's own
//      stub answer, and the walk says so).
//   4. Ben sends the proof. The fixture's stand-in check accepts it.
//   5. The favour is completed and Ben's points moved.
//   6. Ana and Ben write in the favour's chat. A reviewer who is not a party
//      gets no messages.
//   7. TEST Reviewer 1 gets Ben's proof in the swipe jury, judges it, and the
//      day count moves.
//   8. A poster without a session: masked row, a signature asked, then approve.
// Every step prints PASS or FAIL. The exit code is the number of FAILs.
//
//   node scripts/test-product-walk.mjs [--app http://localhost:3220] [--store http://127.0.0.1:8089]
//
// It refuses any store that is not the fake on 127.0.0.1 and any app that is
// not on localhost, the same rule as scripts/review-fixture.mjs. It writes no
// store key directly: every write goes through an app endpoint.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const APP = arg("--app", "http://localhost:3220").replace(/\/$/, "");
const STORE = arg("--store", "http://127.0.0.1:8089").replace(/\/$/, "");
const fx = JSON.parse(readFileSync(join(here, "review-fixture.json"), "utf8"));

const stop = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(2); };
if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(STORE)) stop(`the store must be the local fake on 127.0.0.1, got ${STORE}`);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(APP)) stop(`the app must be on localhost, got ${APP}`);
const log = await fetch(`${STORE}/__log`).then((r) => r.json()).catch(() => null);
if (!log || log.fake !== true) stop(`${STORE} did not answer as the fake store`);

const who = (k) => fx.participants.find((p) => p.key === k);
const ANA = who("ana"), BEN = who("ben"), REV = who("rev1");
const cookieFor = (address) => {
  const payload = `${address.toLowerCase()}.${Date.now() + 3600_000}`;
  const sig = createHmac("sha256", fx.sessionSecret).update(payload).digest("base64url");
  return `favour_session=${Buffer.from(payload).toString("base64url")}.${sig}`;
};
async function api(path, { method = "GET", body, as } = {}) {
  const r = await fetch(`${APP}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(as ? { Cookie: cookieFor(as.address) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) };
}

let fails = 0;
const step = (n, ok, what, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}. ${what}${detail ? `  (${detail})` : ""}`);
  return ok;
};
const short = (o) => JSON.stringify(o).slice(0, 220);

console.log(`TEST DATA walk. App ${APP}, store ${STORE} (the local fake, in memory).\n`);
const TITLE = "FAVOUR TEST, not real: photo of a coffee cup on your desk";

// 1. Ana posts.
const posted = await api("/api/tasks", {
  method: "POST", as: ANA,
  body: {
    poster: ANA.address,
    description: `${TITLE}. Put any cup on your desk and take one clear photo from above. This is a test favour on a local machine.`,
    location: "Anywhere", category: "photo", rewardType: "points", bountyUsdc: 5, deadlineHours: 24,
  },
});
const task = posted.body.task;
if (!step(1, posted.ok && !!task?.id, "Ana posts the TEST favour", `${posted.status} ${task ? task.id : short(posted.body)}`)) process.exit(fails);
const pointsOf = async (p) => (await api(`/api/reputation?address=${p.address}`, { as: p })).body;
const benBefore = await pointsOf(BEN);
// The app keeps a copy of each person's points in its own memory
// (lib/reputation.ts localCache), so a new store behind an app that already ran
// still shows old points. Start BOTH again for a clean walk.
if (Number(benBefore?.totalPointsEarned ?? 0) !== 0) stop(`TEST Ben already has ${benBefore.totalPointsEarned} points. Stop the app and the store, start both again, seed, then walk.`);

// 2. Ben claims.
const claimed = await api(`/api/tasks/${task.id}/claim`, { method: "POST", as: BEN, body: { claimant: BEN.address } });
step(2, claimed.ok, "Ben claims it", `${claimed.status} ${claimed.ok ? claimed.body.task?.status : short(claimed.body)}`);

// 3. Ben runs the precheck on his photo.
const photo = readFileSync(join(here, "..", "public", "hero", "coffee.jpg")).toString("base64");
const pre = await api("/api/proof-precheck", { method: "POST", as: BEN, body: { imageBase64: photo, taskDescription: TITLE } });
step(3, pre.ok && typeof pre.body.likely === "string", "Precheck answers", `${pre.status} likely=${pre.body.likely}; with no model key this is the app's stub answer, not a model`);

// 4. Ben sends the proof.
const proof = await api("/api/verify-proof", {
  method: "POST", as: BEN,
  body: { taskId: task.id, submitter: BEN.address, proofImageBase64: photo, proofNote: "My cup on my desk. TEST DATA." },
});
step(4, proof.ok && proof.body.verification?.verdict === "pass", "Ben sends the proof and the check accepts it", `${proof.status} ${short(proof.body.verification ?? proof.body)}`);

// 5. Completed, and Ben's points moved.
const after = (await api(`/api/tasks/${task.id}`, { as: ANA })).body.task ?? {};
const benAfter = await pointsOf(BEN);
step("5a", after.status === "completed", "The favour is completed", `status=${after.status}`);
const pts = (r) => Number(r?.totalPointsEarned ?? 0);
step("5b", pts(benAfter) > pts(benBefore), "Ben's points went up", `${pts(benBefore)} to ${pts(benAfter)}`);

// 6. Chat between the two parties, and nothing for a stranger.
const m1 = await api(`/api/tasks/${task.id}/messages`, { method: "POST", as: ANA, body: { sender: ANA.address, text: "TEST: thanks Ben, nice cup." } });
const m2 = await api(`/api/tasks/${task.id}/messages`, { method: "POST", as: BEN, body: { sender: BEN.address, text: "TEST: you are welcome." } });
const seenByBen = (await api(`/api/tasks/${task.id}/messages`, { as: BEN })).body.messages ?? [];
const texts = seenByBen.map((m) => m.text);
step("6a", m1.ok && m2.ok && texts.includes("TEST: thanks Ben, nice cup.") && texts.includes("TEST: you are welcome."), "Ana and Ben chat, and both messages are there", `${m1.status}/${m2.status}, ${seenByBen.length} messages`);
const stranger = await api(`/api/tasks/${task.id}/messages`, { as: REV });
step("6b", (stranger.body.messages ?? []).length === 0, "A reviewer who is not a party sees no messages", `${stranger.status} ${short(stranger.body)}`);

// 7. The proof reaches the swipe jury, and a verdict counts.
// The deck shows each proof under its own favour's words or under another
// favour's, fixed by the task id (lib/jury.ts composeDeck), so half of all
// favours always come as a mismatch. Ben's card is found by his own note, and
// the right call is "match" only when the words are this favour's.
const deck = (await api(`/api/jury?address=${REV.address}`, { as: REV })).body;
const card = (deck.cards ?? []).find((c) => c.proofNote === "My cup on my desk. TEST DATA.");
const rightCall = card?.description?.startsWith(TITLE) ? "match" : "not";
step("7a", !!card, "Reviewer 1 is dealt Ben's proof in the jury", `${(deck.cards ?? []).length} cards, practice=${deck.practice}, shown under ${rightCall === "match" ? "its own words" : "another favour's words"}`);
const dayBefore = (await api(`/api/jury/record?address=${REV.address}`, { as: REV })).body.day;
const verdict = card ? await api("/api/jury", { method: "POST", as: REV, body: { address: REV.address, cardId: card.cardId, verdict: rightCall } }) : { status: 0, ok: false, body: {} };
step("7b", verdict.ok && verdict.body.correct === true && verdict.body.pointsAwarded > 0, `Reviewer 1 calls it "${rightCall}", it is saved, graded right, and earns a point`, `${verdict.status} ${short(verdict.body)}`);
const dayAfter = (await api(`/api/jury/record?address=${REV.address}`, { as: REV })).body.day;
step("7c", !!dayAfter && dayAfter.today === (dayBefore?.today ?? 0) + 1, "The jury day count moved by one", `${dayBefore?.today ?? "none"} to ${dayAfter?.today ?? "none"} of ${dayAfter?.goal ?? "?"}; needs NEXT_PUBLIC_FAVOUR_JURY_GAME=1`);

// 8. A poster whose session has expired (Codex, 14 Oct 2026). The task API
//    masks wallets without a session, so the page holds a public id, not the
//    poster's wallet. The server must ask for a signature, not refuse the
//    poster, and must take the poster from the session afterwards.
//    TEST Reviewer 2 posts (Ana already used today's one free favour).
const R2 = who("rev2");
const p2 = await api("/api/tasks", { method: "POST", as: R2, body: { poster: R2.address, description: "FAVOUR TEST, not real: a photo of any window near you, taken from inside", location: "Anywhere", category: "photo", rewardType: "points", bountyUsdc: 5, deadlineHours: 24 } });
const t2 = p2.body.task;
await api(`/api/tasks/${t2.id}/claim`, { method: "POST", as: BEN, body: { claimant: BEN.address } });
const photo2 = readFileSync(join(here, "..", "public", "hero", "desk.jpg")).toString("base64");
const flagged = await api("/api/verify-proof", { method: "POST", as: BEN, body: { taskId: t2.id, submitter: BEN.address, proofImageBase64: photo2, proofNote: "My window. TEST FLAG" } });
step("8a", flagged.body.verification?.verdict === "flag", "Ben's proof on Reviewer 2's favour is flagged", `${flagged.status}`);
const masked = (await api(`/api/tasks/${t2.id}`)).body.task ?? {};
step("8b", typeof masked.poster === "string" && !/^0x[0-9a-f]{40}$/i.test(masked.poster) && masked.isOwnTask === false, "Without a session the row shows a public id, not the poster's wallet", `poster=${masked.poster}`);
const noSession = await api(`/api/tasks/${t2.id}/confirm`, { method: "POST", body: { poster: masked.poster, approved: true } });
step("8c", noSession.status === 401 && noSession.body.code === "reauth_required", "Approving with no session asks for a signature", `${noSession.status} ${short(noSession.body)}`);
const withSession = await api(`/api/tasks/${t2.id}/confirm`, { method: "POST", as: R2, body: { poster: masked.poster, approved: true } });
const after2 = (await api(`/api/tasks/${t2.id}`, { as: R2 })).body.task ?? {};
step("8d", withSession.ok && after2.status === "completed" && after2.isOwnTask === true, "After signing in, the poster approves while the page still holds the public id", `${withSession.status} status=${after2.status}`);
const doerTry = await api(`/api/tasks/${t2.id}/confirm`, { method: "POST", as: BEN, body: { poster: R2.address, approved: true } });
step("8e", doerTry.status === 403, "The doer naming the poster is still refused", `${doerTry.status}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}. Task ${task.id}. Nothing here left this machine.`);
process.exit(fails);
