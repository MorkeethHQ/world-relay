import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory redis covering everything store.ts + board-replenish.ts touch.
const kv = new Map<string, string | number>();
const sets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && kv.has(key)) return null;
      kv.set(key, value);
      return "OK";
    },
    sadd: async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    },
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
    incrby: async (key: string, by: number) => {
      const next = Number(kv.get(key) || 0) + by;
      kv.set(key, next);
      return next;
    },
    incr: async (key: string) => {
      const next = Number(kv.get(key) || 0) + 1;
      kv.set(key, next);
      return next;
    },
    expire: async () => 1,
    lpush: async () => 1,
    ltrim: async () => "OK",
    hincrby: async () => 1,
    pipeline: () => {
      const keys: string[] = [];
      const p = {
        get: (key: string) => {
          keys.push(key);
          return p;
        },
        exec: async () => keys.map((k) => kv.get(k) ?? null),
      };
      return p;
    },
  }),
}));

import {
  BOARD_MIN_OPEN,
  REPLENISH_MAX_PER_RUN,
  RECYCLE_MAX_SHARE,
  REPLENISH_MAX_PER_DAY,
  FALLBACK_FAVOURS,
  validateFavourSpec,
  countOpenVisible,
  recycleCandidates,
  planReplenish,
  generateFavourSpecs,
  normaliseDescription,
  runReplenish,
} from "@/lib/board-replenish";
import { MAX_TASK_POINTS } from "@/lib/proof-of-favour";
import { listTasks } from "@/lib/store";
import type { Task } from "@/lib/types";

const NOW = Date.parse("2026-07-29T03:00:00.000Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

let seq = 0;
function makeTask(overrides: Partial<Task>): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    poster: "agent:dropscout",
    claimant: null,
    category: "photo",
    description: `Photo something interesting number ${seq} and tell the story behind it.`,
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 15,
    deadline: new Date(NOW + DAY).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    claimantVerification: null,
    requiresClaim: false,
    pendingRelease: false,
    settlementTx: null,
    maxCompletions: 10,
    completionCount: 0,
    createdAt: new Date(NOW - 20 * DAY).toISOString(),
    ...overrides,
  };
}

async function persist(task: Task): Promise<void> {
  kv.set(`task:${task.id}`, JSON.stringify(task));
  if (!sets.has("task_ids")) sets.set("task_ids", new Set());
  sets.get("task_ids")!.add(task.id);
}

function expiredCandidate(overrides: Partial<Task> = {}): Task {
  return makeTask({
    status: "expired",
    deadline: new Date(NOW - 2 * DAY).toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  kv.clear();
  sets.clear();
  seq = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

// ---------------------------------------------------------------------------
// The fallback pool is the path that runs when everything else has failed.
// It must be impossible for it to fail validation.
// ---------------------------------------------------------------------------
describe("fallback pool", () => {
  it("every fallback favour passes the validator", () => {
    for (const f of FALLBACK_FAVOURS) {
      expect(validateFavourSpec(f), f.description).not.toBeNull();
    }
  });

  it("has no duplicate descriptions", () => {
    const keys = FALLBACK_FAVOURS.map((f) => normaliseDescription(f.description));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is large enough to fill a full run twice without repeats", () => {
    expect(FALLBACK_FAVOURS.length).toBeGreaterThanOrEqual(2 * REPLENISH_MAX_PER_RUN);
  });
});

describe("validateFavourSpec — points-only gate", () => {
  const good = {
    description: "Photo the oldest building you can see and guess when it was built.",
    category: "photo",
    points: 15,
    deadlineHours: 168,
    maxCompletions: 25,
    agentId: "dropscout",
    location: "Anywhere",
  };

  it("accepts a well-formed points favour", () => {
    expect(validateFavourSpec(good)).toMatchObject({ points: 15, agentId: "dropscout" });
  });

  it("rejects any description that mentions money", () => {
    for (const desc of [
      "Earn $5 by photographing your street corner today for the map.",
      "Buy a coffee and photograph the receipt for our price index.",
      "Show us your crypto wallet setup and how you organise your tokens.",
      "We will pay you in USDC for a photo of the nearest supermarket shelf.",
    ]) {
      expect(validateFavourSpec({ ...good, description: desc }), desc).toBeNull();
    }
  });

  it("rejects points outside 1..MAX_TASK_POINTS", () => {
    expect(validateFavourSpec({ ...good, points: 0 })).toBeNull();
    expect(validateFavourSpec({ ...good, points: MAX_TASK_POINTS + 1 })).toBeNull();
    expect(validateFavourSpec({ ...good, points: NaN })).toBeNull();
  });

  it("rejects unknown agents, bad categories, and out-of-range deadlines", () => {
    expect(validateFavourSpec({ ...good, agentId: "not-a-real-agent" })).toBeNull();
    expect(validateFavourSpec({ ...good, category: "delivery" })).toBeNull();
    expect(validateFavourSpec({ ...good, deadlineHours: 12 })).toBeNull();
    expect(validateFavourSpec({ ...good, deadlineHours: 999 })).toBeNull();
    expect(validateFavourSpec({ ...good, maxCompletions: 0 })).toBeNull();
    expect(validateFavourSpec({ ...good, description: "too short" })).toBeNull();
  });
});

describe("countOpenVisible", () => {
  it("counts open points and funded tasks with a live deadline, nothing else", () => {
    const tasks = [
      makeTask({}), // open points, future deadline → counts
      makeTask({ rewardType: "usdc", onChainId: 7, escrowTxHash: "0xabc" }), // funded → counts
      makeTask({ rewardType: "usdc" }), // unfunded usdc → invisible (R3)
      makeTask({ deadline: new Date(NOW - HOUR).toISOString() }), // past deadline → dead
      makeTask({ status: "expired" }),
      makeTask({ status: "completed" }),
    ];
    expect(countOpenVisible(tasks, NOW)).toBe(2);
  });
});

describe("recycleCandidates — what earns a second run", () => {
  it("takes only expired, seeded, points-only, never-touched favours", () => {
    const yes = expiredCandidate();
    const claimed = expiredCandidate({ claimant: "0xsomeone" });
    const completedOnce = expiredCandidate({ completionCount: 3 });
    const funded = expiredCandidate({ escrowTxHash: "0xdead" });
    const fundedById = expiredCandidate({ onChainId: 42 });
    const usdc = expiredCandidate({ rewardType: "usdc" });
    const userPosted = expiredCandidate({ poster: "0xuser" });
    const ancient = expiredCandidate({ deadline: new Date(NOW - 45 * DAY).toISOString() });
    const staked = expiredCandidate({ donOnChainId: 9 });

    const out = recycleCandidates(
      [yes, claimed, completedOnce, funded, fundedById, usdc, userPosted, ancient, staked],
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual([yes.id]);
  });

  it("orders by most recently expired first", () => {
    const older = expiredCandidate({ deadline: new Date(NOW - 10 * DAY).toISOString() });
    const newer = expiredCandidate({ deadline: new Date(NOW - 1 * DAY).toISOString() });
    const out = recycleCandidates([older, newer], NOW);
    expect(out.map((t) => t.id)).toEqual([newer.id, older.id]);
  });
});

describe("planReplenish — the decision", () => {
  it("is a no-op at or above the floor", () => {
    const tasks = Array.from({ length: BOARD_MIN_OPEN }, () => makeTask({}));
    const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday: 0, now: NOW });
    expect(plan.budget).toBe(0);
    expect(plan.recycle).toEqual([]);
    expect(plan.generateCount).toBe(0);
  });

  it("on the death-spiral board: recycles up to half, generates the rest", () => {
    const tasks = [
      makeTask({}),
      makeTask({}),
      ...Array.from({ length: 4 }, () => expiredCandidate()),
    ];
    const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday: 0, now: NOW });
    expect(plan.deficit).toBe(BOARD_MIN_OPEN - 2);
    expect(plan.budget).toBe(REPLENISH_MAX_PER_RUN);
    // R8: 4 candidates were available but recycle is capped at half the run, so
    // the other half is fresh supply. Before the cap this was 4 recycled / 2
    // generated, and with a real board's deep recycle pool it was 6 / 0 — the
    // reason the live board showed the same ten descriptions for five weeks.
    const cap = Math.floor(REPLENISH_MAX_PER_RUN * RECYCLE_MAX_SHARE);
    expect(plan.recycle).toHaveLength(cap);
    expect(plan.generateCount).toBe(REPLENISH_MAX_PER_RUN - cap);
  });

  it("R8: a deep recycle pool can never crowd out generation", () => {
    // The live failure shape: nothing open, plenty expired. Every slot used to
    // go to recycle; at least half must now be fresh.
    const tasks = Array.from({ length: 30 }, () => expiredCandidate());
    const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday: 0, now: NOW });
    expect(plan.budget).toBe(REPLENISH_MAX_PER_RUN);
    expect(plan.generateCount).toBeGreaterThanOrEqual(Math.floor(REPLENISH_MAX_PER_RUN / 2));
    expect(plan.recycle.length + plan.generateCount).toBe(REPLENISH_MAX_PER_RUN);
  });

  it("R8: a one-slot run stays on recycle rather than forcing a model call", () => {
    const tasks = [
      ...Array.from({ length: BOARD_MIN_OPEN - 1 }, () => makeTask({})),
      expiredCandidate(),
    ];
    const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday: 0, now: NOW });
    expect(plan.budget).toBe(1);
    expect(plan.recycle).toHaveLength(1);
    expect(plan.generateCount).toBe(0);
  });

  it("respects the daily cap", () => {
    const plan = planReplenish({
      tasks: [],
      recycledRecently: new Set(),
      usedToday: REPLENISH_MAX_PER_DAY - 2,
      now: NOW,
    });
    expect(plan.budget).toBe(2);
    const spent = planReplenish({
      tasks: [],
      recycledRecently: new Set(),
      usedToday: REPLENISH_MAX_PER_DAY,
      now: NOW,
    });
    expect(spent.budget).toBe(0);
  });

  it("skips candidates on recycle cooldown and ones already open", () => {
    const cooled = expiredCandidate();
    const dupOfOpen = expiredCandidate({ description: "Photo your street at golden hour and name the light." });
    const open = makeTask({ description: "Photo your street at golden hour and name the light." });
    const fresh = expiredCandidate();

    const plan = planReplenish({
      tasks: [open, cooled, dupOfOpen, fresh],
      recycledRecently: new Set([normaliseDescription(cooled.description)]),
      usedToday: 0,
      now: NOW,
    });
    expect(plan.recycle.map((t) => t.id)).toEqual([fresh.id]);
  });
});

describe("generateFavourSpecs — no key means the pool, deduped", () => {
  it("falls back to the pool and honours the avoid set", async () => {
    const avoid = new Set([normaliseDescription(FALLBACK_FAVOURS[0].description)]);
    const out = await generateFavourSpecs(3, avoid);
    expect(out.generated).toBe(0);
    expect(out.specs).toHaveLength(3);
    expect(out.specs.map((s) => normaliseDescription(s.description))).not.toContain(
      normaliseDescription(FALLBACK_FAVOURS[0].description),
    );
  });
});

describe("runReplenish — end to end against the mock store", () => {
  it("refills a starved board with points-only tasks and stops at the floor", async () => {
    // The measured Jul-28 shape in miniature: 2 open, expired unfilled backlog.
    await persist(makeTask({}));
    await persist(makeTask({}));
    const candidates = [expiredCandidate(), expiredCandidate(), expiredCandidate()];
    for (const c of candidates) await persist(c);

    const receipt = await runReplenish(NOW);
    expect(receipt.openVisible).toBe(2);
    expect(receipt.deficit).toBe(BOARD_MIN_OPEN - 2);
    expect(receipt.recycled).toHaveLength(3);
    expect(receipt.generated).toHaveLength(REPLENISH_MAX_PER_RUN - 3);
    expect(receipt.generatedByModel).toBe(0); // no key → pool

    // THE MONEY GUARD: every task this engine created is points-only.
    const after = await listTasks();
    const created = after.filter((t) => [...receipt.recycled, ...receipt.generated].includes(t.id));
    expect(created).toHaveLength(6);
    for (const t of created) {
      expect(t.rewardType).toBe("points");
      expect(t.onChainId).toBeNull();
      expect(t.escrowTxHash).toBeNull();
      expect(t.donOnChainId).toBeNull();
      expect(t.status).toBe("open");
      expect(t.bountyUsdc).toBeGreaterThanOrEqual(1);
      expect(t.bountyUsdc).toBeLessThanOrEqual(MAX_TASK_POINTS);
      expect(new Date(t.deadline).getTime()).toBeGreaterThan(NOW);
    }

    // Board is now at the floor; a second tick must be a no-op.
    const second = await runReplenish(NOW);
    expect(second.recycled).toEqual([]);
    expect(second.generated).toEqual([]);
    expect(second.reason).toBe("board at or above floor");
  });

  it("a recycled favour goes on cooldown and is not recycled twice", async () => {
    const candidate = expiredCandidate();
    await persist(candidate);

    const first = await runReplenish(NOW);
    expect(first.recycled).toHaveLength(1);

    // Kill everything open again; the same expired original is still in the store.
    const all = await listTasks();
    for (const t of all.filter((x) => x.status === "open")) {
      await persist({ ...t, status: "expired", deadline: new Date(NOW - HOUR).toISOString() });
    }

    const second = await runReplenish(NOW);
    // The candidate's description is on cooldown: whatever the second run
    // recycled, it must not be that favour again.
    const after = await listTasks();
    const secondRecycled = after.filter((t) => second.recycled.includes(t.id));
    for (const t of secondRecycled) {
      expect(normaliseDescription(t.description)).not.toBe(normaliseDescription(candidate.description));
    }
  });

  it("never exceeds the daily cap across runs", async () => {
    const r1 = await runReplenish(NOW); // empty board → creates 6
    expect(r1.recycled.length + r1.generated.length).toBe(REPLENISH_MAX_PER_RUN);

    // Expire everything the first run created, so the board is starved again.
    const all = await listTasks();
    for (const t of all) {
      await persist({ ...t, status: "expired", deadline: new Date(NOW - HOUR).toISOString(), poster: "0xuser" });
    }

    const r2 = await runReplenish(NOW); // creates 6 more → hits 12
    expect(r2.recycled.length + r2.generated.length).toBe(REPLENISH_MAX_PER_DAY - REPLENISH_MAX_PER_RUN);

    const all2 = await listTasks();
    for (const t of all2.filter((x) => x.status === "open")) {
      await persist({ ...t, status: "expired", deadline: new Date(NOW - HOUR).toISOString(), poster: "0xuser" });
    }

    const r3 = await runReplenish(NOW);
    expect(r3.recycled).toEqual([]);
    expect(r3.generated).toEqual([]);
    expect(r3.reason).toBe("daily replenish cap reached");
  });
});

// R11 — the pool asks for views, not errands.
//
// The board is refilled by this pool whenever the model is unavailable, which on
// a quiet night is most of the time. It used to be ten photo errands, and photo
// draws 0.32 completions per task against feedback's 10.17 — so the safety net
// was quietly the reason the board never converted. These pin the shape so it
// cannot drift back.
describe("R11: FALLBACK_FAVOURS ask for a view, not an errand", () => {
  it("every entry still passes the validator it will be checked against", () => {
    for (const f of FALLBACK_FAVOURS) expect(validateFavourSpec(f), f.description).not.toBeNull();
  });

  it("is majority text-first — photo is a minority of the pool, never the default", () => {
    const photo = FALLBACK_FAVOURS.filter((f) => f.category === "photo").length;
    expect(photo).toBeLessThan(FALLBACK_FAVOURS.length / 2);
  });

  it("includes the best-performing category at all", () => {
    // `feedback` was excluded from ALLOWED_CATEGORIES entirely, so the engine
    // could never generate the thing people actually complete.
    expect(FALLBACK_FAVOURS.some((f) => f.category === "feedback")).toBe(true);
    expect(validateFavourSpec({ ...FALLBACK_FAVOURS[0], category: "feedback" })).not.toBeNull();
  });

  it("no entry sends anyone on an errand", () => {
    // The exact verbs of the old pool. "Find a nearby laundromat", "Visit a
    // cafe and time the queue", "Check in at your nearest grocery store".
    const errand = /\b(visit|go to|walk to|travel|find a nearby|nearest|time how long|queue at)\b/i;
    for (const f of FALLBACK_FAVOURS) expect(errand.test(f.description), f.description).toBe(false);
  });

  it("no entry mentions money — points favours must never imply payment", () => {
    for (const f of FALLBACK_FAVOURS) expect(/\$|usdc|dollar|\bpay\b|price/i.test(f.description), f.description).toBe(false);
  });

  it("has no duplicate descriptions", () => {
    const keys = FALLBACK_FAVOURS.map((f) => normaliseDescription(f.description));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
