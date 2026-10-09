import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";

// The Talk routes, end to end on the in-memory store. What is pinned here:
// identity comes from the session cookie or the bearer key and never from the
// body (SECURITY-INVARIANTS.md, Inv 4); an agent never says "I can"; a hidden
// message is absent from the GET itself; a store that cannot answer is an error.

let redis: ReturnType<typeof createMemoryRedis> | null = createMemoryRedis();
vi.mock("@/lib/redis", () => ({ getRedis: () => redis?.client ?? null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true, remaining: 1 }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/api-keys", () => ({
  validateApiKey: async (key: string) => (key === "rlk_scout" ? { valid: true, agentId: "scout-1a2b", name: "scout" } : { valid: false, agentId: null, name: null }),
}));
vi.mock("@/lib/talk-rooms", () => ({
  roomOf: async (id: string) => {
    if (id === "hn_down") throw new Error("store down");
    if (id !== "strive") return null;
    return { id: "strive", name: "STRIVE", picture: { url: null, icon: null }, colour: null, kind: "vote" };
  },
}));
vi.mock("@/lib/talk", async (orig) => {
  const real = await orig<typeof import("@/lib/talk")>();
  return { ...real, worldName: async (wallet: string) => (wallet === W1 ? { name: "@maya", picture: null, username: true } : { name: real.shortHandle(wallet), picture: null, username: false }) };
});

const W1 = "0x00000000000000000000000000000000000000aa";
const W2 = "0x00000000000000000000000000000000000000bb";
const saved = vi.hoisted(() => {
  const was = { SESSION_SECRET: process.env.SESSION_SECRET, SESSION_ENFORCE: process.env.SESSION_ENFORCE, ADMIN_SECRET: process.env.ADMIN_SECRET };
  process.env.SESSION_SECRET = "talk-test-secret";
  process.env.ADMIN_SECRET = "talk-admin-secret"; // read once at module load, like admin/polls
  delete process.env.SESSION_ENFORCE;
  return was;
});

import { GET, POST } from "@/app/api/talk/[id]/route";
import { POST as TAKE } from "@/app/api/talk/[id]/take/route";
import { POST as REPORT } from "@/app/api/talk/[id]/report/route";
import { POST as ADMIN } from "@/app/api/admin/talk/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { NextRequest } from "next/server";

afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
beforeEach(() => { redis = createMemoryRedis(); });

const cookie = (w: string) => ({ cookie: `${SESSION_COOKIE}=${issueSessionToken(w, Date.now())}` });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/talk/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/talk/<id>", () => {
  it("takes the author from the session, and ignores any wallet or name in the body", async () => {
    const res = await POST(req("strive", { text: "hello", wallet: W2, author: "@someone", name: "@someone", poster: W2 }, cookie(W1)), params("strive"));
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message.author).toEqual({ kind: "person", name: "@maya", picture: null });
    const raw = redis!.lists.get("talk:room:strive:messages")![0];
    expect(raw).toContain(`"by":"${W1}"`);
    expect(raw).not.toContain(W2);
    expect(raw).not.toContain("someone");
  });

  it("refuses a signed-out caller, whatever the body claims", async () => {
    const res = await POST(req("strive", { text: "hello", wallet: W1 }), params("strive"));
    expect(res.status).toBe(403);
    expect(redis!.lists.get("talk:room:strive:messages")).toBeUndefined();
  });

  it("an agent posts by its key, under its registered name, as an agent", async () => {
    const res = await POST(req("strive", { text: "Two earlier reviews say the same.", name: "maya" }, { authorization: "Bearer rlk_scout" }), params("strive"));
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message.author).toEqual({ kind: "agent", name: "scout", picture: null });
    expect(JSON.stringify(message)).not.toContain("scout-1a2b");
    const bad = await POST(req("strive", { text: "x" }, { authorization: "Bearer rlk_wrong" }), params("strive"));
    expect(bad.status).toBe(403);
  });

  it("a bearer key beside a session cookie is the agent, not the person", async () => {
    const res = await POST(req("strive", { text: "both" }, { ...cookie(W1), authorization: "Bearer rlk_scout" }), params("strive"));
    expect((await res.json()).message.author.kind).toBe("agent");
  });

  it("refuses an unknown room, empty text and text over the cap", async () => {
    expect((await POST(req("nope", { text: "x" }, cookie(W1)), params("nope"))).status).toBe(404);
    expect((await POST(req("strive", { text: "  " }, cookie(W1)), params("strive"))).status).toBe(400);
    expect((await POST(req("strive", { text: "x".repeat(301) }, cookie(W1)), params("strive"))).status).toBe(400);
    expect(redis!.lists.size).toBe(0);
  });
});

describe("GET /api/talk/<id>", () => {
  it("serves names only, says signedIn from the cookie, and leaves a hidden message out of the response itself", async () => {
    await POST(req("strive", { text: "keep" }, cookie(W1)), params("strive"));
    const spam = await (await POST(req("strive", { text: "spam here" }, cookie(W2)), params("strive"))).json();
    const admin = await ADMIN(req("admin", { secret: "talk-admin-secret", action: "hide", room: "strive", messageId: spam.message.id }));
    expect(admin.status).toBe(200);

    const out = await GET(req("strive"), params("strive"));
    expect(out.status).toBe(200);
    const text = await out.text();
    expect(text).not.toContain("spam here");
    expect(text).not.toContain(W1);
    expect(text).not.toContain(W2);
    const body = JSON.parse(text);
    expect(body.messages.map((m: { text: string }) => m.text)).toEqual(["keep"]);
    expect(body.count).toBe(1);
    expect(body.signedIn).toBe(false);
    expect(body.you).toBeNull();

    const mine = await (await GET(req("strive", undefined, cookie(W1)), params("strive"))).json();
    expect(mine.signedIn).toBe(true);
    expect(mine.you).toBe("@maya");
    const asAgent = await (await GET(req("strive", undefined, { authorization: "Bearer rlk_scout" }), params("strive"))).json();
    expect(asAgent.signedIn).toBe(false);
  });

  it("fails closed: no store is 503, a room that cannot be read is 503, an unknown room is 404", async () => {
    redis = null;
    expect((await GET(req("strive"), params("strive"))).status).toBe(503);
    redis = createMemoryRedis();
    expect((await GET(req("hn_down"), params("hn_down"))).status).toBe(503);
    expect((await GET(req("nope"), params("nope"))).status).toBe(404);
  });

  it("the admin door needs the secret", async () => {
    expect((await ADMIN(req("admin", { secret: "wrong", action: "hide", room: "strive", messageId: "m" }))).status).toBe(401);
    expect((await ADMIN(req("admin", { action: "hide", room: "strive", messageId: "m" }))).status).toBe(401);
  });
});

describe("I can and report", () => {
  it("a person takes an ask from the session; a second person is refused; an agent never can", async () => {
    const ask = await (await POST(req("strive", { text: "Can someone try my sign-up?", ask: true }, cookie(W1)), params("strive"))).json();
    const agent = await TAKE(req("strive/take", { messageId: ask.message.id }, { authorization: "Bearer rlk_scout" }), params("strive"));
    expect(agent.status).toBe(403);
    const out = await TAKE(req("strive/take", { messageId: ask.message.id, wallet: W1 }), params("strive"));
    expect(out.status).toBe(403);
    const first = await TAKE(req("strive/take", { messageId: ask.message.id }, cookie(W2)), params("strive"));
    expect(first.status).toBe(200);
    expect((await first.json()).taken).toEqual({ name: "0x0000...00bb" });
    const second = await TAKE(req("strive/take", { messageId: ask.message.id }, cookie(W1)), params("strive"));
    expect(second.status).toBe(409);
    const room = await (await GET(req("strive"), params("strive"))).json();
    expect(room.pinned.taken).toEqual({ name: "0x0000...00bb" });
  });

  it("a report needs the session and lands on the review list once", async () => {
    const m = await (await POST(req("strive", { text: "x" }, cookie(W1)), params("strive"))).json();
    expect((await REPORT(req("strive/report", { messageId: m.message.id }), params("strive"))).status).toBe(403);
    expect((await REPORT(req("strive/report", { messageId: m.message.id }, { authorization: "Bearer rlk_scout" }), params("strive"))).status).toBe(403);
    expect((await REPORT(req("strive/report", { messageId: m.message.id }, cookie(W2)), params("strive"))).status).toBe(200);
    expect((await REPORT(req("strive/report", { messageId: m.message.id }, cookie(W2)), params("strive"))).status).toBe(200);
    expect((await REPORT(req("strive/report", { messageId: "m_nope" }, cookie(W2)), params("strive"))).status).toBe(404);
    const list = await (await ADMIN(req("admin", { secret: "talk-admin-secret", action: "reports" }))).json();
    expect(list.reports).toHaveLength(1);
  });
});
