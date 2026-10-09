import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The refused cases on the real routes. Written 9 Oct 2026 after a fault run on
// f2ce636: six hand-made faults in these files passed all 1,444 tests, because
// the route tests sent only the accepted case and seven files replace the tier
// gate with a mock that always says yes.
//
// Rules for this file:
//   - lib/verification-tier and lib/session are REAL here. Never vi.mock them.
//   - Each case asserts the refusal's own words, not the status alone, so a 403
//     from an earlier check cannot stand in for the one under test.
//   - Each case was seen to fail with its fault in place (see the fault id).

const POSTER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TX = `0x${"ab".repeat(32)}`;

const store = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  level: null as string | null, // the stored World ID level; null means no Redis at all
}));

vi.mock("@/lib/store", () => ({
  getTask: async () => (store.task ? { ...store.task } : null),
  cancelTask: async () => (store.task ? { ...store.task, status: "cancelled" } : null),
  submitProof: async () => { throw new Error("a refused proof must not reach the store"); },
  completeTask: async () => { throw new Error("a refused proof must not complete a task"); },
  createTask: async () => { throw new Error("a refused favour must not be stored"); },
  setAttestationHash: async () => {},
  setFollowUp: async () => {},
  spawnRecurringTask: async () => null,
  markSettled: async () => {},
  markSettlementPending: async () => {},
  releaseUncheckedProof: async () => {},
  listTasks: async () => [],
}));

// Only the store read under the tier gate is replaced. tierGateError and
// requiredTier run as written.
vi.mock("@/lib/redis", () => ({
  getRedis: () =>
    store.level === null
      ? null
      : {
          get: async (key: string) =>
            key.startsWith("verified:") ? JSON.stringify({ verificationLevel: store.level }) : null,
          set: async () => "OK",
        },
}));

function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    poster: POSTER,
    claimant: null,
    claimantVerification: null,
    status: "open",
    description: "Take a photo of the bakery door on Rue Oberkampf",
    location: "Paris",
    bountyUsdc: 5,
    rewardType: "points",
    onChainId: null,
    escrowTxHash: null,
    donOnChainId: null,
    lat: null,
    lng: null,
    proofImageUrl: null,
    proofImages: null,
    verificationResult: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

async function cookieFor(address: string): Promise<string> {
  const { issueSessionToken, SESSION_COOKIE } = await import("@/lib/session");
  return `${SESSION_COOKIE}=${issueSessionToken(address, Date.now())}`;
}

let ipCount = 0;
function post(path: string, body: unknown, cookie?: string): NextRequest {
  ipCount += 1;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.0.${ipCount}`,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const kept: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["SESSION_SECRET", "SESSION_ENFORCE"]) kept[k] = process.env[k];
  process.env.SESSION_SECRET = "refusals-test-secret";
  delete process.env.SESSION_ENFORCE;
  store.task = task();
  store.level = null;
});
afterEach(() => {
  for (const [k, v] of Object.entries(kept)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("verify-proof refuses", () => {
  // Fault M4: the own-task check replaced by `if (false)`.
  it("a poster's proof on their own favour, with the poster's own session", async () => {
    const { POST } = await import("@/app/api/verify-proof/route");
    const res = await POST(post("/api/verify-proof", { taskId: "t1", submitter: POSTER, proofNote: "done" }, await cookieFor(POSTER)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Can't submit proof for your own task");
  });

  // Fault M6, through the route: a wallet-level person on a funded 20 dollar favour.
  it("a wallet-level person on a funded 20 USDC favour, and names both levels", async () => {
    store.task = task({ bountyUsdc: 20, rewardType: "usdc", onChainId: 7, escrowTxHash: TX });
    const { POST } = await import("@/app/api/verify-proof/route");
    const res = await POST(post("/api/verify-proof", { taskId: "t1", submitter: OTHER, proofNote: "done" }, await cookieFor(OTHER)));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Insufficient verification level");
    expect(body.required).toBe("orb");
    expect(body.current).toBe("wallet");
  });

  it("a proof sent under another wallet's session", async () => {
    const { POST } = await import("@/app/api/verify-proof/route");
    const res = await POST(post("/api/verify-proof", { taskId: "t1", submitter: OTHER, proofNote: "done" }, await cookieFor(POSTER)));
    expect(res.status).toBe(403);
  });
});

describe("the real tier gate", () => {
  // Fault M6: `userRank < required.rank` became `>`. Both directions are read,
  // so a gate that refuses everyone fails here as well as one that refuses nobody.
  const rows: Array<[level: string, usd: number, refused: string | null]> = [
    ["wallet", 5, null],
    ["wallet", 10, "device"],
    ["wallet", 20, "orb"],
    ["device", 10, null],
    ["device", 20, "orb"],
    ["orb", 5, null],
    ["orb", 20, null],
    ["orb", 5000, null],
  ];
  for (const [level, usd, refused] of rows) {
    it(`${level} on ${usd} USDC: ${refused ? `refused, needs ${refused}` : "allowed"}`, async () => {
      store.level = level;
      const { tierGateError } = await import("@/lib/verification-tier");
      const gate = await tierGateError(OTHER, usd);
      if (refused) expect(gate).toEqual({ required: refused, current: level });
      else expect(gate).toBeNull();
    });
  }

  it("reads wallet level when there is no store", async () => {
    store.level = null;
    const { tierGateError } = await import("@/lib/verification-tier");
    expect(await tierGateError(OTHER, 20)).toEqual({ required: "orb", current: "wallet" });
  });
});

describe("cancel refuses", () => {
  // Fault A1: the 403 line after ownershipError removed.
  it("a cancel sent under another wallet's session, when sessions are enforced", async () => {
    process.env.SESSION_ENFORCE = "true";
    const { POST } = await import("@/app/api/tasks/[id]/cancel/route");
    const res = await POST(post("/api/tasks/t1/cancel", { poster: POSTER }, await cookieFor(OTHER)), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Session does not match the wallet for this action.");
  });

  it("a cancel with no session, when sessions are enforced", async () => {
    process.env.SESSION_ENFORCE = "true";
    const { POST } = await import("@/app/api/tasks/[id]/cancel/route");
    const res = await POST(post("/api/tasks/t1/cancel", { poster: POSTER }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  // The control: the same call with the poster's own session goes through, so
  // the two refusals above are about the session and nothing else.
  it("lets the poster cancel with their own session", async () => {
    process.env.SESSION_ENFORCE = "true";
    const { POST } = await import("@/app/api/tasks/[id]/cancel/route");
    const res = await POST(post("/api/tasks/t1/cancel", { poster: POSTER }, await cookieFor(POSTER)), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
  });
});

describe("votes refuse", () => {
  // Fault A3: the 403 dropped, so a signed-out vote answered 200.
  it("a vote with no session", async () => {
    const { POST } = await import("@/app/api/votes/route");
    const res = await POST(post("/api/votes", { id: "strive" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
  });
});

describe("posting a favour refuses", () => {
  // Fault A4: the range check cut down to Number.isFinite.
  for (const bountyUsdc of [-5, 10001]) {
    it(`a bounty of ${bountyUsdc}, by the range check itself`, async () => {
      const { POST } = await import("@/app/api/tasks/route");
      const res = await POST(post("/api/tasks", { poster: POSTER, description: "Take a photo of the bakery door", bountyUsdc }, await cookieFor(POSTER)));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Bounty must be between $0.01 and $10,000");
    });
  }
});
