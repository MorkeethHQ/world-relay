import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

// LOCAL DOUBLES ONLY (2026-10-05). The store is an in-memory stand-in for Redis.
// The model calls (follow-up evaluation, dispute mediation) are doubles whose
// verdict the test sets. Chat, push, chain and webhook calls are stubbed out.
// The people are made-up addresses. The store, the completion record and the
// three route handlers are the real ones.
const kv = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const lists = new Map<string, string[]>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, v); return "OK"; },
    get: async (k: string) => kv.get(k) ?? null,
    del: async (k: string) => { kv.delete(k); return 1; },
    sadd: async (k: string, m: string) => { if (!sets.has(k)) sets.set(k, new Set()); const had = sets.get(k)!.has(m); sets.get(k)!.add(m); return had ? 0 : 1; },
    smembers: async (k: string) => Array.from(sets.get(k) || []),
    sismember: async (k: string, m: string) => (sets.get(k)?.has(m) ? 1 : 0),
    lpush: async (k: string, v: string) => { if (!lists.has(k)) lists.set(k, []); lists.get(k)!.unshift(v); return lists.get(k)!.length; },
    ltrim: async () => "OK",
    lrange: async (k: string, a: number, b: number) => (lists.get(k) || []).slice(a, b + 1),
    pipeline: () => { const ops: Array<() => unknown> = []; return { get: (k: string) => { ops.push(() => kv.get(k) ?? null); }, exec: async () => ops.map((op) => op()) }; },
  }),
}));

const model = vi.hoisted(() => ({
  // Runs while the model double is "thinking": lets a test change the favour in
  // that window, as the expiry cron could.
  during: null as null | (() => void),
  followUp: { verdict: "pass" as "pass" | "flag" | "fail", reasoning: "City given.", confidence: 0.9 },
  dispute: { approved: true, reasoning: "The proof matches.", confidence: 0.8 },
}));
const rep = vi.hoisted(() => ({ recordCompletion: vi.fn(async () => ({})), recordFailure: vi.fn(async () => ({})) }));
vi.mock("@/lib/ai-chat", () => ({
  evaluateFollowUp: async () => { model.during?.(); return model.followUp; },
  mediateDispute: async () => { model.during?.(); return model.dispute; },
}));
vi.mock("@/lib/reputation", () => rep);
vi.mock("@/lib/messages", () => ({
  getMessages: async () => [
    { sender: "relay-bot", text: "AI FOLLOW-UP: Which city are you in?" },
    { sender: "0xana", text: "Lagos" },
  ],
}));
vi.mock("@/lib/xmtp", () => ({ postReEvaluationResult: async () => {}, postVerificationResult: async () => {}, postDisputeVerdict: async () => {} }));
vi.mock("@/lib/notifications", () => ({ notifyVerified: async () => {}, notifyFlagged: async () => {} }));
vi.mock("@/lib/notifications-store", () => ({ addNotification: async () => {} }));
vi.mock("@/lib/attestation", () => ({ postAttestation: async () => null }));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: async () => {} }));
vi.mock("@/lib/escrow", () => ({ releaseEscrow: async () => null }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/session", () => ({ ownershipError: () => null }));

import { createTask, claimTask, submitProof, completeTask, setFollowUp, getTask } from "@/lib/store";
import { listContributions } from "@/lib/completions";
import { POST as followup } from "@/app/api/tasks/[id]/followup/route";
import { POST as confirm } from "@/app/api/tasks/[id]/confirm/route";
import { POST as dispute } from "@/app/api/tasks/[id]/dispute/route";

const ANA = "0xAna0000000000000000000000000000000000001";
const POSTER = "0xPoster00000000000000000000000000000000ff";
const IMG = "https://blob.example/proofs/ana.jpg";

async function flagged(o: Record<string, unknown> = {}): Promise<string> {
  const t = await createTask({ poster: POSTER, description: "Photo your first drink of the day and tell us your city", location: "Anywhere", bountyUsdc: 12, deadlineHours: 48, rewardType: "points", maxCompletions: 100, category: "photo", ...o } as Parameters<typeof createTask>[0]);
  await claimTask(t.id, ANA, "orb");
  await submitProof(t.id, IMG, "coffee, on the balcony", [IMG], ANA, "orb");
  await completeTask(t.id, { verdict: "flag", reasoning: "City not stated.", confidence: 0.7 });
  return t.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (handler: any, id: string, body: unknown = {}) =>
  handler(new Request(`http://localhost/api/tasks/${id}/x`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  kv.clear(); sets.clear(); lists.clear(); rep.recordCompletion.mockClear(); rep.recordFailure.mockClear();
  model.followUp = { verdict: "pass", reasoning: "City given.", confidence: 0.9 };
  model.dispute = { approved: true, reasoning: "The proof matches.", confidence: 0.8 };
  model.during = null;
});

describe("a late pass writes the person's History row", () => {
  it("follow-up pass: one row with the favour, the points and the proof", async () => {
    const id = await flagged();
    await setFollowUp(id, "Which city are you in?", 0.7);
    const res = await call(followup, id);
    expect(res.status).toBe(200);
    const rows = await listContributions(ANA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ taskId: id, points: 12, streakBonus: 0, proofNote: "coffee, on the balcony", proofImageUrl: IMG, description: "Photo your first drink of the day and tell us your city" });
    // The favour was reopened and its proof wiped, so the row is the only record left.
    expect((await getTask(id))!.proofNote).toBeNull();
  });

  it("follow-up that does not pass writes no row", async () => {
    for (const verdict of ["flag", "fail"] as const) {
      const id = await flagged();
      await setFollowUp(id, "Which city are you in?", 0.7);
      model.followUp = { verdict, reasoning: "Still unclear.", confidence: 0.4 };
      expect((await call(followup, id)).status).toBe(200);
    }
    expect(await listContributions(ANA)).toHaveLength(0);
  });

  it("poster approval: one row. A rejection: none", async () => {
    const id = await flagged();
    expect((await call(confirm, id, { approved: true, poster: POSTER })).status).toBe(200);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await listContributions(ANA))[0]).toMatchObject({ taskId: id, points: 12, proofNote: "coffee, on the balcony" });

    const other = await flagged({ description: "Show us the view from where you are standing right now" });
    expect((await call(confirm, other, { approved: false, poster: POSTER })).status).toBe(200);
    expect(await listContributions(ANA)).toHaveLength(1);
  });

  it("approving the same proof twice credits once and writes one row (single-reply favour)", async () => {
    const id = await flagged({ maxCompletions: 1 });
    expect((await call(confirm, id, { approved: true, poster: POSTER })).status).toBe(200);
    const second = await call(confirm, id, { approved: true, poster: POSTER });
    expect(second.status).toBe(400);
    expect(rep.recordCompletion).toHaveBeenCalledTimes(1);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect((await getTask(id))!.status).toBe("completed");
  });

  it("dispute mediation that approves: one row. One that rejects: none", async () => {
    const id = await flagged();
    expect((await call(dispute, id, { poster: POSTER })).status).toBe(200);
    expect(await listContributions(ANA)).toHaveLength(1);

    const other = await flagged({ description: "Show us the view from where you are standing right now" });
    model.dispute = { approved: false, reasoning: "Unrelated photo.", confidence: 0.8 };
    expect((await call(dispute, other, { poster: POSTER })).status).toBe(200);
    expect(await listContributions(ANA)).toHaveLength(1);
    expect(rep.recordFailure).toHaveBeenCalledTimes(1);
  });

  it("a second mediation on a decided single-reply favour is refused before any credit", async () => {
    const id = await flagged({ maxCompletions: 1 });
    expect((await call(dispute, id, { poster: POSTER })).status).toBe(200);
    expect((await call(dispute, id, { poster: POSTER })).status).toBe(400);
    expect(rep.recordCompletion).toHaveBeenCalledTimes(1);
    expect(await listContributions(ANA)).toHaveLength(1);
  });

  it("a campaign favour keeps its campaign on the row, and a money favour shows 0 points", async () => {
    const id = await flagged({ campaignId: "first-favour", maxCompletions: 1000 });
    await call(confirm, id, { approved: true, poster: POSTER });
    expect((await listContributions(ANA))[0]).toMatchObject({ campaignId: "first-favour", points: 12 });
    const { latePassContribution } = await import("@/lib/completions");
    const money = latePassContribution({ id: "m", description: "d", bountyUsdc: 5, rewardType: "usdc-v2", proofImageUrl: null, proofNote: "n", campaignId: undefined, companyCampaignId: undefined }, 0);
    expect(money.points).toBe(0);
  });

  it("a follow-up answer on a favour that is no longer claimed is refused before the model, with no credit", async () => {
    const id = await flagged();
    await setFollowUp(id, "Which city are you in?", 0.7);
    const raw = JSON.parse(kv.get(`task:${id}`)!);
    kv.set(`task:${id}`, JSON.stringify({ ...raw, status: "expired" }));
    const res = await call(followup, id);
    expect(res.status).toBe(400);
    expect(rep.recordCompletion).not.toHaveBeenCalled();
    expect(await listContributions(ANA)).toHaveLength(0);
    expect(JSON.parse(kv.get(`task:${id}`)!).status).toBe("expired");
  });

  it.each([["follow-up", followup], ["dispute", dispute]] as const)("%s: if the favour expires while the model is deciding, nothing is credited", async (name, handler) => {
    const id = await flagged();
    if (name === "follow-up") await setFollowUp(id, "Which city are you in?", 0.7);
    model.during = () => { const raw = JSON.parse(kv.get(`task:${id}`)!); kv.set(`task:${id}`, JSON.stringify({ ...raw, status: "expired" })); };
    const res = await call(handler, id, { poster: POSTER });
    expect(res.status).toBe(409);
    expect(rep.recordCompletion).not.toHaveBeenCalled();
    expect(await listContributions(ANA)).toHaveLength(0);
    expect(JSON.parse(kv.get(`task:${id}`)!).status).toBe("expired");
  });

  it("all three routes call the one helper", () => {
    for (const r of ["followup", "confirm", "dispute"]) {
      expect(readFileSync(`src/app/api/tasks/[id]/${r}/route.ts`, "utf8"), r).toContain("recordLatePassHistory(");
    }
  });
});
