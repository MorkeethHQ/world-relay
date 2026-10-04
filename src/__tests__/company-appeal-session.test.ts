import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const vote = vi.hoisted(() => vi.fn(async () => ({ counted: true, outcome: "pending" })));
vi.mock("@/lib/company-appeal", () => ({ recordCompanyAppealVote: vote }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "test" }));
vi.mock("@/lib/jury", () => ({ getCardAnswer: async () => ({ appeal: true, companyAppealId: "source-bound", judge: JUDGE, proofTaskId: "task" }) }));
import { POST } from "@/app/api/jury/appeal/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";
const JUDGE = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const request = (who?: string) => new NextRequest("http://localhost/api/jury/appeal", { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(who, Date.now())}` } : {}) }, body: JSON.stringify({ address: JUDGE, cardId: "card", verdict: "real", reason: "The labelled photo meets the request." }) });
beforeEach(() => { vi.clearAllMocks(); process.env.SESSION_SECRET = "local-test-only"; process.env.SESSION_ENFORCE = "false"; });
describe("company jury session cannot be disabled", () => {
  it("refuses anonymous and another wallet before recording a vote", async () => {
    expect((await POST(request())).status).toBe(403);
    expect((await POST(request(OTHER))).status).toBe(403);
    expect(vote).not.toHaveBeenCalled();
  });
  it("passes the actual reason and source-bound case for the signed judge", async () => {
    expect((await POST(request(JUDGE))).status).toBe(200);
    expect(vote).toHaveBeenCalledWith(JUDGE, "source-bound", true, "The labelled photo meets the request.");
  });
});

// The fallback photo is retained privately even when blob storage is absent.
