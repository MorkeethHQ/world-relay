import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { createMemoryRedis } from "./helpers/memory-redis";

// THE PROVIDER REFUSES EVERY CALL (2026-10-05). TEST DATA, local store only.
//
// Production logs for nine /api/verify-proof requests carried the provider's
// HTTP 400 `invalid_request_error`, "Your credit balance is too low...". The app
// answered 200 and stored a flag: an outage had become a verdict on a person's
// proof.
//
// WHAT IS REAL HERE. The route, the store, points, reputation, completions, the
// Welcome and review code, AND src/lib/verify-proof.ts AND the installed
// provider SDK are all real. The only stand-in on the provider side is the HTTP
// response: `fetch` answers api.anthropic.com with the exact status and body
// from the logs, so the SDK itself builds its own BadRequestError. Any other
// network address fails the test. No key that works is present and nothing
// leaves this machine.
const LOW_CREDIT = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const mem = vi.hoisted(() => ({ current: null as ReturnType<typeof import("./helpers/memory-redis").createMemoryRedis> | null }));
const spies = vi.hoisted(() => ({ release: [] as unknown[], attest: [] as unknown[], notes: [] as Array<{ type: string }> }));
vi.mock("@/lib/redis", () => ({ getRedis: () => mem.current!.client }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/verification-tier", () => ({ tierGateError: async () => null, getUserVerificationLevel: async () => "orb" }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: async (...a: unknown[]) => { spies.release.push(a); return null; }, resolveDon: async (...a: unknown[]) => { spies.release.push(a); return null; } }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async (...a: unknown[]) => { spies.attest.push(a); return null; } }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async (n: { type: string }) => { spies.notes.push(n); } }));
vi.mock("@/lib/xmtp", () => ({ postProofSubmitted: async () => {}, postVerificationResult: async () => {}, postFollowUpQuestion: async () => {}, postSettlementConfirmation: async () => {}, syncAndProcessMessages: async () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateFollowUpQuestion: async () => null }));
vi.mock("@/lib/notifications", () => ({ notifyProofSubmitted: async () => {}, notifyVerified: async () => {}, notifyFlagged: async () => {}, notifyPaymentReleased: async () => {} }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
// The stored URL carries the photo's length, so two different photos on one
// favour can be told apart on the row.
vi.mock("@/lib/image-upload", () => ({ uploadProofImage: async (b: string, id: string, i: number) => `https://blob.test/${id}/${i}-${b.length}.jpg` }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));
vi.mock("@/lib/referral", () => ({ recordReferralActivation: async () => {} }));
vi.mock("@/lib/seed-caps", () => ({ checkSeedCap: async () => ({ allowed: true }), recordSeededEarn: async () => {} }));

import { POST as verifyProof } from "@/app/api/verify-proof/route";
import { POST as startWelcome } from "@/app/api/welcome/start/route";
import { GET as getWelcome } from "@/app/api/welcome/route";
import { GET as reviewDeck } from "@/app/api/review/flagged/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { getProofOfFavour } from "@/lib/proof-of-favour";
import { getReputation } from "@/lib/reputation";
import { getTask } from "@/lib/store";
import { listContributions } from "@/lib/completions";
import { CHECK_UNAVAILABLE_ERROR, TRY_AGAIN_LINE, proofKeptLabel, proofKeptLine, readProofSaved } from "@/lib/check-unavailable";
import { WELCOME_ORIGINAL_STEPS } from "@/lib/welcome-shape";
import type { Task } from "@/lib/types";
import type { NextRequest } from "next/server";

// TEST DATA wallets, synthetic identifiers, new for every test: the reputation
// module keeps a cache for the life of the process, so a wallet reused across
// tests would carry the last test's completions into this one's "no credit".
let ANA = "";
let BEN = "";
let walletSeq = 0;
const freshWallet = () => `0x7e57da7a${(++walletSeq).toString(16).padStart(32, "0")}`;
const JUDGE = "0x7e57da7a000000000000000000000000000000c1";
const PLAIN = "plain000-0000-4000-8000-00000000a001";
const SOURCE = "source00-0000-4000-8000-00000000a002";
const FUNDED = "funded00-0000-4000-8000-00000000a003";

// The provider, as the test controls it. "low_credit" is the exact logged
// answer. The others are what it says once it works again.
const provider = { mode: "low_credit" as "low_credit" | "pass" | "flag", calls: 0 };
const errorLog: unknown[][] = [];
// Nothing a contributor is sent may explain the outage in the provider's terms.
const INTERNALS = /credit balance|billing|plans &|purchase|anthropic|invalid_request_error|api key|upgrade/i;
const sent: string[] = [];

function providerFetch(input: unknown): Promise<Response> {
  const url = String(typeof input === "string" ? input : (input as { url?: string }).url ?? input);
  if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`TEST DATA: unexpected network call to ${url}`);
  provider.calls++;
  if (provider.mode === "low_credit") {
    return Promise.resolve(new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: LOW_CREDIT }, request_id: "req_test_data" }),
      { status: 400, headers: { "content-type": "application/json", "request-id": "req_test_data" } },
    ));
  }
  const verdict = provider.mode === "pass"
    ? { verdict: "pass", reasoning: "TEST DATA: on topic.", confidence: 0.95 }
    : { verdict: "flag", reasoning: "TEST DATA: not sure.", confidence: 0.5 };
  return Promise.resolve(new Response(
    JSON.stringify({ id: "msg_test_data", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: JSON.stringify(verdict) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200, headers: { "content-type": "application/json", "request-id": "req_test_data" } },
  ));
}

function req(url: string, wallet: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (wallet) headers.cookie = `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}`;
  return new Request(`http://localhost${url}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as NextRequest;
}
function favour(over: Partial<Task>): Task {
  return {
    id: PLAIN, poster: "agent:relay", claimant: null, category: "feedback", description: "TEST DATA favour: what does the air smell like where you are?",
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 6, deadline: "2027-07-05T00:00:00.000Z", status: "open",
    proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null, attestationTxHash: null, agent: null,
    aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard",
    rewardType: "points", donOnChainId: null, donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 100, completionCount: 0, createdAt: "2026-10-01T00:00:00.000Z", ...over,
  };
}
async function seed(t: Task) {
  await mem.current!.client.set(`task:${t.id}`, JSON.stringify(t));
  await mem.current!.client.sadd("task_ids", t.id);
}
// Every response a contributor receives is kept, to be searched for internals.
async function send(wallet: string, taskId: string, note: string, photo?: string) {
  const res = await verifyProof(req("/api/verify-proof", wallet, { taskId, submitter: wallet, proofNote: note, proofImages: photo ? [Buffer.from(photo).toString("base64")] : [] }));
  const text = await res.clone().text();
  sent.push(text);
  return { status: res.status, body: JSON.parse(text) as Record<string, any> };
}
const points = async (w: string) => (await getProofOfFavour(w)).totalPoints;
const keysLike = (prefix: string) => [...mem.current!.kv.keys(), ...mem.current!.sets.keys(), ...mem.current!.lists.keys(), ...mem.current!.hashes.keys()].filter((k) => k.startsWith(prefix));
// No credit of any kind for this person, anywhere a credit is written.
async function expectNoCredit(wallet: string, taskId: string) {
  expect(await points(wallet)).toBe(0);
  const profile = await getProofOfFavour(wallet);
  expect(profile.favoursCompleted).toBe(0);
  expect(profile.pointsHistory).toEqual([]);
  const rep = await getReputation(wallet);
  expect(rep.tasksCompleted).toBe(0);
  expect(rep.tasksFailed ?? 0).toBe(0);
  expect(rep.totalEarnedUsdc ?? 0).toBe(0);
  expect(await listContributions(wallet)).toEqual([]);
  expect(await mem.current!.client.sismember(`completed_claimants:${taskId}`, wallet)).toBe(0);
  expect(await mem.current!.client.sismember(`failed_claimants:${taskId}`, wallet)).toBe(0);
  expect(keysLike("unlock:")).toEqual([]);
  expect(spies.attest).toEqual([]);
  expect(spies.release).toEqual([]);
}

// The three variables this file sets are put back exactly as they were, so the
// stand-in key cannot reach a test that runs after this one. Their values are
// never read out or printed, only held and restored.
const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "SESSION_SECRET"] as const;
const savedEnv = new Map<string, string | undefined>();
// As the file found them, compared at the very end (presence and equality only).
const envAtLoad = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => {
  for (const k of ENV_KEYS) expect(process.env[k] === envAtLoad.get(k), `${k} was put back`).toBe(true);
});

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv.set(k, process.env[k]);
  mem.current = createMemoryRedis();
  ANA = freshWallet();
  BEN = freshWallet();
  provider.mode = "low_credit";
  provider.calls = 0;
  errorLog.length = 0; sent.length = 0; spies.release.length = 0; spies.attest.length = 0; spies.notes.length = 0;
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  // A key must be present for the route to call the verifier at all. This one
  // opens nothing, and the only "network" is providerFetch above.
  process.env.ANTHROPIC_API_KEY = "test-data-key-that-opens-nothing";
  delete process.env.OPENROUTER_API_KEY;
  vi.stubGlobal("fetch", providerFetch);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errorLog.push(a); });
  await seed(favour({}));
  await seed(favour({ id: SOURCE, campaignId: "first-favour", description: WELCOME_ORIGINAL_STEPS[4], category: "custom", bountyUsdc: 10, maxCompletions: 1000 }));
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 120));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    const before = savedEnv.get(k);
    if (before === undefined) delete process.env[k]; else process.env[k] = before;
  }
});

describe("the failure is the provider's own error, built by the installed SDK", () => {
  it("the verifier throws BadRequestError, status 400, type invalid_request_error, with the logged message", async () => {
    const res = await send(ANA, PLAIN, "TEST DATA: wet pavement");
    expect(res.status).toBe(503);
    expect(provider.calls).toBe(1); // a 400 is not retried
    const logged = errorLog.find((a) => String(a[0]).includes("AI verification error"));
    expect(logged, "the operator log has the real cause").toBeTruthy();
    const err = logged![1] as InstanceType<typeof Anthropic.BadRequestError>;
    expect(err).toBeInstanceOf(Anthropic.BadRequestError);
    expect(err).toBeInstanceOf(Anthropic.APIError);
    expect(err.status).toBe(400);
    expect((err.error as { error: { type: string; message: string } }).error.type).toBe("invalid_request_error");
    expect((err.error as { error: { type: string; message: string } }).error.message).toBe(LOW_CREDIT);
    expect(err.message).toContain("credit balance is too low");
  });
});

describe("no key: nothing new is written, and an earlier held proof is not claimed to be absent", () => {
  it("reports an empty open favour as unsaved and an existing held proof as unconfirmed, without calling the provider", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ANTHROPIC_API_KEY;
    const openBefore = mem.current!.raw(`task:${PLAIN}`);
    const open = await send(ANA, PLAIN, "TEST DATA: wet pavement");
    expect(open.status).toBe(503);
    expect(open.body.proofSaved).toBe(false);
    expect(mem.current!.raw(`task:${PLAIN}`)).toBe(openBefore);
    await seed(favour({ status: "claimed", claimant: ANA, proofNote: "TEST DATA: earlier answer", verificationResult: { verdict: "flag", reasoning: "TEST DATA: earlier judgement", confidence: 0.5 } }));
    const heldBefore = mem.current!.raw(`task:${PLAIN}`);
    const held = await send(ANA, PLAIN, "TEST DATA: earlier answer");
    expect(held.status).toBe(503);
    expect(held.body.proofSaved).toBeNull();
    expect(mem.current!.raw(`task:${PLAIN}`)).toBe(heldBefore);
    expect(proofKeptLine(held.body.proofSaved)).toMatch(/cannot confirm/);
    expect(provider.calls).toBe(0);
    await expectNoCredit(ANA, PLAIN);
  });
});

describe("a points favour: the outage is not a verdict", () => {
  it("a NEW direct attempt: 503, the exact body, nothing judged, nothing credited, and the favour is open again for anyone", async () => {
    const res = await send(ANA, PLAIN, "TEST DATA: wet pavement");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: false });
    const row = (await getTask(PLAIN))!;
    expect(row.verificationResult).toBeNull();
    expect(row.status).toBe("open");
    expect(row.claimant).toBeNull();
    // FAVOUR kept nothing of the proof, which is what proofSaved: false says.
    expect(row.proofNote).toBeNull();
    expect(row.proofImageUrl).toBeNull();
    expect(row.completionCount).toBe(0);
    await expectNoCredit(ANA, PLAIN);
    // Nobody was told a proof was flagged, and no reviewer has anything to decide.
    expect(spies.notes.filter((n) => n.type === "flagged" || n.type === "verified" || n.type === "proof_rejected")).toEqual([]);
    expect(keysLike("house:review:")).toEqual([]);
    await mem.current!.client.hset(`jury:stats:${JUDGE}`, { judged: 12, correct: 10 });
    const deck = await (await reviewDeck(req("/api/review/flagged", JUDGE))).json();
    expect(deck.cards).toEqual([]);
    expect(deck.waiting).toBe(0);
    // Ana's unjudged attempt does not block Ben.
    provider.mode = "pass";
    expect((await send(BEN, PLAIN, "TEST DATA: cut grass")).status).toBe(200);
  });

  it("after the provider works again the same person succeeds ONCE, and a repeat adds nothing", async () => {
    expect((await send(ANA, PLAIN, "TEST DATA: wet pavement")).status).toBe(503);
    expect((await send(ANA, PLAIN, "TEST DATA: wet pavement")).status).toBe(503); // trying during the outage changes nothing
    await expectNoCredit(ANA, PLAIN);
    provider.mode = "pass";
    const ok = await send(ANA, PLAIN, "TEST DATA: wet pavement");
    expect(ok.status).toBe(200);
    expect(ok.body.verification.verdict).toBe("pass");
    await vi.waitFor(async () => expect(await points(ANA)).toBe(ok.body.pointsAwarded));
    const after = await points(ANA);
    expect(after).toBeGreaterThanOrEqual(6);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getTask(PLAIN))!.completionCount).toBe(1);
    const again = await send(ANA, PLAIN, "TEST DATA: wet pavement, again");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_completed");
    await new Promise((r) => setTimeout(r, 60));
    expect(await points(ANA)).toBe(after);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getProofOfFavour(ANA)).favoursCompleted).toBe(1);
    expect((await getTask(PLAIN))!.completionCount).toBe(1);
  });

  it("an EXISTING held proof: the reservation and the new proof are kept, the stale verdict is not, and nothing is judged", async () => {
    provider.mode = "flag";
    const first = await send(ANA, PLAIN, "TEST DATA: first answer");
    expect(first.body.verification.verdict).toBe("flag");
    expect((await getTask(PLAIN))!.status).toBe("claimed");
    // That first answer WAS judged (a real flag), and a judged flag is attested
    // as it always has been. From here on, nothing more may be.
    spies.attest.length = 0;
    // The outage arrives while Ana sends a better answer on the favour she holds.
    provider.mode = "low_credit";
    const res = await send(ANA, PLAIN, "TEST DATA: second answer");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: true });
    const row = (await getTask(PLAIN))!;
    expect(row.status).toBe("claimed");
    expect(row.claimant).toBe(ANA);
    expect(row.proofNote).toBe("TEST DATA: second answer");
    // The earlier "flag" was about the first answer. It must not sit on the second.
    expect(row.verificationResult).toBeNull();
    expect(row.aiFollowUp).toBeNull();
    await expectNoCredit(ANA, PLAIN);
    // With no verdict there is no case for a reviewer: an unjudged proof is not a flagged one.
    await mem.current!.client.hset(`jury:stats:${JUDGE}`, { judged: 12, correct: 10 });
    expect((await (await reviewDeck(req("/api/review/flagged", JUDGE))).json()).cards).toEqual([]);
    // Someone else still cannot take a favour Ana holds.
    expect((await send(BEN, PLAIN, "TEST DATA: Ben")).status).toBe(403);
    // Recovery: Ana's kept proof can go again and is credited once.
    provider.mode = "pass";
    const ok = await send(ANA, PLAIN, "TEST DATA: second answer");
    expect(ok.status).toBe(200);
    await vi.waitFor(async () => expect(await points(ANA)).toBe(ok.body.pointsAwarded));
    const after = await points(ANA);
    expect((await send(ANA, PLAIN, "TEST DATA: third")).status).toBe(409);
    await new Promise((r) => setTimeout(r, 60));
    expect(await points(ANA)).toBe(after);
    expect(await listContributions(ANA)).toHaveLength(1);
  });

  it("a Welcome instance: 503, the person's own step stays to do, the review queue stays empty, and recovery credits once", async () => {
    const started = await (await startWelcome(req("/api/welcome/start", ANA, { address: ANA, sourceTaskId: SOURCE }))).json();
    const id = (started.task as Task).id;
    const res = await send(ANA, id, "TEST DATA: held a door for a neighbour");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: false });
    const inst = (await getTask(id))!;
    expect(inst.status).toBe("open");
    expect(inst.claimant).toBeNull();
    expect(inst.verificationResult).toBeNull();
    expect(inst.proofNote).toBeNull();
    expect(await mem.current!.client.scard("house:review:queue")).toBe(0);
    await expectNoCredit(ANA, SOURCE);
    await expectNoCredit(ANA, id);
    const step = async (w: string) => (await (await getWelcome(req("/api/welcome", w))).json()).welcome.steps.find((s: { sourceTaskId: string }) => s.sourceTaskId === SOURCE);
    expect((await step(ANA)).state).toBe("todo");
    // The shared source row was never touched, and Ben's journey is his own.
    expect((await getTask(SOURCE))!.status).toBe("open");
    expect((await step(BEN)).state).toBe("todo");
    provider.mode = "pass";
    const ok = await send(ANA, id, "TEST DATA: held a door for a neighbour");
    expect(ok.status).toBe(200);
    await vi.waitFor(async () => expect(await points(ANA)).toBe(ok.body.pointsAwarded));
    const after = await points(ANA);
    expect(after).toBeGreaterThanOrEqual(10);
    expect((await step(ANA)).state).toBe("done");
    expect((await send(ANA, id, "TEST DATA: again")).status).toBeGreaterThanOrEqual(400);
    expect((await startWelcome(req("/api/welcome/start", ANA, { address: ANA, sourceTaskId: SOURCE }))).status).toBe(409);
    await new Promise((r) => setTimeout(r, 60));
    expect(await points(ANA)).toBe(after);
    expect(await listContributions(ANA)).toHaveLength(1);
  });
});

describe("a PHOTO proof, same provider error", () => {
  const PHOTO_A = "TEST DATA photo A";
  const PHOTO_B = "TEST DATA photo B, a different and longer picture";

  it("a new direct attempt with a photo: 503, confirmed not kept, and the favour is open with no photo on it", async () => {
    const res = await send(ANA, PLAIN, "TEST DATA: the smell of rain", PHOTO_A);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: false });
    // The photo did reach the verifier: the SDK was asked, with an image, once.
    expect(provider.calls).toBe(1);
    const row = (await getTask(PLAIN))!;
    expect(row.status).toBe("open");
    expect(row.claimant).toBeNull();
    expect(row.proofImageUrl).toBeNull();
    expect(row.proofImages).toBeNull();
    expect(row.proofNote).toBeNull();
    expect(row.verificationResult).toBeNull();
    await expectNoCredit(ANA, PLAIN);
    expect(keysLike("house:review:")).toEqual([]);
    expect(keysLike("appeal:")).toEqual([]);
  });

  it("a held photo: the reservation and the NEW photo are kept, the old verdict is not, and recovery credits once", async () => {
    provider.mode = "flag";
    expect((await send(ANA, PLAIN, "TEST DATA: first", PHOTO_A)).body.verification.verdict).toBe("flag");
    const first = (await getTask(PLAIN))!;
    expect(first.status).toBe("claimed");
    expect(first.verificationResult?.verdict).toBe("flag");
    const firstUrl = first.proofImageUrl;
    spies.attest.length = 0; // the first photo was really judged, and a judged flag is attested
    provider.mode = "low_credit";
    const res = await send(ANA, PLAIN, "TEST DATA: second", PHOTO_B);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: true });
    const row = (await getTask(PLAIN))!;
    expect(row.status).toBe("claimed");
    expect(row.claimant).toBe(ANA);
    expect(row.proofNote).toBe("TEST DATA: second");
    expect(row.proofImageUrl).not.toBe(firstUrl);
    expect(row.proofImages).toEqual([row.proofImageUrl]);
    // The flag was about photo A. It is not on photo B.
    expect(row.verificationResult).toBeNull();
    await expectNoCredit(ANA, PLAIN);
    // An unjudged photo is in nobody's review deck, old appeal or new.
    await mem.current!.client.hset(`jury:stats:${JUDGE}`, { judged: 12, correct: 10 });
    expect((await (await reviewDeck(req("/api/review/flagged", JUDGE))).json()).cards).toEqual([]);
    provider.mode = "pass";
    const ok = await send(ANA, PLAIN, "TEST DATA: second", PHOTO_B);
    expect(ok.status).toBe(200);
    expect(ok.body.verification.verdict).toBe("pass");
    await vi.waitFor(async () => expect(await points(ANA)).toBe(ok.body.pointsAwarded));
    const after = await points(ANA);
    expect((await send(ANA, PLAIN, "TEST DATA: third", PHOTO_A)).status).toBe(409);
    await new Promise((r) => setTimeout(r, 60));
    expect(await points(ANA)).toBe(after);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getTask(PLAIN))!.completionCount).toBe(1);
  });
});

describe("the store cannot confirm what happened to the proof", () => {
  // The proof is saved (first write of the row), the provider refuses, and then
  // the cleanup's own write of the row fails. The route cannot know whether the
  // proof and the claim are still there.
  function failRowWriteFrom(taskId: string, nth: number) {
    const client = mem.current!.client;
    const realSet = client.set;
    let writes = 0;
    client.set = (async (k: string, v: unknown, o?: { nx?: boolean }) => {
      if (k === `task:${taskId}` && ++writes >= nth) throw new Error("TEST DATA: the store did not confirm the write");
      return realSet(k, v, o);
    }) as typeof client.set;
    return () => { client.set = realSet; };
  }

  it("cleanup fails AFTER the proof was saved: 503, proofSaved null, no credit, and no claim either way about where the proof is", async () => {
    const restore = failRowWriteFrom(PLAIN, 2);
    const res = await send(ANA, PLAIN, "TEST DATA: wet pavement", "TEST DATA photo");
    restore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: CHECK_UNAVAILABLE_ERROR, code: "check_unavailable", proofSaved: null });
    // The proof really had been written before the failure: this is not the
    // "nothing was written" case, which is why false would have been untrue.
    const row = (await getTask(PLAIN))!;
    expect(row.proofNote).toBe("TEST DATA: wet pavement");
    expect(row.proofImageUrl).toBeTruthy();
    // Still no verdict and no credit of any kind.
    expect(row.verificationResult).toBeNull();
    await expectNoCredit(ANA, PLAIN);
    expect(keysLike("house:review:")).toEqual([]);
    // What the screen says for that answer: neither "did not keep" nor "saved".
    const line = proofKeptLine(readProofSaved(res.body.proofSaved));
    expect(line).toMatch(/cannot confirm/);
    expect(line).toMatch(/still on this screen/);
    expect(line).not.toMatch(/did not keep|is saved|are saved|saved on this favour/);
    expect(proofKeptLabel(readProofSaved(res.body.proofSaved))).toBe("Not confirmed");
    expect(JSON.stringify(res.body)).not.toMatch(INTERNALS);
  });

  it("the same failure on a HELD favour is also not confirmed, and is never reported as saved", async () => {
    provider.mode = "flag";
    await send(ANA, PLAIN, "TEST DATA: first");
    spies.attest.length = 0;
    provider.mode = "low_credit";
    const restore = failRowWriteFrom(PLAIN, 2);
    const res = await send(ANA, PLAIN, "TEST DATA: second");
    restore();
    expect(res.status).toBe(503);
    expect(res.body.proofSaved).toBeNull();
    await expectNoCredit(ANA, PLAIN);
  });

  it("a response with no proofSaved at all, or a wrong type, reads as not confirmed on the screen", () => {
    for (const v of [undefined, null, "true", 1, 0, {}]) expect(readProofSaved(v)).toBeNull();
    expect(readProofSaved(true)).toBe(true);
    expect(readProofSaved(false)).toBe(false);
    // Three answers, three different lines, and only the confirmed ones assert a fact.
    const lines = [proofKeptLine(true), proofKeptLine(false), proofKeptLine(null)];
    expect(new Set(lines).size).toBe(3);
    expect(proofKeptLine(false)).toMatch(/not saved to this favour/);
    expect(proofKeptLine(true)).toMatch(/saved on this favour/);
    expect([proofKeptLabel(true), proofKeptLabel(false), proofKeptLabel(null)]).toEqual(["Saved, not judged", "Not saved to this favour", "Not confirmed"]);
  });

  it("false is sent only when the favour was read back open and empty, true only when read back held with the proof", () => {
    const route = readFileSync(join(__dirname, "..", "app", "api", "verify-proof", "route.ts"), "utf8");
    const fn = route.slice(route.indexOf("function proofSavedAfterRelease("), route.indexOf("export const maxDuration"));
    expect(fn).toMatch(/if \(!released\) return null;/);
    expect(fn).toMatch(/released\.status === "open" && !released\.claimant && !hasProof \? false : null/);
    expect(fn).toMatch(/released\.status === "claimed" && !!released\.claimant && hasProof \? true : null/);
    // The no-key branch is exercised through the route above: it may report
    // an empty open favour as unsaved, but not an earlier held proof.
  });
});

describe("money still fails closed: an outage never releases, reopens or quietly passes a favour with money on it", () => {
  it.each<[string, Partial<Task>]>([
    ["a funded USDC favour", { rewardType: "usdc", onChainId: 7, escrowTxHash: `0x${"a".repeat(64)}`, maxCompletions: 1, bountyUsdc: 2 }],
    ["a points favour that carries an escrow marker", { escrowTxHash: "funded", maxCompletions: 1 }],
    ["a points favour bound to an on-chain id", { onChainId: 9, maxCompletions: 1 }],
  ])("%s is held with a flag, not answered 503, and nothing is released or credited", async (_n, over) => {
    await seed(favour({ id: FUNDED, description: "TEST DATA favour with money on it", ...over }));
    const res = await send(ANA, FUNDED, "TEST DATA: done");
    expect(res.status).toBe(200);
    expect(res.body.verification.verdict).toBe("flag");
    expect(res.body.escrowReleaseTxHash).toBeNull();
    expect(res.body.pointsAwarded).toBeNull();
    const row = (await getTask(FUNDED))!;
    // Held for the person, exactly as before this work: not reopened, not completed.
    expect(row.status).toBe("claimed");
    expect(row.claimant).toBe(ANA);
    expect(row.verificationResult?.verdict).toBe("flag");
    expect(row.settlementTx ?? null).toBeNull();
    expect(row.completionCount).toBe(0);
    expect(spies.release).toEqual([]);
    expect(await points(ANA)).toBe(0);
    expect((await getReputation(ANA)).tasksCompleted).toBe(0);
    expect(await listContributions(ANA)).toEqual([]);
    // And the provider was really asked: this is not a path that skipped the check.
    expect(provider.calls).toBe(1);
  });
});

describe("what a contributor is told", () => {
  it("no response carries the provider's reason, on the points paths or the money path", async () => {
    await send(ANA, PLAIN, "TEST DATA: one");
    const started = await (await startWelcome(req("/api/welcome/start", ANA, { address: ANA, sourceTaskId: SOURCE }))).json();
    await send(ANA, (started.task as Task).id, "TEST DATA: two");
    await seed(favour({ id: FUNDED, rewardType: "usdc", onChainId: 7, escrowTxHash: `0x${"a".repeat(64)}`, maxCompletions: 1 }));
    await send(BEN, FUNDED, "TEST DATA: three");
    expect(sent).toHaveLength(3);
    for (const body of sent) expect(body).not.toMatch(INTERNALS);
    // Nothing stored on a row a contributor can read carries it either.
    for (const id of [PLAIN, FUNDED]) expect(mem.current!.raw(`task:${id}`)).not.toMatch(INTERNALS);
    // The operator log does have it. That is the one place it belongs.
    expect(errorLog.some((a) => a.some((x) => String((x as Error)?.message ?? x).includes("credit balance is too low")))).toBe(true);
  });

  it("the words say not judged and no points, blame the service and not the proof, and promise no time", () => {
    expect(CHECK_UNAVAILABLE_ERROR).toMatch(/was not judged/);
    expect(CHECK_UNAVAILABLE_ERROR).toMatch(/No points were added or taken away/);
    expect(CHECK_UNAVAILABLE_ERROR).toMatch(/not about your proof/);
    expect(CHECK_UNAVAILABLE_ERROR).toMatch(/cannot say when/);
    const PROMISE = /in a moment|shortly|soon\b|in a few|minutes?\b|hours?\b|later today|tomorrow|back by|try again in/i;
    for (const line of [CHECK_UNAVAILABLE_ERROR, TRY_AGAIN_LINE, proofKeptLine(true), proofKeptLine(false), proofKeptLine(null)]) {
      expect(line).not.toMatch(PROMISE);
      expect(line).not.toMatch(INTERNALS);
    }
    // Trying again is offered as a thing you may do, with what it depends on.
    expect(TRY_AGAIN_LINE).toMatch(/You can try again/);
    expect(TRY_AGAIN_LINE).toMatch(/only be judged once the checking service works/);
  });

  it("an unattached proof remains retryable here without promising deletion of an uploaded blob", () => {
    expect(proofKeptLine(false)).toMatch(/still here for retry/);
    expect(proofKeptLine(false)).toMatch(/not saved to this favour/);
    expect(proofKeptLine(false)).not.toMatch(/did not keep|gone|deleted|on this screen only/);
    expect(proofKeptLine(false)).not.toMatch(/\bis saved\b|are saved/);
    expect(proofKeptLine(true)).toMatch(/saved on this favour without a result/);
  });

  it("no screen and no route still carries the old promise or its own copy of the message", () => {
    const root = join(__dirname, "..");
    const feed = readFileSync(join(root, "components", "Feed.tsx"), "utf8");
    const door = readFileSync(join(root, "components", "CampaignFrontDoor.tsx"), "utf8");
    const route = readFileSync(join(root, "app", "api", "verify-proof", "route.ts"), "utf8");
    for (const src of [feed, door, route]) {
      expect(src).not.toMatch(/in a moment/i);
      expect(src).not.toMatch(/Send it again in/);
    }
    // One sentence, in one file: the server sends it and the screen falls back to it.
    expect(route).toMatch(/checkUnavailableBody\(wasOpenAtLoad \? false : null\)/);
    expect(route).toMatch(/checkUnavailableBody\(proofSavedAfterRelease\(released, wasOpenAtLoad\)\)/);
    expect(feed).toMatch(/typeof down\.error === "string" \? down\.error : CHECK_UNAVAILABLE_ERROR, proofSaved: readProofSaved\(down\.proofSaved\)/);
    expect(feed).toMatch(/\{proofKeptLine\(result\.proofSaved \?\? null\)\}/);
    expect(feed).toMatch(/\{TRY_AGAIN_LINE\}/);
    // The route never hands the caught error to the response.
    const fail = route.slice(route.indexOf("} catch (err) {\n    console.error(\"AI verification error"), route.indexOf("if (checkDidNotRun) {"));
    expect(fail).not.toMatch(/err\.message|String\(err\)|\$\{err/);
  });
});
