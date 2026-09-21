import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Route-level guard for Inv 4 on POST /api/tasks (PR12 review, 2026-09-21).
//
// `poster` is a public body field. Before this, the route checked only its
// length, so anyone could post a favour, or a usdc-v2 listing, in another
// wallet's name. These cases pin the binding to the session cookie: the wallet a
// favour is posted as must be the wallet the session proves, with SESSION_ENFORCE
// unset, which is how production runs.

const created: any[] = [];
let existing: any[] = [];

vi.mock("@/lib/store", () => ({
  createTask: async (input: any) => {
    const task = { id: `t${created.length + 1}`, ...input, agent: null, createdAt: new Date().toISOString() };
    created.push(task);
    return task;
  },
  listTasks: async () => existing,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/escrow", () => ({ isEscrowTaskFunded: async () => false }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/proof-of-favour", () => ({ recordFavourPosted: async () => {} }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { POST } from "@/app/api/tasks/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const OWNER = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";
const SEED = "test-seed-secret";

const saved = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_SECRET: process.env.ADMIN_SECRET,
  SESSION_ENFORCE: process.env.SESSION_ENFORCE,
  SEED_AUTH_ENFORCE: process.env.SEED_AUTH_ENFORCE,
  ESCROW_V2_ENABLED: process.env.ESCROW_V2_ENABLED,
  ESCROW_V2_MAX_USD: process.env.ESCROW_V2_MAX_USD,
};

function cookieFor(address: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${issueSessionToken(address, Date.now())}` };
}

function req(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

const points = (poster: string, over = {}) => ({
  poster,
  description: "Check whether the bakery on rue de Bretagne still has the almond croissants",
  location: "Paris",
  bountyUsdc: 5,
  deadlineHours: 24,
  rewardType: "points",
  ...over,
});

const paid = (poster: string, over = {}) => points(poster, { bountyUsdc: 3, rewardType: "usdc-v2", ...over });

beforeEach(() => {
  created.length = 0;
  existing = [];
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ADMIN_SECRET = SEED;
  delete process.env.SESSION_ENFORCE;
  delete process.env.SEED_AUTH_ENFORCE;
  delete process.env.ESCROW_V2_ENABLED;
  delete process.env.ESCROW_V2_MAX_USD;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("points favour: the poster is the session's wallet", () => {
  it("a wallet with its own session posts", async () => {
    const res = await POST(req(points(A), cookieFor(A)));
    expect(res.status).toBe(201);
    expect(created).toHaveLength(1);
    expect(created[0].poster).toBe(A);
  });

  it("the match is case-insensitive, and the body's spelling is what is stored", async () => {
    const mixed = "0x00000000000000000000000000000000000000AA";
    const res = await POST(req(points(mixed), cookieFor(A)));
    expect(res.status).toBe(201);
    expect(created[0].poster).toBe(mixed);
  });

  it("a session for B cannot post as A", async () => {
    const res = await POST(req(points(A), cookieFor(B)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
    expect(created).toHaveLength(0);
  });

  it("no session cannot post as A, with SESSION_ENFORCE unset", async () => {
    const res = await POST(req(points(A)));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
    expect(created).toHaveLength(0);
  });

  it("a forged cookie is no session", async () => {
    const res = await POST(req(points(A), { cookie: `${SESSION_COOKIE}=${issueSessionToken(A, Date.now())}x` }));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("a preview dev_ identity cannot post, and is told why", async () => {
    const res = await POST(req(points("dev_abc123")));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("wallet_required");
    expect(created).toHaveLength(0);
  });

  it("the refusal comes before the one-a-day read, so a victim's quota is not probed", async () => {
    existing = [{ poster: A, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(A)));
    expect(res.status).toBe(403);
  });
});

describe("one points favour a day, per wallet, whatever the letter case", () => {
  // The session match is case-insensitive, so the throttle must be too. Before
  // 2026-09-21 it compared with ===, and a wallet could post again the same day
  // by sending its own address in another case.
  const upper = A.replace("aa", "AA");

  it("a wallet that posted today cannot post again by changing the case of its address", async () => {
    existing = [{ poster: A, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(upper), cookieFor(A)));
    expect(res.status).toBe(429);
    expect(created).toHaveLength(0);
  });

  it("the same holds when the earlier post was stored in the other case", async () => {
    existing = [{ poster: upper, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(A), cookieFor(A)));
    expect(res.status).toBe(429);
    expect(created).toHaveLength(0);
  });

  it("another wallet's post today does not throttle this one", async () => {
    existing = [{ poster: B, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(A), cookieFor(A)));
    expect(res.status).toBe(201);
  });
});

describe("paid favour (usdc-v2) cannot be listed in another wallet's name", () => {
  beforeEach(() => {
    process.env.ESCROW_V2_ENABLED = "1";
    process.env.ESCROW_V2_MAX_USD = "5";
  });

  it("the wallet's own session lists it, unfunded, caps unchanged", async () => {
    const res = await POST(req(paid(A), cookieFor(A)));
    expect(res.status).toBe(201);
    expect(created[0].rewardType).toBe("usdc-v2");
    expect(created[0].onChainId).toBeNull();
    expect(created[0].escrowTxHash).toBeNull();
  });

  it("a session for B cannot list it as A", async () => {
    const res = await POST(req(paid(A), cookieFor(B)));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("no session cannot list it as A", async () => {
    const res = await POST(req(paid(A)));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("the seed secret does not let the operator list it as A", async () => {
    const res = await POST(req(paid(A), { "x-seed-secret": SEED }));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("the cap still applies after the gate", async () => {
    const res = await POST(req(paid(A, { bountyUsdc: 6 }), cookieFor(A)));
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});

describe("privileged posters", () => {
  it("the owner address needs the owner's session now", async () => {
    const res = await POST(req(points(OWNER)));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("the owner with its session keeps the exemption", async () => {
    existing = [{ poster: OWNER, rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points(OWNER, { bountyUsdc: 25 }), cookieFor(OWNER)));
    expect(res.status).toBe(201);
  });

  it("an authenticated seeder posts as agent: with no session", async () => {
    process.env.SEED_AUTH_ENFORCE = "true";
    existing = [{ poster: "agent:relay", rewardType: "points", createdAt: new Date().toISOString() }];
    const res = await POST(req(points("agent:relay"), { "x-seed-secret": SEED }));
    expect(res.status).toBe(201);
  });

  it("an agent: poster is not a wallet, so a wallet-shaped agentId does not smuggle one in", async () => {
    const res = await POST(req(points("agent:relay", { agentId: A }), { "x-seed-secret": SEED }));
    expect(res.status).toBe(201);
    expect(created[0].poster).toBe("agent:relay");
  });

  it("a wallet poster cannot borrow the agent lane through the agentId field", async () => {
    const res = await POST(req(points(A, { agentId: "relay" })));
    expect(res.status).toBe(403);
    expect(created).toHaveLength(0);
  });

  it("an agent: poster cannot list a paid favour", async () => {
    process.env.ESCROW_V2_ENABLED = "1";
    const res = await POST(req(paid("agent:relay"), { "x-seed-secret": SEED }));
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});
