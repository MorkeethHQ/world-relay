import { describe, it, expect, beforeEach, vi } from "vitest";

// A DRAFT OR PROPOSED CAMPAIGN CAN NEVER PAY USDC (FAVOUR-COMPANY-JOURNEY-2026-09-21).
//
// The hard limit on the company journey: "200 USDC is a proposal only." The only
// path that pays campaign USDC is campaign-unlock.ts, which resolves a campaign
// through getCampaign(). These tests put a real draft, with a 200 USDC proposed
// pool, in the store, then drive the unlock path at it with a payout sender that
// records every call. If getCampaign ever resolves a draft, or a draft ever carries
// an unlock or a pot, a payout becomes reachable and this file goes red.

const store = new Map<string, any>();
const sets = new Map<string, Set<string>>();
const fakeRedis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: any, opts?: { nx?: boolean }) => { if (opts?.nx && store.has(k)) return null; store.set(k, v); return "OK"; },
  lpush: async (k: string, v: string) => { const l = store.get(k) ?? []; l.unshift(v); store.set(k, l); return l.length; },
  ltrim: async () => "OK",
  del: async (k: string) => (store.delete(k) ? 1 : 0),
  lrange: async (k: string, a: number, b: number) => (store.get(k) ?? []).slice(a, b + 1),
  sadd: async (k: string, m: string) => { const s = sets.get(k) ?? new Set(); const had = s.has(m); s.add(m); sets.set(k, s); return had ? 0 : 1; },
  smembers: async (k: string) => [...(sets.get(k) ?? [])],
  scard: async (k: string) => (sets.get(k) ?? new Set()).size,
  incr: async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, n); return n; },
  srem: async () => 0,
};
vi.mock("@/lib/redis", () => ({ getRedis: () => fakeRedis }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));

import { getCampaign, getCampaigns } from "@/lib/campaigns";
import { recordCampaignCompletion, tryUnlockPayout } from "@/lib/campaign-unlock";
import { validateDraftInput, saveDraft, draftCanPayUsdc, DRAFT_PREFIX, publishDraft, getPublishedCampaign, listPublishedCampaigns } from "@/lib/campaign-drafts";
import { GET as COMPANY_GET } from "@/app/api/campaigns/company/[id]/route";
import { POST as DRAFT_POST, GET as DRAFT_GET } from "@/app/api/campaigns/drafts/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const COMPANY = "0xcccccccccccccccccccccccccccccccccccccccc";
const OTHER = "0x1111111111111111111111111111111111111111";
const PARTICIPANT = "0x3333333333333333333333333333333333333333";

const EXAMPLE = {
  company: "Example company",
  brief: "Short honest pieces about our new oat latte, made by real customers.",
  pieces: [{ kind: "ugc", count: 5 }, { kind: "article", count: 2 }, { kind: "review", count: 10 }],
  rewardPerPiecePoints: 10,
  proposedPoolUsdc: 200,
  reviewRule: "ai_and_jury",
};

async function aSavedDraft() {
  const v = validateDraftInput({
    ...EXAMPLE,
    // Everything a hostile or careless caller might send to make it payable.
    unlock: { pot: 200, unlockThreshold: 1, unlockAmount: 200, requiresOrb: true, maxCountedPerUser: 1 },
    pot: 200,
    funded: true,
    escrowTxHash: "0x" + "a".repeat(64),
    status: "live",
    owner: OTHER,
  });
  if (!v.ok) throw new Error(v.error);
  const saved = await saveDraft(COMPANY, v.draft, Date.now(), () => "proposed-200");
  if (!saved.ok) throw new Error(saved.error);
  return saved.draft;
}

beforeEach(() => { store.clear(); sets.clear(); process.env.SESSION_SECRET = "test-secret"; });

describe("a draft or proposed campaign can never pay USDC", () => {
  it("the unlock path cannot resolve a draft, so a clean Orb pass on it sends nothing", async () => {
    const draft = await aSavedDraft();
    expect(store.has(`${DRAFT_PREFIX}${draft.id}`)).toBe(true); // it IS in the store

    const sent: unknown[] = [];
    const spy = async (...args: unknown[]) => { sent.push(args); return "0xpaid"; };
    const out = await recordCampaignCompletion(
      {
        id: "piece-1",
        campaignId: draft.id,
        claimant: PARTICIPANT,
        claimantVerification: "orb",
        verificationResult: { verdict: "pass", confidence: 0.99, reasoning: "ok" },
      } as any,
      spy as any,
    );
    expect(out.unlockTx).toBeNull();
    expect(sent).toHaveLength(0);
    expect(await tryUnlockPayout(draft.id, PARTICIPANT, spy as any)).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("getCampaign never resolves a draft, and no live campaign shares a draft id", async () => {
    const draft = await aSavedDraft();
    expect(getCampaign(draft.id)).toBeNull();
    expect(getCampaigns().some((c) => c.id.startsWith("draft_"))).toBe(false);
  });

  it("nothing that could make it payable survives into storage", async () => {
    const draft = await aSavedDraft();
    const stored = JSON.parse(store.get(`${DRAFT_PREFIX}${draft.id}`));
    for (const k of ["unlock", "pot", "funded", "escrowTxHash"]) expect(stored, k).not.toHaveProperty(k);
    expect(stored.status).toBe("draft");
    expect(stored.owner).toBe(COMPANY); // the session's wallet, never the body's
    expect(stored.proposedPoolUsdc).toBe(200);
    expect(draftCanPayUsdc(stored)).toBe(false);
  });

  it("a proposed pool pays points only: the per-piece reward is held to the points band", () => {
    const tooRich = validateDraftInput({ ...EXAMPLE, rewardPerPiecePoints: 40 });
    expect(tooRich.ok).toBe(false);
  });
});

describe("the drafts API is session-only", () => {
  const req = (method: string, body?: unknown, cookieFor?: string) =>
    new Request("http://localhost/api/campaigns/drafts", {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookieFor ? { cookie: `${SESSION_COOKIE}=${issueSessionToken(cookieFor, Date.now())}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }) as any;

  it("refuses to save without a session", async () => {
    const res = await DRAFT_POST(req("POST", EXAMPLE));
    expect(res.status).toBe(403);
    expect(store.size).toBe(0);
  });

  it("saves as the session's wallet, whatever owner the body claims", async () => {
    const res = await DRAFT_POST(req("POST", { ...EXAMPLE, owner: OTHER }, COMPANY));
    expect(res.status).toBe(201);
    const { draft } = await res.json();
    expect(draft.owner).toBe(COMPANY);
    expect(draft.status).toBe("draft");
    expect(draft).not.toHaveProperty("unlock");
  });

  it("lists only the caller's own drafts", async () => {
    await DRAFT_POST(req("POST", EXAMPLE, COMPANY));
    const mine = await (await DRAFT_GET(req("GET", undefined, COMPANY))).json();
    const theirs = await (await DRAFT_GET(req("GET", undefined, OTHER))).json();
    const anon = await (await DRAFT_GET(req("GET"))).json();
    expect(mine.drafts).toHaveLength(1);
    expect(theirs.drafts).toHaveLength(0);
    expect(anon.drafts).toHaveLength(0);
  });
});


describe("publishing a plan puts real pieces on the board, points only", () => {
  const created: any[] = [];
  const createTask = async (input: any) => { created.push(input); return { id: `task-${created.length}` }; };
  beforeEach(() => { created.length = 0; });

  it("creates one points favour per kind, tagged companyCampaignId and NEVER campaignId", async () => {
    const draft = await aSavedDraft();
    const out = await publishDraft(COMPANY, draft.id, Date.now(), createTask);
    expect(out.ok).toBe(true);
    expect(created).toHaveLength(3);
    for (const t of created) {
      expect(t.rewardType).toBe("points");
      expect(t.bountyUsdc).toBe(10);
      expect(t.companyCampaignId).toBe(draft.id);
      expect(t).not.toHaveProperty("campaignId");
      expect(t).not.toHaveProperty("onChainId");
      expect(t).not.toHaveProperty("escrowTxHash");
      expect(t.poster).toBe(COMPANY);
    }
    expect(created.map((t) => t.maxCompletions).sort((a, b) => a - b)).toEqual([2, 5, 10]);
  });

  it("a clean Orb pass on a PUBLISHED piece still cannot reach a payout", async () => {
    // The red test's second half. A published company campaign is live on the
    // board, and its pool is still only proposed. Its pieces carry
    // companyCampaignId, which the unlock path never reads.
    const draft = await aSavedDraft();
    await publishDraft(COMPANY, draft.id, Date.now(), createTask);
    const sent: unknown[] = [];
    const spy = async (...a: unknown[]) => { sent.push(a); return "0xpaid"; };
    const out = await recordCampaignCompletion(
      { id: "task-1", companyCampaignId: draft.id, claimant: PARTICIPANT, claimantVerification: "orb",
        verificationResult: { verdict: "pass", confidence: 0.99, reasoning: "ok" } } as any,
      spy as any,
    );
    expect(out.unlockTx).toBeNull();
    expect(sent).toHaveLength(0);
    expect(getCampaign(draft.id)).toBeNull();
  });

  it("only the owner can publish, only once, and only once a day", async () => {
    const draft = await aSavedDraft();
    expect(await publishDraft(OTHER, draft.id, Date.now(), createTask)).toMatchObject({ ok: false, status: 404 });
    expect((await publishDraft(COMPANY, draft.id, Date.now(), createTask)).ok).toBe(true);
    expect(await publishDraft(COMPANY, draft.id, Date.now(), createTask)).toMatchObject({ ok: false, status: 409 });
    const second = validateDraftInput(EXAMPLE);
    if (!second.ok) throw new Error(second.error);
    const d2 = await saveDraft(COMPANY, second.draft, Date.now(), () => "second");
    if (!d2.ok) throw new Error(d2.error);
    expect(await publishDraft(COMPANY, d2.draft.id, Date.now(), createTask)).toMatchObject({ ok: false, status: 429 });
    expect(created).toHaveLength(3); // nothing created by the refused calls
  });

  it("the public read shows a published campaign without its owner, and 404s a draft", async () => {
    const draft = await aSavedDraft();
    const get = (id: string) => COMPANY_GET(new Request(`http://localhost/api/campaigns/company/${id}`) as any, { params: Promise.resolve({ id }) });
    expect((await get(draft.id)).status).toBe(404); // still a draft
    await publishDraft(COMPANY, draft.id, Date.now(), createTask);
    const res = await get(draft.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaign.company).toBe("Example company");
    expect(JSON.stringify(body)).not.toContain(COMPANY);
    expect((await listPublishedCampaigns()).map((c) => c.id)).toEqual([draft.id]);
    expect(await getPublishedCampaign("draft_nope")).toBeNull();
  });
});

describe("a company piece never reads as money", () => {
  it("its reward label is points, whatever the field that carries it is called", async () => {
    const { rewardAmountLabel } = await import("@/lib/reward");
    const label = rewardAmountLabel({ rewardType: "points", bountyUsdc: 10 } as any);
    expect(label).toMatch(/10\s*pts/);
    expect(label).not.toMatch(/\$|USDC/);
  });

  it("the progress tracker does not say Paid for a points favour", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../components/Feed.tsx"), "utf8");
    expect(src).toMatch(/label: task\.rewardType === "points" \? "Credited" : "Paid"/);
  });
});

describe("the example card is an explainer, never a campaign", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../components/CompanyCampaign.tsx"), "utf8");
  it("labels itself as an example that is not funded", () => {
    expect(src).toMatch(/Example · not funded/);
    expect(src).toMatch(/A proposed pool is not money/);
  });
  it("names no invented brand: the company is literally 'Example company'", () => {
    expect(src).toMatch(/>Example company</);
  });
  it("the action says what it does: Plan, not Launch, because it saves a private draft", () => {
    expect(src).toMatch(/launchLabel = "Plan a campaign"/);
    expect(src).not.toMatch(/"Launch a campaign"/);
  });
});

describe("publishing cannot put filler on the board", () => {
  it("a keyboard-mash brief is refused at the plan, before anything is saved", () => {
    const junk = validateDraftInput({ ...EXAMPLE, brief: "asdfghjkl asdfghjkl asdfghjkl qwertyuiop" });
    expect(junk.ok).toBe(false);
  });
  it("a real brief passes, and a one-word company name is fine", () => {
    expect(validateDraftInput(EXAMPLE).ok).toBe(true);
    expect(validateDraftInput({ ...EXAMPLE, company: "Acme" }).ok).toBe(true);
  });
});


describe("publishing is resumable: a failure part way can be finished, never duplicated", () => {
  // Oscar's review, 2026-09-21: a failure on piece 2 of 3 used to leave piece 1 live
  // with no campaign identity, spend the day's publish, and leave the company unable
  // to finish or retry.
  it("piece 2 fails, piece 1 keeps its identity, and a same-day retry adds only the rest", async () => {
    const draft = await aSavedDraft();
    const created: any[] = [];
    let failOn = 2;
    const flaky = async (input: any) => {
      if (created.length + 1 === failOn) { failOn = -1; throw new Error("store blip"); }
      created.push(input);
      return { id: `task-${input.maxCompletions}` }; // one id per kind (5, 2, 10)
    };

    const first = await publishDraft(COMPANY, draft.id, Date.now(), flaky);
    expect(first).toMatchObject({ ok: false, status: 502 });
    expect(created).toHaveLength(1);

    // Piece 1 is live and STILL KNOWS ITS CAMPAIGN: identity, kind and label resolve.
    const partial = await getPublishedCampaign(draft.id);
    expect(partial?.status).toBe("publishing");
    expect(partial?.company).toBe("Example company");
    expect(Object.keys(partial?.pieceTaskIds ?? {})).toHaveLength(1);
    // It is not advertised as a finished campaign on the board list.
    expect((await listPublishedCampaigns()).map((c) => c.id)).not.toContain(draft.id);

    // Same day, same draft: the retry is allowed and creates only the two missing kinds.
    const retry = await publishDraft(COMPANY, draft.id, Date.now(), flaky);
    expect(retry.ok).toBe(true);
    expect(created).toHaveLength(3);
    const kinds = created.map((t) => t.maxCompletions).sort((a, b) => a - b);
    expect(kinds).toEqual([2, 5, 10]); // each kind exactly once, no duplicate of piece 1
    const done = await getPublishedCampaign(draft.id);
    expect(done?.status).toBe("published");
    expect(Object.keys(done?.pieceTaskIds ?? {})).toHaveLength(3);
    expect((await listPublishedCampaigns()).map((c) => c.id)).toContain(draft.id);

    // And a further retry is a no-op refusal, not a second set.
    expect(await publishDraft(COMPANY, draft.id, Date.now(), flaky)).toMatchObject({ ok: false, status: 409 });
    expect(created).toHaveLength(3);
  });

  it("a DIFFERENT draft still waits a day, even while the first is part published", async () => {
    const draft = await aSavedDraft();
    const boom = async () => { throw new Error("fail"); };
    await publishDraft(COMPANY, draft.id, Date.now(), boom as any);
    const other = validateDraftInput(EXAMPLE);
    if (!other.ok) throw new Error(other.error);
    const d2 = await saveDraft(COMPANY, other.draft, Date.now(), () => "other");
    if (!d2.ok) throw new Error(d2.error);
    expect(await publishDraft(COMPANY, d2.draft.id, Date.now(), boom as any)).toMatchObject({ ok: false, status: 429 });
  });

  it("two concurrent publishes of one draft cannot both create pieces", async () => {
    const draft = await aSavedDraft();
    const created: any[] = [];
    const slow = async (input: any) => { await new Promise((r) => setTimeout(r, 20)); created.push(input); return { id: `t-${input.maxCompletions}` }; };
    const [a, b] = await Promise.all([
      publishDraft(COMPANY, draft.id, Date.now(), slow),
      publishDraft(COMPANY, draft.id, Date.now(), slow),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(created).toHaveLength(3);
  });
});

describe("the piece cap while the pool is only proposed: 10 of a kind, 20 in total", () => {
  it("the default plan, 5 UGC + 2 articles + 10 reviews = 17, is accepted", () => {
    const ok = validateDraftInput(EXAMPLE);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.draft.pieces.reduce((n, p) => n + p.count, 0)).toBe(17);
  });

  it("exactly 20 is accepted", () => {
    expect(validateDraftInput({ ...EXAMPLE, pieces: [{ kind: "ugc", count: 10 }, { kind: "review", count: 10 }] }).ok).toBe(true);
  });

  it("21 in total is refused, not clamped", () => {
    const r = validateDraftInput({ ...EXAMPLE, pieces: [{ kind: "ugc", count: 10 }, { kind: "article", count: 1 }, { kind: "review", count: 10 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/20 pieces in total/);
  });

  it("11 of one kind is refused, not clamped", () => {
    const r = validateDraftInput({ ...EXAMPLE, pieces: [{ kind: "review", count: 11 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/10 pieces of each kind/);
  });

  it("so one campaign can put at most 200 points on the board", async () => {
    const { MAX_PIECES_TOTAL } = await import("@/lib/campaign-drafts");
    expect(MAX_PIECES_TOTAL * 10).toBe(200);
  });

  it("the form offers nothing the server will refuse", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "../components/CompanyCampaign.tsx"), "utf8");
    expect(src).toMatch(/disabled=\{counts\[k\] >= MAX_PIECES_PER_KIND \|\| totalPieces >= MAX_PIECES_TOTAL\}/);
  });
});
