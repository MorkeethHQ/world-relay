import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// THE ?address= READS (14 Oct 2026). With SESSION_ENFORCE off, naming any
// wallet in the query returned that person's own data. Classified:
//   PRIVATE, now own session only (ownerRefusal, whatever the switch says):
//     daily (their answer), polls (their vote), predictions (their stake),
//     campaign progress (their payout and its tx), proof-of-favour (points
//     history), referral/stats, reputation?address= (credit refs).
//     The first four answer a non-owner the anonymous view, so screens keep
//     working; the last three refuse a non-owner (only the own profile calls them).
//   PUBLIC BY DESIGN, unchanged: jury?address= (an opaque deck, no personal
//     data) and the proof image (shown on public History cards).

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET_ANSWER = "my private daily answer";
const PAY_TX = "0x" + "c".repeat(64);

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/daily", () => ({
  getPrompt: async () => ({ question: "Q?", funFact: "fact" }),
  publicPrompt: (p: Record<string, unknown>) => ({ question: p.question }),
  getSubmission: async (_d: string, a: string) => (a === OWNER ? { answer: SECRET_ANSWER } : null),
  getResults: async (_d: string, a: string) => (a === OWNER ? { total: 3 } : null),
  getStreak: async (a: string) => (a === OWNER ? 4 : 0),
  submitDaily: async () => ({}),
  utcDate: () => "2026-10-14",
}));
vi.mock("@/lib/polls-store", () => ({
  listPolls: async () => [{ id: "p1", question: "Q", options: ["A", "B"], creator: OTHER, voters: { [OWNER]: "B" } }],
  createPoll: async () => ({}),
}));
vi.mock("@/lib/public-id", () => ({ publicIdOrSame: (w: string) => `p_${w.slice(2, 6)}` }));
vi.mock("@/lib/predictions", () => ({
  listPredictions: async () => [{ id: "x1", options: ["yes", "no"] }],
  getStakes: async () => ({ [OWNER]: { option: "yes", amount: 5 } }),
  poolsFrom: () => ({}),
  isLocked: () => false,
}));
vi.mock("@/lib/campaigns", () => ({ getCampaign: () => ({ id: "c1", unlock: { unlockThreshold: 3, unlockAmount: 1, requiresOrb: false } }) }));
vi.mock("@/lib/campaign-unlock", () => ({
  getUnlockProgress: async () => ({ threshold: 3, unlockAmount: 1, progress: 3, paid: true, payTx: PAY_TX, potExhausted: false }),
}));
vi.mock("@/lib/proof-of-favour", () => ({
  getProofOfFavour: async (a: string) => ({ address: a, totalPoints: 9, pointsHistory: [{ action: "jury_verdict", points: 1, timestamp: "t" }] }),
  getPointsToNextLevel: () => 1,
}));
vi.mock("@/lib/referral", () => ({ getReferralStats: async () => ({ invited: 2, earned: 10 }), REFERRAL_LIFETIME_CAP: 50 }));
vi.mock("@/lib/reputation", () => ({
  getReputation: async (a: string) => ({ address: a, tasksCompleted: 2, creditRefs: ["task-secret-ref"] }),
  getLeaderboard: async () => [],
  getSuccessRate: () => 1, getTrustScore: () => 1, getMultipliedTrustScore: () => 1, getMultiplierLabel: () => null, getVerificationMultiplier: () => 1,
}));

import { GET as DAILY } from "@/app/api/daily/route";
import { GET as POLLS } from "@/app/api/polls/route";
import { GET as PREDICTIONS } from "@/app/api/predictions/route";
import { GET as PROGRESS } from "@/app/api/campaigns/[id]/progress/route";
import { GET as POF } from "@/app/api/proof-of-favour/route";
import { GET as REFERRAL } from "@/app/api/referral/stats/route";
import { GET as REPUTATION } from "@/app/api/reputation/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";

const get = (url: string, as?: string) => {
  const token = as ? issueSessionToken(as, Date.now()) : null;
  if (as && !token) throw new Error("no session key");
  return new NextRequest(`http://localhost${url}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
};
const text = async (r: Response) => r.text();
const ENV = { ...process.env };
beforeEach(() => { process.env.SESSION_SECRET = "test-secret-not-a-real-one"; delete process.env.SESSION_ENFORCE; });
afterEach(() => { process.env = { ...ENV }; });
// Each read is tried as nobody and as another wallet; the owner still gets their data.
const strangers: Array<[string, string | undefined]> = [["no cookie", undefined], ["another wallet", OTHER]];

describe("daily: their answer and streak only to their session", () => {
  for (const [who, as] of strangers) it(`${who}: the anonymous view`, async () => {
    const body = JSON.parse(await text(await DAILY(get(`/api/daily?address=${OWNER}`, as))));
    expect(JSON.stringify(body)).not.toContain(SECRET_ANSWER);
    expect(body).toMatchObject({ submitted: false, results: null, streak: 0 });
  });
  it("owner: their answer", async () => {
    expect((await DAILY(get(`/api/daily?address=${OWNER}`, OWNER)).then((r) => r.json())).yourAnswer).toBe(SECRET_ANSWER);
  });
});

describe("polls: how someone voted only to their session", () => {
  for (const [who, as] of strangers) it(`${who}: no vote shown`, async () => {
    const [p] = (await POLLS(get(`/api/polls?userId=${OWNER}`, as)).then((r) => r.json())).polls;
    expect(p).toMatchObject({ youVoted: false, yourVote: null, voterCount: 1 });
  });
  it("owner: their vote", async () => {
    const [p] = (await POLLS(get(`/api/polls?userId=${OWNER}`, OWNER)).then((r) => r.json())).polls;
    expect(p).toMatchObject({ youVoted: true, yourVote: "B" });
  });
});

describe("predictions: a stake only to its owner", () => {
  for (const [who, as] of strangers) it(`${who}: myStake is null`, async () => {
    const [p] = (await PREDICTIONS(get(`/api/predictions?address=${OWNER}`, as)).then((r) => r.json())).predictions;
    expect(p.myStake).toBeNull();
  });
  it("owner: their stake", async () => {
    const [p] = (await PREDICTIONS(get(`/api/predictions?address=${OWNER}`, OWNER)).then((r) => r.json())).predictions;
    expect(p.myStake).toEqual({ option: "yes", amount: 5 });
  });
});

describe("campaign progress: a payout and its tx only to its owner", () => {
  const params = Promise.resolve({ id: "c1" });
  for (const [who, as] of strangers) it(`${who}: the static view, no tx`, async () => {
    const t = await text(await PROGRESS(get(`/api/campaigns/c1/progress?address=${OWNER}`, as), { params }));
    expect(t).not.toContain(PAY_TX);
    expect(JSON.parse(t).unlock).toMatchObject({ progress: 0, paid: false, payTx: null });
  });
  it("owner: their progress", async () => {
    const t = await text(await PROGRESS(get(`/api/campaigns/c1/progress?address=${OWNER}`, OWNER), { params }));
    expect(t).toContain(PAY_TX);
  });
});

describe("own-profile reads refuse anyone else", () => {
  const reads: Array<[string, (r: NextRequest) => Promise<Response>, string]> = [
    ["proof-of-favour", (r) => POF(r), `/api/proof-of-favour?address=${OWNER}`],
    ["referral/stats", (r) => REFERRAL(r), `/api/referral/stats?address=${OWNER}`],
    ["reputation", (r) => REPUTATION(r), `/api/reputation?address=${OWNER}`],
  ];
  for (const [name, call, url] of reads) {
    for (const [who, as] of strangers) it(`${name}, ${who}: refused, nothing personal`, async () => {
      const res = await call(get(url, as));
      expect([401, 403]).toContain(res.status);
      const t = await res.text();
      expect(t).not.toContain("pointsHistory");
      expect(t).not.toContain("task-secret-ref");
      expect(t).not.toContain("invited");
    });
    it(`${name}, owner: 200`, async () => {
      expect((await call(get(url, OWNER))).status).toBe(200);
    });
  }
  it("the owner's reputation is never put in a shared cache", async () => {
    expect((await REPUTATION(get(`/api/reputation?address=${OWNER}`, OWNER))).headers.get("cache-control")).toMatch(/private/);
  });
  it("the reputation leaderboard (no address) stays public", async () => {
    expect((await REPUTATION(get("/api/reputation"))).status).toBe(200);
  });
});
