import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const store = new Map<string, unknown>();
const redis = {
  get: async (k: string) => store.get(k) ?? null,
  lpush: async (k: string, value: string) => { const rows = (store.get(k) as string[] | undefined) || []; rows.unshift(value); store.set(k, rows); return rows.length; },
  lrange: async (k: string, a: number, b: number) => ((store.get(k) as string[]) || []).slice(a, b === -1 ? undefined : b + 1),
};
vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "local-test" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
import { recordCompanyEvidence, getCompanyReview } from "@/lib/company-review";
import { GET, POST } from "@/app/api/campaigns/drafts/[id]/review/route";
import { GET as PUBLIC_GET } from "@/app/api/campaigns/company/[id]/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const params = { params: Promise.resolve({ id: "draft_review" }) };
function req(owner?: string, body?: unknown) {
  return new NextRequest("http://localhost/api/campaigns/drafts/draft_review/review", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(owner ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(owner, Date.now())}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(async () => {
  store.clear(); process.env.SESSION_SECRET = "local-test-only";
  store.set("campaign:draft:draft_review", { id: "draft_review", owner: OWNER, status: "published", company: "Fixture company", brief: "A local fixture request", pieces: [], rewardPerPiecePoints: 5, proposedPoolUsdc: 0, reviewRule: "ai", createdAt: new Date().toISOString() });
  await recordCompanyEvidence("draft_review", { taskId: "piece_1", kind: "review", verdict: "pass", reason: "Review accepted", participant: "0x3333…3333", at: new Date().toISOString() }, "Private evidence text", ["javascript:alert(1)", "https://example.test/evidence.jpg"]);
});
describe("private company evidence to decision", () => {
  it("requires a signed owner session for reads and writes", async () => {
    expect((await GET(req(), params)).status).toBe(403);
    expect((await POST(req(undefined, { question: "Why do people leave?", evidenceIds: [] }), params)).status).toBe(403);
    expect((await GET(req(OTHER), params)).status).toBe(404);
    expect((await POST(req(OTHER, { question: "Why do people leave?", evidenceIds: [] }), params)).status).toBe(404);
  });
  it("retains submitted proof privately, with safe image links and private cache headers", async () => {
    const response = await GET(req(OWNER), params); const data = await response.json();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(data.evidence[0].note).toBe("Private evidence text");
    expect(data.evidence[0].images).toEqual(["https://example.test/evidence.jpg"]);
    const publicResponse = await PUBLIC_GET(req(), params);
    expect(JSON.stringify(await publicResponse.json())).not.toContain("Private evidence text");
  });
  it("saves a question before evidence, but refuses an unsupported decision", async () => {
    const base = { question: "What blocks the first useful action?", decision: "", evidenceIds: [] };
    expect((await POST(req(OWNER, base), params)).status).toBe(201);
    expect((await POST(req(OWNER, { ...base, decision: "We will shorten the onboarding flow." }), params)).status).toBe(400);
    expect((await POST(req(OWNER, { ...base, decision: "We will shorten the onboarding flow.", evidenceIds: ["other-campaign-proof"] }), params)).status).toBe(400);
  });
  it("links the owner decision to actual evidence and retains every revision", async () => {
    const review = await getCompanyReview(OWNER, "draft_review"); const eid = review!.evidence[0].id;
    const body = { question: "What blocks the first useful action?", decision: "We will explain the first step before asking for a wallet.", evidenceIds: [eid] };
    expect((await POST(req(OWNER, body), params)).status).toBe(201);
    expect((await POST(req(OWNER, { ...body, decision: "We will keep the current sequence and make the labels clearer." }), params)).status).toBe(201);
    const returned = await getCompanyReview(OWNER, "draft_review");
    expect(returned!.decisions).toHaveLength(2);
    expect(returned!.decisions.every(d => d.evidenceIds[0] === eid)).toBe(true);
    expect(returned!.decisions[1].decision).toBe(body.decision);
  });
});
