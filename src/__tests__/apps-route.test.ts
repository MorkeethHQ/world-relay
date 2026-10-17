import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const castYes = vi.hoisted(() => vi.fn());
const listPendingApps = vi.hoisted(() => vi.fn());
const publishDue = vi.hoisted(() => vi.fn());
const getPictureRecord = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/posted-apps", () => ({ castYes, listPendingApps, publishDue }));
vi.mock("@/lib/campaign-pictures", () => ({ getPictureRecord }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: limit, getClientIp: () => "test" }));
vi.mock("@/lib/store", () => ({ createTask: vi.fn() }));

import { GET as list } from "@/app/api/apps/route";
import { POST as vote } from "@/app/api/apps/vote/route";
import { GET as duePass } from "@/app/api/cron/publish-due/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";

const VOTER = "0x2222222222222222222222222222222222222222";
const req = (body: unknown, who?: string) => new NextRequest("http://localhost/api/apps/vote", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(who ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(who, Date.now())}` } : {}) },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SESSION_SECRET = "local-test-only";
  limit.mockResolvedValue({ ok: true });
  castYes.mockResolvedValue({ ok: true, yes: 1, of: 10, status: "pending", first: true });
  getPictureRecord.mockResolvedValue(null);
});

describe("POST /api/apps/vote", () => {
  it("refuses a caller with no session before any vote", async () => {
    const res = await vote(req({ id: "draft_1" }));
    expect([res.status, (await res.json()).code]).toEqual([403, "reauth_required"]);
    expect(castYes).not.toHaveBeenCalled();
  });

  it("votes as the SESSION wallet, never a wallet in the body", async () => {
    const res = await vote(req({ id: "draft_1", wallet: "0x3333333333333333333333333333333333333333" }, VOTER));
    expect(res.status).toBe(200);
    expect(castYes.mock.calls[0].slice(0, 2)).toEqual(["draft_1", VOTER]);
  });

  it("stops at the rate limit", async () => {
    limit.mockResolvedValue({ ok: false });
    expect((await vote(req({ id: "draft_1" }, VOTER))).status).toBe(429);
    expect(castYes).not.toHaveBeenCalled();
  });

  it("maps each refusal to a status", async () => {
    for (const [reason, status] of [["unknown_app", 404], ["not_pending", 409], ["own_app", 403], ["wallet_required", 403], ["unavailable", 503]] as const) {
      castYes.mockResolvedValueOnce({ ok: false, reason });
      expect((await vote(req({ id: "draft_1" }, VOTER))).status, reason).toBe(status);
    }
  });
});

describe("GET /api/apps", () => {
  it("lists the pending apps with counts and names no voter", async () => {
    listPendingApps.mockResolvedValue([{ id: "draft_1", productName: "STRIVE", productUrl: "https://x.test/", ask: "a", maker: VOTER, yes: 3, of: 10, status: "pending" }]);
    const body = await (await list()).json();
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0]).toMatchObject({ id: "draft_1", yes: 3, of: 10, status: "pending" });
    expect(JSON.stringify(body)).not.toMatch(/voters/);
  });

  it("carries each app's picture: the maker's first, then the page's, else null", async () => {
    listPendingApps.mockResolvedValue([
      { id: "draft_1", productName: "A", productUrl: "https://a.test/", ask: "a", maker: VOTER, yes: 0, of: 10, status: "pending" },
      { id: "draft_2", productName: "B", productUrl: "https://b.test/", ask: "b", maker: VOTER, yes: 0, of: 10, status: "pending" },
      { id: "draft_3", productName: "C", productUrl: "https://c.test/", ask: "c", maker: VOTER, yes: 0, of: 10, status: "pending" },
    ]);
    getPictureRecord.mockImplementation(async (id: string) =>
      id === "draft_1" ? { makerImage: "https://cdn.test/mine.png", shareImage: "https://a.test/og.png", icon: null, colour: null, line: null, readAt: "" }
      : id === "draft_2" ? { makerImage: null, shareImage: "https://b.test/og.png", icon: null, colour: null, line: null, readAt: "" }
      : null);
    const body = await (await list()).json();
    expect(body.apps.map((a: { image: string | null }) => a.image)).toEqual(["https://cdn.test/mine.png", "https://b.test/og.png", null]);
    expect(JSON.stringify(body)).not.toContain(VOTER);
  });
});


describe("GET /api/cron/publish-due", () => {
  const cron = (auth?: string) => new NextRequest("http://localhost/api/cron/publish-due", { headers: auth ? { authorization: auth } : {} });

  it("refuses a caller without the cron secret, before any publish", async () => {
    process.env.CRON_SECRET = "cron-test";
    expect((await duePass(cron())).status).toBe(401);
    expect((await duePass(cron("Bearer wrong"))).status).toBe(401);
    expect(publishDue).not.toHaveBeenCalled();
  });

  it("runs the pass and returns its counts", async () => {
    process.env.CRON_SECRET = "cron-test";
    publishDue.mockResolvedValue({ due: 1, published: 1 });
    const res = await duePass(cron("Bearer cron-test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, due: 1, published: 1 });
    expect(publishDue).toHaveBeenCalledTimes(1);
  });
});
