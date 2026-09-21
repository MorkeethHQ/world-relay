import { describe, it, expect, beforeEach, vi } from "vitest";

// GET /api/me/contributions is SESSION-ONLY. A favour many people may complete is
// wiped after each pass, so these proof notes and links exist nowhere else in
// public. Serving them by ?address= would publish anyone's proofs to anyone who
// knows their wallet.

const lists: Record<string, any[]> = {};
vi.mock("@/lib/completions", () => ({
  listContributions: async (address: string) => lists[address.toLowerCase()] ?? [],
}));

import { GET } from "@/app/api/me/contributions/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const ME = "0xcccccccccccccccccccccccccccccccccccccccc";
const THEM = "0x1111111111111111111111111111111111111111";

const get = (url: string, cookieFor?: string) =>
  GET(new Request(url, {
    headers: cookieFor ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(cookieFor, Date.now())}` } : {},
  }) as any);

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  lists[ME] = [{ taskId: "mine" }];
  lists[THEM] = [{ taskId: "theirs" }];
});

describe("the signed-in person reads their own record and nobody else's", () => {
  it("returns nothing without a session", async () => {
    const body = await (await get("http://localhost/api/me/contributions")).json();
    expect(body).toEqual({ authenticated: false, contributions: [] });
  });

  it("returns the session owner's own list", async () => {
    const body = await (await get("http://localhost/api/me/contributions", ME)).json();
    expect(body.contributions.map((c: any) => c.taskId)).toEqual(["mine"]);
  });

  it("ignores an ?address= that names someone else", async () => {
    const body = await (await get(`http://localhost/api/me/contributions?address=${THEM}`, ME)).json();
    expect(body.contributions.map((c: any) => c.taskId)).toEqual(["mine"]);
    const anon = await (await get(`http://localhost/api/me/contributions?address=${THEM}`)).json();
    expect(anon.contributions).toEqual([]);
  });
});
