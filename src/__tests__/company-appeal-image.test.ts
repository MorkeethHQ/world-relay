import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
vi.mock("@/lib/company-appeal", () => ({ getCompanyAppeal: async () => ({ owner, campaignId: "campaign", outcome: "cleared", images: ["data:image/png;base64,aGVsbG8="] }) }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
import { GET } from "@/app/api/campaigns/drafts/[id]/review/[evidenceId]/image/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
const params = { params: Promise.resolve({ id: "campaign", evidenceId: "case" }) };
function request(wallet?: string, query = "") { return new NextRequest(`http://localhost/api/image${query}`, { headers: wallet ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}` } : {} }); }
beforeEach(() => { process.env.SESSION_SECRET = "local-test-only"; });
describe("retained company photo", () => {
  it("only serves the owning company's bound image", async () => {
    expect((await GET(request(), params)).status).toBe(403);
    expect((await GET(request(other), params)).status).toBe(404);
    expect((await GET(request(owner), { params: Promise.resolve({ id: "other-campaign", evidenceId: "case" }) })).status).toBe(404);
    expect((await GET(request(owner, "?index=-1"), params)).status).toBe(404);
    const response = await GET(request(owner), params);
    expect(response.status).toBe(200); expect(await response.text()).toBe("hello");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
