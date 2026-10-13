import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// NO WALLET ADDRESS IN AN OPEN LIST (hardening pass, 2026-10-14).
//
// Measured on production 2026-10-13, signed out: GET /api/tasks carried 75
// distinct wallet addresses as poster or claimant and exact coordinates on 56
// rows; GET /api/history carried 33. The allow list of 2026-10-13 kept those
// keys on purpose. This file calls the real GET handlers over a store double
// and reads the bytes they answer with.
//
// THE RULE UNDER TEST: a signed-out answer holds no string that matches 0x
// followed by 40 hex characters. A transaction hash matches that too, and it
// is meant to: a settlement hash names the wallet that was paid.
//
// What the double differs from production in: it holds four rows, and
// production holds about 300. The rule is per row, so the count does not
// change the result.

const ADDRESS = /0x[0-9a-fA-F]{40}/;
const ANA = "0x7e57da7a000000000000000000000000000000a1";
const BEN = "0x7e57da7a000000000000000000000000000000b2";
const EVE = "0x7e57da7a000000000000000000000000000000e5";
const CONTRACT = "0xC0FFEE0000000000000000000000000000000001"; // made up: the real escrow address may live in the config module only
const HASH = "0x" + "ab".repeat(32);

const base = {
  category: "feedback", location: "Paris 11e", bountyUsdc: 5, deadline: "2099-01-01T00:00:00Z",
  proofImageUrl: null, proofImages: null, verificationResult: null, agent: null, aiFollowUp: null, recurring: null,
  callbackUrl: null, onChainId: null, claimCode: null, taskType: "standard", rewardType: "points",
  donOnChainId: null, donStakeTxHash: null, requiresClaim: false, pendingRelease: false,
  maxCompletions: 1, completionCount: 0, createdAt: "2026-10-01T00:00:00Z",
};
const ROWS = [
  { ...base, id: "open-by-ana", poster: ANA, claimant: null, status: "open", lat: 48.85837, lng: 2.29448, proofNote: null, attestationTxHash: null, escrowTxHash: null },
  { ...base, id: "done-by-ben", poster: ANA, claimant: BEN, status: "completed", lat: 48.85837, lng: 2.29448, proofNote: `sent from ${EVE} as asked`, attestationTxHash: HASH, escrowTxHash: HASH, settlementTx: HASH, escrowV2Address: CONTRACT, onChainId: 7 },
  { ...base, id: "by-an-agent", poster: "agent:openclaw", claimant: null, status: "open", lat: null, lng: null, proofNote: null, attestationTxHash: null, escrowTxHash: null },
  { ...base, id: "ben-claimed", poster: EVE, claimant: BEN, status: "claimed", lat: -33.86882, lng: 151.20929, proofNote: null, attestationTxHash: null, escrowTxHash: null },
];

vi.mock("@/lib/store", () => ({
  listTasks: async () => ROWS.map((r) => ({ ...r })),
  getTask: async (id: string) => ROWS.find((t) => t.id === id),
  createTask: async () => null,
  setOnChainId: async () => {},
}));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/agent-analytics", () => ({ getAgentAnalytics: async () => [] }));
vi.mock("@/lib/api-keys", () => ({ checkAgentAuth: async () => ({ authenticated: true }) }));
vi.mock("@/lib/polls-store", () => ({
  listPolls: async () => [{ id: "p1", question: "q", options: ["a", "b"], creator: ANA, category: "x", createdAt: "2026-10-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", votes: [0, 0], totalVotes: 0, voters: {} }],
  createPoll: async () => null,
}));
vi.mock("@/lib/reputation", () => ({
  getReputation: async () => null,
  getLeaderboard: async () => [{ address: ANA, tasksCompleted: 3, tasksFailed: 0, verificationLevel: "orb" }, { address: BEN, tasksCompleted: 1, tasksFailed: 0, verificationLevel: "wallet" }],
  getSuccessRate: () => 1, getTrustScore: () => 50, getMultipliedTrustScore: () => 50, getMultiplierLabel: () => "x1", getVerificationMultiplier: () => 1,
}));

import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";
import { NO_SECRET_ID, publicId } from "@/lib/public-id";

const get = (path: string, wallet: string | null = null) =>
  new NextRequest(`http://localhost${path}`, { headers: wallet ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(wallet, Date.now())}` } : {} });

type Row = { id: string; poster: string; claimant: string | null; lat: number | null; lng: number | null; isOwnTask: boolean; isClaimant: boolean; settlementTx?: string; proofNote?: string | null };
const rowsOf = async (res: Response) => ((await res.json()).tasks as Row[]);
const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => { process.env.SESSION_SECRET = "test-secret-not-a-real-one"; });

describe("signed out: no wallet address in the bytes", () => {
  it("GET /api/tasks", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const res = await GET(get("/api/tasks"));
    const text = await res.clone().text();
    expect(text).not.toMatch(ADDRESS);
    expect((await rowsOf(res)).length).toBeGreaterThan(0); // the list is not empty, so the line above read something
  });
  it("GET /api/history", async () => {
    const { GET } = await import("@/app/api/history/route");
    const res = await GET(get("/api/history"));
    const text = await res.clone().text();
    expect(text).not.toMatch(ADDRESS);
    expect((await rowsOf(res)).map((r) => r.id)).toEqual(["done-by-ben"]);
  });
  it("GET /api/tasks/search, the detail, the agent list, the polls and the leaderboard", async () => {
    const search = await (await import("@/app/api/tasks/search/route")).GET(get("/api/tasks/search?status=all"));
    expect(await search.text()).not.toMatch(ADDRESS);
    const detail = await (await import("@/app/api/tasks/[id]/route")).GET(get("/api/tasks/done-by-ben"), { params: Promise.resolve({ id: "done-by-ben" }) });
    expect(await detail.text()).not.toMatch(ADDRESS);
    const agent = await (await import("@/app/api/agent/tasks/route")).GET(get("/api/agent/tasks?status=all"));
    expect(await agent.text()).not.toMatch(new RegExp(`${ANA}|${BEN}|${EVE}`, "i"));
    const polls = await (await import("@/app/api/polls/route")).GET(get("/api/polls"));
    expect(await polls.text()).not.toMatch(ADDRESS);
    const board = await (await import("@/app/api/reputation/route")).GET(get("/api/reputation"));
    expect(await board.text()).not.toMatch(ADDRESS);
  });
  it("the planted control: the same check goes red on the stored rows", () => {
    // If this ever passes with the rows unchanged, the regular expression reads nothing.
    expect(JSON.stringify(ROWS)).toMatch(ADDRESS);
  });
});

describe("signed out: what a stranger gets instead", () => {
  it("a stable public id per person, the same on every row, and an agent's name as it is", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const rows = await rowsOf(await GET(get("/api/tasks?all=1")));
    const a = byId(rows, "open-by-ana"), b = byId(rows, "done-by-ben") ?? null;
    expect(a.poster).toBe(publicId(ANA));
    expect(a.poster).toMatch(/^p_[0-9a-f]{16}$/);
    if (b) expect(b.poster).toBe(a.poster);
    expect(byId(rows, "by-an-agent").poster).toBe("agent:openclaw");
    expect(publicId(ANA)).not.toBe(publicId(BEN));
    for (const r of rows) { expect(r.isOwnTask).toBe(false); expect(r.isClaimant).toBe(false); }
  });
  it("a coordinate with one decimal, about 11 km", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const rows = await rowsOf(await GET(get("/api/tasks")));
    expect(byId(rows, "open-by-ana")).toMatchObject({ lat: 48.9, lng: 2.3 });
    expect(byId(rows, "ben-claimed")).toMatchObject({ lat: -33.9, lng: 151.2 });
    expect(byId(rows, "by-an-agent")).toMatchObject({ lat: null, lng: null });
  });
  it("hashes, the contract address and an address typed in a note are hidden", async () => {
    const { GET } = await import("@/app/api/history/route");
    const row = byId(await rowsOf(await GET(get("/api/history"))), "done-by-ben");
    expect(row.settlementTx).toBe("[hidden]");
    expect(row.proofNote).toBe("sent from [hidden] as asked");
  });
  it("with no secret the id is one fixed word for everybody, never a hash anyone can rebuild", () => {
    delete process.env.SESSION_SECRET; delete process.env.ADMIN_SECRET;
    expect(publicId(ANA)).toBe(NO_SECRET_ID);
    expect(publicId(BEN)).toBe(NO_SECRET_ID);
  });
  it("the shared answer may be cached, and varies by cookie", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const res = await GET(get("/api/tasks"));
    expect(res.headers.get("cache-control")).toMatch(/^public/);
    expect(res.headers.get("vary")).toBe("Cookie");
  });
});

describe("signed in", () => {
  it("a party to a task gets the whole row: both wallets, the exact place, the flags", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const mine = byId(await rowsOf(await GET(get("/api/tasks", ANA))), "open-by-ana");
    expect(mine).toMatchObject({ poster: ANA, isOwnTask: true, isClaimant: false, lat: 48.85837, lng: 2.29448 });
    const { GET: history } = await import("@/app/api/history/route");
    const done = byId(await rowsOf(await history(get("/api/history", BEN))), "done-by-ben");
    expect(done).toMatchObject({ poster: ANA, claimant: BEN, isOwnTask: false, isClaimant: true, settlementTx: HASH });
  });
  it("a stranger to a task gets public ids and two decimals, about 1 km", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const rows = await rowsOf(await GET(get("/api/tasks", ANA)));
    const other = byId(rows, "ben-claimed");
    expect(other).toMatchObject({ poster: publicId(EVE), claimant: publicId(BEN), isOwnTask: false, isClaimant: false, lat: -33.87, lng: 151.21 });
  });
  it("is never stored in a shared cache", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const res = await GET(get("/api/tasks", ANA));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const { GET: history } = await import("@/app/api/history/route");
    expect((await history(get("/api/history", ANA))).headers.get("cache-control")).toBe("private, no-store");
  });
  it("a bad cookie is a stranger, not a party", async () => {
    const { GET } = await import("@/app/api/tasks/route");
    const req = new NextRequest("http://localhost/api/tasks", { headers: { cookie: `${SESSION_COOKIE}=not-a-token` } });
    expect(await (await GET(req)).text()).not.toMatch(ADDRESS);
  });
});
