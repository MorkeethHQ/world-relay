import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createMemoryRedis } from "./helpers/memory-redis";

// PASSING A FLAGGED PROOF WITHOUT DECIDING IT (2026-10-05). TEST DATA.
//
// Seen in a real browser: the review page showed one card and the only way past
// it was a vote, so eight old held Welcome proofs stood in front of a company
// proof. This file checks three things:
//   1. the navigation itself (pure state: next, previous, wrap, select, reason);
//   2. on the REAL review routes, that a reviewer can decide one proof while
//      the proofs they passed keep no vote, no tally and no change, and are
//      still dealt to every reviewer;
//   3. that the page moves between proofs only through that pure state.
// The suite has no browser DOM (no jsdom or similar is installed), so the page
// component is not mounted and clicked here. Part 3 is therefore a reading of
// the page's source. The click itself is Sol's to see in a real browser.
const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
vi.mock("@/lib/redis", () => ({ getRedis: () => mem.current!.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));

import { START, clampIndex, navReduce, orderReviewCards, positionLabel, type ReviewNav } from "@/lib/review-nav";
import { GET as reviewDeck, POST as reviewVote } from "@/app/api/review/flagged/route";
import { HOUSE_REVIEW_DECK_MAX } from "@/lib/house-review";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { WELCOME_ORIGINAL_STEPS } from "@/lib/welcome-shape";
import type { Task } from "@/lib/types";
import type { NextRequest } from "next/server";

describe("moving between proofs is local state", () => {
  const at = (index: number, reason = ""): ReviewNav => ({ index, reason });
  it("next and previous step one proof and wrap, so every proof is reachable from any other", () => {
    expect(navReduce(at(0), { type: "next", count: 3 }).index).toBe(1);
    expect(navReduce(at(2), { type: "next", count: 3 }).index).toBe(0);
    expect(navReduce(at(0), { type: "previous", count: 3 }).index).toBe(2);
    expect(navReduce(at(1), { type: "previous", count: 3 }).index).toBe(0);
    // From proof 1, eight presses of Next visit all nine proofs once.
    let s = START; const seen = [s.index];
    for (let i = 0; i < 8; i++) { s = navReduce(s, { type: "next", count: 9 }); seen.push(s.index); }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("a reason never follows the reviewer to another proof", () => {
    const written = navReduce(at(0), { type: "reason", value: "about proof 1" });
    expect(written).toEqual({ index: 0, reason: "about proof 1" });
    expect(navReduce(written, { type: "next", count: 3 })).toEqual({ index: 1, reason: "" });
    expect(navReduce(written, { type: "previous", count: 3 })).toEqual({ index: 2, reason: "" });
    expect(navReduce(written, { type: "select", count: 3, index: 2 })).toEqual({ index: 2, reason: "" });
    // Choosing the proof already on screen changes nothing.
    expect(navReduce(written, { type: "select", count: 3, index: 0 })).toBe(written);
  });
  it("a single proof, or none, has nowhere to go", () => {
    const one = navReduce(at(0, "kept"), { type: "next", count: 1 });
    expect(one).toEqual({ index: 0, reason: "kept" });
    expect(navReduce(at(4, "x"), { type: "next", count: 0 })).toEqual(START);
  });
  it("after the deck is loaded again the place is kept when it exists, and the reason is cleared", () => {
    expect(navReduce(at(2, "old"), { type: "deck", count: 5 })).toEqual({ index: 2, reason: "" });
    expect(navReduce(at(4, "old"), { type: "deck", count: 3 })).toEqual({ index: 2, reason: "" });
    expect(navReduce(at(4, "old"), { type: "deck", count: 0 })).toEqual({ index: 0, reason: "" });
  });
  it("the index is always inside the deck, and the label says where", () => {
    expect(clampIndex(-3, 4)).toBe(0);
    expect(clampIndex(99, 4)).toBe(3);
    expect(clampIndex(Number.NaN, 4)).toBe(0);
    expect(positionLabel(0, 9)).toBe("Proof 1 of 9");
    expect(positionLabel(8, 9)).toBe("Proof 9 of 9");
    expect(positionLabel(0, 0)).toBe("");
  });
  it("old held Welcome claims are offered last, and nothing is dropped", () => {
    const cards = [
      { source: "house" as const, scope: "welcome_source", id: "old1" },
      { source: "house" as const, scope: "welcome_source", id: "old2" },
      { source: "house" as const, scope: "house_text", id: "text" },
      { source: "house" as const, scope: "welcome_instance", id: "inst" },
      { source: "jury" as const, id: "company" },
    ];
    expect(orderReviewCards(cards).map((c) => c.id)).toEqual(["text", "inst", "company", "old1", "old2"]);
    expect(orderReviewCards(cards)).toHaveLength(cards.length);
  });
  it("the navigation module cannot reach the network at all", () => {
    const src = readFileSync(join(__dirname, "..", "lib", "review-nav.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\bimport\b|\bfetch\b|\brequire\b|XMLHttpRequest|sendBeacon/);
  });
});

// --- the real routes ------------------------------------------------------
const ANA = "0x7e57da7a000000000000000000000000000000a1";
const EARLIER = "0x7e57da7a000000000000000000000000000000e0";
const JUDGES = ["0x7e57da7a000000000000000000000000000000c1", "0x7e57da7a000000000000000000000000000000c2", "0x7e57da7a000000000000000000000000000000c3"];
const TARGET = "target00-0000-4000-8000-000000000001";
const OLD = WELCOME_ORIGINAL_STEPS.slice(0, 8).map((_, i) => `held0000-0000-4000-8000-00000000000${i}`);

function req(url: string, wallet: string, body?: unknown): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}
function row(over: Partial<Task>): Task {
  return {
    id: "x", poster: "agent:relay", claimant: ANA, category: "feedback", description: "TEST DATA favour", location: "Anywhere", lat: null, lng: null,
    bountyUsdc: 6, deadline: "2027-07-05T00:00:00.000Z", status: "claimed", proofSubmissionId: "p", proofImageUrl: null, proofImages: null,
    proofNote: "TEST DATA answer", verificationResult: { verdict: "flag", reasoning: "TEST DATA: not sure", confidence: 0.5 }, attestationTxHash: null,
    agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard",
    rewardType: "points", donOnChainId: null, donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 100, completionCount: 0, createdAt: "2026-10-01T00:00:00.000Z", ...over,
  };
}
type DealtCard = { caseId: string; proofToken: string; scope: string };
const dealt = async (judge: string) => (await (await reviewDeck(req("/api/review/flagged", judge))).json()).cards as DealtCard[];
const reviewKeys = () => [...mem.current!.kv.keys(), ...mem.current!.sets.keys(), ...mem.current!.hashes.keys(), ...mem.current!.lists.keys()].filter((k) => k.startsWith("house:review:"));

beforeEach(async () => {
  mem.current = createMemoryRedis();
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  // Eight old held Welcome claims, as on production on 5 Oct, and one written
  // answer on a plain favour that a reviewer actually came to decide.
  for (const [i, id] of OLD.entries()) {
    const t = row({ id, claimant: EARLIER, campaignId: "first-favour", description: WELCOME_ORIGINAL_STEPS[i], maxCompletions: 1000, proofImageUrl: "https://blob.test/old.jpg", proofImages: ["https://blob.test/old.jpg"], proofSubmissionId: `old-${i}`, createdAt: `2026-07-05T10:0${i}:00.000Z` });
    await mem.current.client.set(`task:${id}`, JSON.stringify(t));
    await mem.current.client.sadd("task_ids", id);
  }
  await mem.current.client.set(`task:${TARGET}`, JSON.stringify(row({ id: TARGET, createdAt: "2026-07-01T00:00:00.000Z" })));
  await mem.current.client.sadd("task_ids", TARGET);
  for (const j of JUDGES) await mem.current.client.hset(`jury:stats:${j}`, { judged: 12, correct: 10 });
});

describe("a reviewer reaches any queued proof without voting on the others", () => {
  it("every proof that waits is in the deck, not only the first five", async () => {
    const cards = await dealt(JUDGES[0]);
    expect(cards).toHaveLength(9);
    expect(HOUSE_REVIEW_DECK_MAX).toBeGreaterThanOrEqual(9);
    expect(cards.map((c) => c.caseId).sort()).toEqual([TARGET, ...OLD].sort());
    // As the page orders them, the proof that is not an old held claim leads.
    const ordered = orderReviewCards(cards.map((c) => ({ ...c, source: "house" as const })));
    expect(ordered[0].caseId).toBe(TARGET);
    expect(ordered.slice(1).every((c) => c.scope === "welcome_source")).toBe(true);
  });

  it("looking at the deck, as often as you like, writes nothing", async () => {
    const before = JSON.stringify({ kv: [...mem.current!.kv.entries()], sets: [...mem.current!.sets.entries()].map(([k, v]) => [k, [...v]]), hashes: [...mem.current!.hashes.keys()], lists: [...mem.current!.lists.keys()] });
    for (let i = 0; i < 4; i++) await dealt(JUDGES[0]);
    const after = JSON.stringify({ kv: [...mem.current!.kv.entries()], sets: [...mem.current!.sets.entries()].map(([k, v]) => [k, [...v]]), hashes: [...mem.current!.hashes.keys()], lists: [...mem.current!.lists.keys()] });
    expect(after).toBe(before);
    expect(reviewKeys()).toEqual([]);
  });

  it("three reviewers decide the one proof they came for; the eight they passed have no vote and are still dealt to everyone", async () => {
    const oldBefore = OLD.map((id) => mem.current!.raw(`task:${id}`));
    for (const j of JUDGES) {
      const card = (await dealt(j)).find((c) => c.caseId === TARGET)!;
      const res = await reviewVote(req("/api/review/flagged", j, { address: j, caseId: TARGET, proofToken: card.proofToken, verdict: "real", reason: "TEST DATA: the answer is on topic and specific." }));
      expect(res.status).toBe(200);
    }
    expect((await getProofOfFavour(ANA)).totalPoints).toBe(6);
    // The passed proofs: untouched rows, no vote, no tally, no marker, no credit.
    expect(OLD.map((id) => mem.current!.raw(`task:${id}`))).toEqual(oldBefore);
    for (const id of OLD) expect(reviewKeys().filter((k) => k.includes(id))).toEqual([]);
    expect((await getProofOfFavour(EARLIER)).totalPoints).toBe(0);
    // They are still waiting, for these reviewers and for any other.
    for (const j of JUDGES) expect((await dealt(j)).map((c) => c.caseId).sort()).toEqual([...OLD].sort());
  });
});

describe("the page moves between proofs only through that state", () => {
  const page = readFileSync(join(__dirname, "..", "app", "jury", "appeals", "page.tsx"), "utf8");
  const stepFn = page.slice(page.indexOf("const step = "), page.indexOf("\n", page.indexOf("const step = ")));
  it("Next and Previous call one handler that only clears the message and moves", () => {
    expect(stepFn).toBe('const step = (type: "next" | "previous") => { setMessage(""); dispatch({ type, count }); };');
    expect(page).toMatch(/onClick=\{\(\) => step\("previous"\)\}[^>]*>Previous</);
    expect(page).toMatch(/onClick=\{\(\) => step\("next"\)\}[^>]*>Next proof</);
  });
  it("the only requests that change anything are inside decide(), and the page has exactly two POSTs", () => {
    const decide = page.slice(page.indexOf("async function decide("), page.indexOf("const canDecide"));
    expect((page.match(/method: "POST"/g) || []).length).toBe(2);
    expect((decide.match(/method: "POST"/g) || []).length).toBe(2);
    // Nothing between the navigation controls can submit: they are plain buttons.
    const nav = page.slice(page.indexOf('<nav aria-label="Flagged proofs"'), page.indexOf("</nav>"));
    expect((nav.match(/type="button"/g) || []).length).toBe(2);
    expect(nav).not.toMatch(/decide\(|fetch\(|<form/);
  });
  it("the card on screen is the one at the current position, and its vote still carries its own proof token", () => {
    expect(page).toMatch(/const card = deck\?\.cards\[index\];/);
    expect(page).not.toMatch(/deck\?\.cards\[0\]/);
    expect(page).toMatch(/caseId: card\.id, proofToken: card\.proofToken, verdict, reason/);
  });
  it("the controls show the position, say that moving on is not a vote, and appear only with more than one proof", () => {
    expect(page).toMatch(/\{card && count > 1 && \(/);
    expect(page).toMatch(/\{positionLabel\(index, count\)\}/);
    expect(page).toMatch(/Moving on does not vote\./);
  });
  it("a proof is still shown only to a qualified reviewer", () => {
    expect(page).toMatch(/\.\.\.\(qualified \? \(\(jd\?\.cards \?\? \[\]\) as JuryCard\[\]\) : \[\]\)/);
    expect(page).toMatch(/const canDecide = !!deck\?\.qualified && reason\.trim\(\)\.length >= 20 && !busy;/);
  });
});
