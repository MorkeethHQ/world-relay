import { describe, it, expect, beforeEach, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// THE COMPANY-TO-PAID-OUTCOME PATH (2026-09-27). After the AI check passes a piece,
// the COMPANY accepts it, and that acceptance creates a payout record with an
// honest state: pending (and why), failed (and why), or, only by an operator
// script with a transfer hash, paid. Red on 8b18a90: the module, the routes and
// the result id do not exist.

const kv = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const lists = new Map<string, string[]>();
const hashes = new Map<string, Map<string, string>>();
const fakeRedis = {
  get: async (k: string) => kv.get(k) ?? null,
  set: async (k: string, v: string, o?: { nx?: boolean }) => { if (o?.nx && kv.has(k)) return null; kv.set(k, v); return "OK"; },
  del: async (k: string) => (kv.delete(k) ? 1 : 0),
  sadd: async (k: string, m: string) => { const s = sets.get(k) ?? new Set(); if (s.has(m)) return 0; s.add(m); sets.set(k, s); return 1; },
  srem: async (k: string, m: string) => (sets.get(k)?.delete(m) ? 1 : 0),
  smembers: async (k: string) => [...(sets.get(k) ?? [])],
  scard: async (k: string) => (sets.get(k) ?? new Set()).size,
  sismember: async (k: string, m: string) => ((sets.get(k) ?? new Set()).has(m) ? 1 : 0),
  lpush: async (k: string, v: string) => { const l = lists.get(k) ?? []; l.unshift(v); lists.set(k, l); return l.length; },
  ltrim: async () => "OK",
  lrange: async (k: string, a: number, b: number) => (lists.get(k) ?? []).slice(a, b + 1),
  hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
  hset: async (k: string, obj: Record<string, string>) => { const h = hashes.get(k) ?? new Map(); for (const [f, v] of Object.entries(obj)) h.set(f, v); hashes.set(k, h); return 1; },
  hsetnx: async (k: string, f: string, v: string) => { const h = hashes.get(k) ?? new Map(); if (h.has(f)) return 0; h.set(f, v); hashes.set(k, h); return 1; },
  hgetall: async (k: string) => { const h = hashes.get(k); if (!h) return null; return Object.fromEntries(h); },
  incr: async (k: string) => { const n = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(n)); return n; },
  expire: async () => 1,
};
vi.mock("@/lib/redis", () => ({ getRedis: () => fakeRedis }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));

const pushes: Array<{ to: string; title: string }> = [];
vi.mock("@/lib/notifications", () => ({
  notifyPieceAccepted: async (to: string, _c: string, _a: number, status: string) => { pushes.push({ to, title: status }); },
  notifyPiecePaid: async (to: string) => { pushes.push({ to, title: "paid" }); },
}));

import { recordCampaignResult, listCampaignResults, getResultAddress, isCampaignOwner } from "@/lib/campaign-drafts";
import { markCampaignPaid } from "@/lib/campaign-funding";
import { acceptCampaignPiece, listCampaignPayouts, listPayoutsFor, markPiecePaid, committedUsdc } from "@/lib/campaign-payouts";
import { piecePayoutUsdc } from "@/lib/campaign-payouts-shape";
import { getNotifications } from "@/lib/notifications-store";
import { POST as ACCEPT } from "@/app/api/campaigns/company/[id]/accept/route";
import { GET as COMPANY_GET } from "@/app/api/campaigns/company/[id]/route";
import { GET as MY_PAYOUTS } from "@/app/api/me/payouts/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const COMPANY = "0xcccccccccccccccccccccccccccccccccccccccc";
const OTHER = "0x1111111111111111111111111111111111111111";
const PERSON = "0x3333333333333333333333333333333333333333";
const PERSON2 = "0x4444444444444444444444444444444444444444";
const POOL_ADDR = "0x00000000000000000000000000000000c0ffee00";
const TEST_TX = "0x" + "7e57".repeat(16);
const ID = "draft_uniswap";
const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const open = { FAVOUR_POOL_ADDRESS: POOL_ADDR, NODE_ENV: "test" } as Record<string, string | undefined>;
const closed = { NODE_ENV: "test" } as Record<string, string | undefined>;

function seedCampaign(over: Record<string, unknown> = {}) {
  const d = {
    id: ID, status: "published", company: "TEST Uniswap first-swap reviews", brief: "b",
    pieces: [{ kind: "review", count: 2 }], rewardPerPiecePoints: 10, proposedPoolUsdc: 20,
    reviewRule: "ai", owner: COMPANY, createdAt: "2026-09-27T00:00:00.000Z", publishedAt: "2026-09-27T00:00:00.000Z",
    pieceTaskIds: { review: "piece-review" },
    ...over,
  };
  kv.set(`campaign:draft:${ID}`, JSON.stringify(d));
  sets.set("campaign:company:published", new Set([ID]));
}

async function passed(participant: string, reason = "An honest first-swap review with the link") {
  await recordCampaignResult(ID, { taskId: "piece-review", kind: "review", verdict: "pass", reason, participant: `${participant.slice(0, 6)}…${participant.slice(-4)}`, at: new Date(NOW).toISOString() }, participant);
  const [r] = await listCampaignResults(ID, 1);
  return r.id!;
}

function req(url: string, as: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) headers.cookie = `${SESSION_COOKIE}=${issueSessionToken(as, Date.now())}`;
  return new Request(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }) as never;
}

beforeEach(() => {
  kv.clear(); sets.clear(); lists.clear(); hashes.clear(); pushes.length = 0;
  process.env.ADMIN_SECRET = "test-secret";
  seedCampaign();
});

describe("a reviewed result carries an id and a private address", () => {
  it("records an id, keeps the full address off the public route, and finds it server side", async () => {
    const rid = await passed(PERSON);
    expect(rid).toMatch(/^res_/);
    expect(await getResultAddress(ID, rid)).toBe(PERSON);
    const res = await COMPANY_GET(req(`http://x/api/campaigns/company/${ID}`, null), { params: Promise.resolve({ id: ID }) });
    const text = JSON.stringify(await res.json());
    expect(text).toContain(rid);
    expect(text.toLowerCase()).not.toContain(PERSON.toLowerCase());
  });
  it("knows the owner and nobody else", async () => {
    expect(await isCampaignOwner(ID, COMPANY)).toBe(true);
    expect(await isCampaignOwner(ID, OTHER)).toBe(false);
  });
});

describe("the company accepts a piece: pending, and why", () => {
  it("splits the pool by the company's own piece count", () => {
    expect(piecePayoutUsdc(20, 2)).toBe(10);
    expect(piecePayoutUsdc(200, 17)).toBe(11.76);
    expect(piecePayoutUsdc(0, 5)).toBe(0);
  });
  it("only an AI-pass result can be accepted (Inv 5)", async () => {
    await recordCampaignResult(ID, { taskId: "piece-review", kind: "review", verdict: "fail", reason: "stock text", participant: "0x3333…3333", at: new Date(NOW).toISOString() }, PERSON);
    const [r] = await listCampaignResults(ID, 1);
    const out = await acceptCampaignPiece(COMPANY, ID, r.id!, NOW, closed);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(409);
    expect(await listCampaignPayouts(ID, closed)).toEqual([]);
  });
  it("before funding: pending / pool_unfunded, marked test, both parties notified, once", async () => {
    const rid = await passed(PERSON);
    const out = await acceptCampaignPiece(COMPANY, ID, rid, NOW, closed);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.created).toBe(true);
    expect(out.payout).toMatchObject({ id: rid, status: "pending", reason: "pool_unfunded", amountUsdc: 10, participant: "0x3333…3333", test: true });
    expect(JSON.stringify(out.payout)).not.toContain(PERSON);
    const mine = await listPayoutsFor(PERSON, closed);
    expect(mine.map((p) => p.id)).toEqual([rid]);
    expect((await getNotifications(PERSON)).map((n) => n.title)).toEqual(["Piece accepted"]);
    expect((await getNotifications(COMPANY)).map((n) => n.title)).toEqual(["You accepted a piece"]);
    expect(pushes).toEqual([{ to: PERSON, title: "pending" }]);
    // Idempotent: same record, nothing sent again.
    const again = await acceptCampaignPiece(COMPANY, ID, rid, NOW + 1, closed);
    expect(again.ok && !again.created && again.payout.acceptedAt === out.payout.acceptedAt).toBe(true);
    expect(pushes.length).toBe(1);
    expect((await getNotifications(PERSON)).length).toBe(1);
  });
  it("after the pool is recorded paid, the same pending record reads awaiting_payout", async () => {
    const rid = await passed(PERSON);
    await acceptCampaignPiece(COMPANY, ID, rid, NOW, closed);
    const funded = await markCampaignPaid(ID, TEST_TX, 22, NOW, open);
    expect(funded.ok).toBe(true);
    const [p] = await listCampaignPayouts(ID, open);
    expect(p).toMatchObject({ status: "pending", reason: "awaiting_payout" });
    const [mine] = await listPayoutsFor(PERSON, open);
    expect(mine.reason).toBe("awaiting_payout");
  });
  it("a pool that is spent fails the next acceptance with pool_exhausted", async () => {
    const a = await passed(PERSON);
    const b = await passed(PERSON2);
    const c = await passed(OTHER);
    await acceptCampaignPiece(COMPANY, ID, a, NOW, closed);
    await acceptCampaignPiece(COMPANY, ID, b, NOW, closed);
    const third = await acceptCampaignPiece(COMPANY, ID, c, NOW, closed);
    expect(third.ok && third.payout.status === "failed" && third.payout.reason === "pool_exhausted").toBe(true);
    const all = await listCampaignPayouts(ID, closed);
    expect(committedUsdc(all)).toBe(20);
    expect((await getNotifications(OTHER)).map((n) => n.title)).toEqual(["Payment failed"]);
    expect(pushes.at(-1)).toEqual({ to: OTHER, title: "failed" });
  });
});

describe("the pool cap holds under concurrent accepts (Codex review 2026-09-27)", () => {
  it("two accepts of two different results at once never commit more than the pool", async () => {
    seedCampaign({ pieces: [{ kind: "review", count: 1 }], proposedPoolUsdc: 10 });
    const a = await passed(PERSON);
    const b = await passed(PERSON2);
    const [ra, rb] = await Promise.all([
      acceptCampaignPiece(COMPANY, ID, a, NOW, closed),
      acceptCampaignPiece(COMPANY, ID, b, NOW, closed),
    ]);
    const all = await listCampaignPayouts(ID, closed);
    expect(committedUsdc(all)).toBeLessThanOrEqual(10);
    const pending = all.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    const outcomes = [ra, rb].map((r) => (r.ok ? r.payout.status : `refused:${r.status}`)).sort();
    // One pending; the other either failed pool_exhausted or was told to retry.
    expect(outcomes[0] === "failed" || outcomes[0] === "refused:409").toBe(true);
    expect(outcomes[1]).toBe("pending");
  });
  it("a pool_exhausted record can never be marked paid", async () => {
    seedCampaign({ pieces: [{ kind: "review", count: 1 }], proposedPoolUsdc: 10 });
    const a = await passed(PERSON);
    const b = await passed(PERSON2);
    await acceptCampaignPiece(COMPANY, ID, a, NOW, closed);
    const second = await acceptCampaignPiece(COMPANY, ID, b, NOW, closed);
    expect(second.ok && second.payout.reason === "pool_exhausted").toBe(true);
    await markCampaignPaid(ID, TEST_TX, 11, NOW, open);
    const paid = await markPiecePaid(ID, b, "0x" + "c".repeat(64), NOW, open);
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.error).toContain("exhausted");
    expect((await listCampaignPayouts(ID, open)).find((p) => p.id === b)?.status).toBe("failed");
  });
});

describe("paid is an operator act, never a route", () => {
  it("markPiecePaid refuses while the pool is not funded, then records paid with the hash", async () => {
    const rid = await passed(PERSON);
    await acceptCampaignPiece(COMPANY, ID, rid, NOW, closed);
    const early = await markPiecePaid(ID, rid, TEST_TX, NOW, closed);
    expect(early.ok).toBe(false);
    await markCampaignPaid(ID, TEST_TX, 22, NOW, open);
    const bad = await markPiecePaid(ID, rid, "0xnothex", NOW, open);
    expect(bad.ok).toBe(false);
    const paid = await markPiecePaid(ID, rid, "0x" + "5e7".repeat(21) + "5", NOW, open);
    expect(paid.ok && paid.payout.status === "paid" && paid.payout.paidTxHash?.startsWith("0x5e7")).toBe(true);
    const twice = await markPiecePaid(ID, rid, "0x" + "5e7".repeat(21) + "5", NOW, open);
    expect(twice.ok).toBe(false);
    expect((await getNotifications(PERSON)).map((n) => n.title)).toEqual(["Paid", "Piece accepted"]);
    expect(pushes.at(-1)).toEqual({ to: PERSON, title: "paid" });
  });
  it("no HTTP route imports markPiecePaid or markPieceFailed", () => {
    const root = join(process.cwd(), "src", "app", "api");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
    walk(root);
    const offenders = files.filter((f) => /markPiecePaid|markPieceFailed/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    // The script that may write it exists and refuses without a funded pool.
    const script = readFileSync(join(process.cwd(), "scripts", "mark-piece-paid.mjs"), "utf8");
    expect(script).toContain("campaign:funding:");
    expect(script).toContain("--apply");
  });
});

describe("the routes", () => {
  it("accept: owner only, 201 on first accept, 200 on repeat, 404 for a stranger", async () => {
    const rid = await passed(PERSON);
    const stranger = await ACCEPT(req(`http://x/api/campaigns/company/${ID}/accept`, OTHER, { resultId: rid }), { params: Promise.resolve({ id: ID }) });
    expect(stranger.status).toBe(404);
    const anon = await ACCEPT(req(`http://x/api/campaigns/company/${ID}/accept`, null, { resultId: rid }), { params: Promise.resolve({ id: ID }) });
    expect(anon.status).toBe(403);
    const first = await ACCEPT(req(`http://x/api/campaigns/company/${ID}/accept`, COMPANY, { resultId: rid }), { params: Promise.resolve({ id: ID }) });
    expect(first.status).toBe(201);
    expect((await first.json()).payout).toMatchObject({ status: "pending", reason: "pool_unfunded" });
    const second = await ACCEPT(req(`http://x/api/campaigns/company/${ID}/accept`, COMPANY, { resultId: rid }), { params: Promise.resolve({ id: ID }) });
    expect(second.status).toBe(200);
    // The company page lists the payout state next to the result.
    const page = await COMPANY_GET(req(`http://x/api/campaigns/company/${ID}`, null), { params: Promise.resolve({ id: ID }) });
    const body = await page.json();
    expect(body.payouts).toHaveLength(1);
    expect(body.payouts[0]).toMatchObject({ id: rid, status: "pending" });
  });
  it("me/payouts: session only, the person's own record", async () => {
    const rid = await passed(PERSON);
    await acceptCampaignPiece(COMPANY, ID, rid, NOW, closed);
    const anon = await MY_PAYOUTS(req("http://x/api/me/payouts", null));
    expect(await anon.json()).toEqual({ authenticated: false, payouts: [] });
    const mine = await MY_PAYOUTS(req("http://x/api/me/payouts", PERSON));
    const j = await mine.json();
    expect(j.authenticated).toBe(true);
    expect(j.payouts.map((p: { id: string }) => p.id)).toEqual([rid]);
    const other = await MY_PAYOUTS(req("http://x/api/me/payouts", PERSON2));
    expect((await other.json()).payouts).toEqual([]);
  });
});
