import { describe, it, expect, beforeEach, vi } from "vitest";

// Guard for the claim the SEED_AUTH_ENFORCE flip rests on.
//
// seeder.ts:23 asserts the seeding caller "lives outside this repo" and must be
// taught to send x-seed-secret BEFORE enforcement is flipped, or seeding breaks.
// Measured 2026-07-17: that is false. Live seeding is scripts/fund-batch.ts ->
// POST /api/seed, and /api/seed calls createTask DIRECTLY. It never routes through
// POST /api/tasks, so it never touches resolvePostingPrivilege, so SEED_AUTH_ENFORCE
// cannot throttle it. The flip is a no-op for seeding.
//
// That claim was the whole reason the bypass stayed live, so it is worth a gate
// rather than a paragraph. This file is BEHAVIOURAL, not a grep for a call site:
// it flips enforcement ON and exercises the throttle that seeding was feared to
// hit. If anyone ever reroutes seeding through the privileged /api/tasks path,
// the first case here goes red and the "flipping is safe" claim stops being true
// silently.
//
// Verified by mutation: pointing the seed route at POST /api/tasks turns case 1
// red (429) while every seeder.test.ts and tasks-route-privilege.test.ts case
// stays green.

// /api/seed reads ADMIN_SECRET at MODULE scope (seed/route.ts:4), unlike
// /api/tasks which reads it per-request. ESM hoists imports above any statement
// here, so setting it in beforeEach lands too late and the route answers 503
// "Admin endpoint not configured" forever. vi.hoisted runs before the imports.
const SECRET = vi.hoisted(() => {
  process.env.ADMIN_SECRET = "test-seed-secret";
  return "test-seed-secret";
});

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
// Substitute the side EFFECT (a Redis write), never the rule: MAX_TASK_POINTS is
// the seed route's points ceiling, so a hand-written stub value here would grade
// a cap nobody ships. importOriginal keeps the real constant.
vi.mock("@/lib/proof-of-favour", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proof-of-favour")>()),
  recordFavourPosted: async () => {},
}));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { POST as SEED } from "@/app/api/seed/route";
import { POST as TASKS } from "@/app/api/tasks/route";
import { MAX_TASK_POINTS } from "@/lib/proof-of-favour";

function post(url: string, body: any, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

// A batch shaped like scripts/fund-batch.ts sends: points-only, never funded.
const batch = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    description: `Post about FAVOUR on X in your own words, take ${i + 1}: what you did and what you earned`,
    location: "Anywhere",
    category: "social",
    bountyUsdc: 10,
    deadlineHours: 1370,
    rewardType: "points",
    campaignId: "say-it-out-loud",
  }));

// The prior-post-today that trips the /api/tasks "1 free points task per 24h"
// throttle for any non-exempt poster.
// Shaped like a real stored task: /api/seed dedupes on description.slice(0,80),
// so a fixture without one throws rather than seeding.
const throttleTripwire = [
  {
    poster: "agent:relay",
    rewardType: "points",
    description: "An earlier points favour posted today by the seeder",
    onChainId: null,
    createdAt: new Date().toISOString(),
  },
];

beforeEach(() => {
  created.length = 0;
  existing = [];
  process.env.ADMIN_SECRET = SECRET;
  delete process.env.SEED_AUTH_ENFORCE;
});

describe("the flip cannot break seeding: /api/seed does not go through the privilege gate", () => {
  it("ENFORCED: seeds a whole batch even with the throttle tripwire set", async () => {
    process.env.SEED_AUTH_ENFORCE = "true";
    existing = throttleTripwire;

    const res = await SEED(post("http://localhost/api/seed", { secret: SECRET, tasks: batch(3) }));

    // 3 points tasks in one call, from agent:relay, with a points post already
    // today, while enforcement is ON. Through /api/tasks this is a 429 on the
    // second task. Through /api/seed it is untouched.
    expect(res.status).toBe(201);
    expect(created).toHaveLength(3);
    expect(created.every((t) => t.poster === "agent:relay")).toBe(true);
  });

  it("the same batch through /api/tasks IS throttled — the contrast that makes the point", async () => {
    process.env.SEED_AUTH_ENFORCE = "true";
    existing = throttleTripwire;

    const res = await TASKS(
      post("http://localhost/api/tasks", {
        poster: "agent:relay",
        ...batch(1)[0],
      })
    );

    expect(res.status).toBe(429);
    expect(created).toHaveLength(0);
  });

  it("enforcement ON vs OFF makes no difference to /api/seed", async () => {
    existing = throttleTripwire;
    process.env.SEED_AUTH_ENFORCE = "true";
    const on = await SEED(post("http://localhost/api/seed", { secret: SECRET, tasks: batch(2) }));
    const seededOn = created.length;

    created.length = 0;
    delete process.env.SEED_AUTH_ENFORCE;
    const off = await SEED(post("http://localhost/api/seed", { secret: SECRET, tasks: batch(2) }));

    // Assert the VALUE, not just that the two agree: an early version of this
    // case passed on 503 === 503, agreeing that seeding was equally broken both
    // ways. Two identical failures are not evidence of a no-op.
    expect(on.status).toBe(201);
    expect(off.status).toBe(201);
    expect(seededOn).toBe(2);
    expect(created).toHaveLength(2);
  });
});

describe("flipping does not weaken /api/seed's own auth", () => {
  it("a wrong secret is rejected whether enforcement is on or off", async () => {
    for (const enforced of ["true", undefined]) {
      created.length = 0;
      if (enforced) process.env.SEED_AUTH_ENFORCE = enforced;
      else delete process.env.SEED_AUTH_ENFORCE;

      const res = await SEED(post("http://localhost/api/seed", { secret: "nope", tasks: batch(1) }));
      expect(res.status).toBe(401);
      expect(created).toHaveLength(0);
    }
  });

  it("the money rule holds under enforcement: an unfunded USDC seed is refused", async () => {
    process.env.SEED_AUTH_ENFORCE = "true";
    const unfunded = [{ ...batch(1)[0], rewardType: "usdc", bountyUsdc: 50, onChainId: null, escrowTxHash: null }];

    const res = await SEED(post("http://localhost/api/seed", { secret: SECRET, tasks: unfunded }));

    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});

// The seed points ceiling. It was a hardcoded 10 until Sep 3, 2026 — a leftover
// from the 1-10 season economy — while board-replenish filled the SAME board
// with 10-20 point favours through createTask. So a fresh admin batch could only
// be seeded at a value below the recycled favours it was meant to replace, and
// the stalest card on the board was the best-paying one. These pin the ceiling
// to the one economy-wide cap so it cannot drift back to a magic number.
describe("seed points ceiling is the economy-wide cap, not a magic number", () => {
  const pointsTask = (points: number) => ({
    description: `A fresh points favour worth ${points}: photograph something specific near you`,
    location: "Anywhere",
    category: "photo",
    bountyUsdc: points,
    deadlineHours: 336,
    rewardType: "points",
  });

  it("accepts a points favour above the old hardcoded 10 and up to MAX_TASK_POINTS", async () => {
    const res = await SEED(
      post("http://localhost/api/seed", { secret: SECRET, tasks: [pointsTask(MAX_TASK_POINTS)] })
    );
    expect(res.status).toBe(201);
    expect(created).toHaveLength(1);
    expect(created[0].bountyUsdc).toBe(MAX_TASK_POINTS);
  });

  it("still rejects a points favour above MAX_TASK_POINTS", async () => {
    const res = await SEED(
      post("http://localhost/api/seed", { secret: SECRET, tasks: [pointsTask(MAX_TASK_POINTS + 1)] })
    );
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });
});
