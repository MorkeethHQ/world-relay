import { describe, it, expect } from "vitest";

// STALL 2026-09-26. Production logged `openBefore=1 deficit=14 generated=0`
// every hour from 22 Sep: the Anthropic key had no credit, the model cap was
// spent, and the 15-item fallback pool was fully blocked by the no-repeat rule
// (a 336 h pool favour stays blocked about 28 days after it is posted). This is
// the acceptance check for the fix: with the model OFF for 60 days, hourly runs
// must keep the visible board at or above the floor after the first day.

import {
  BOARD_MIN_OPEN,
  FALLBACK_FAVOURS,
  NO_REPEAT_DAYS,
  REPLENISH_MAX_PER_DAY,
  REPLENISH_TARGET_OPEN,
  balanceKinds,
  countOpenVisible,
  generateFavourSpecs,
  isNearDuplicate,
  normaliseDescription,
  planReplenish,
  recentDescriptions,
  validateFavourSpec,
} from "@/lib/board-replenish";
import type { Task } from "@/lib/types";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const START = Date.parse("2026-09-01T00:00:00.000Z");

let seq = 0;
function taskFrom(spec: (typeof FALLBACK_FAVOURS)[number], now: number): Task {
  seq += 1;
  return {
    id: `sim${seq}`,
    poster: `agent:${spec.agentId}`,
    claimant: null,
    category: spec.category,
    description: spec.description,
    location: spec.location,
    lat: null,
    lng: null,
    bountyUsdc: spec.points,
    deadline: new Date(now + spec.deadlineHours * HOUR).toISOString(),
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
    maxCompletions: spec.maxCompletions,
    completionCount: 0,
    createdAt: new Date(now).toISOString(),
  } as Task;
}

// One hourly replenish run, model off, mirroring runReplenish's generate path.
async function runOnce(tasks: Task[], now: number, usedToday: number): Promise<number> {
  for (const t of tasks) {
    // expire-tasks expires open and claimed favours at their deadline.
    if ((t.status === "open" || t.status === "claimed") && new Date(t.deadline).getTime() <= now) t.status = "expired";
  }
  const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday, now, recycle: false });
  if (plan.generateCount === 0) return 0;
  const avoid = new Set(tasks.filter((t) => t.status === "open").map((t) => normaliseDescription(t.description)));
  const gen = await generateFavourSpecs(plan.generateCount, avoid, {
    recent: recentDescriptions(tasks, now),
    allowModel: false,
  });
  const chosen = balanceKinds(gen.specs, tasks.filter((t) => t.status === "open"), plan.generateCount);
  for (const spec of chosen) tasks.push(taskFrom(spec, now));
  return chosen.length;
}

// 60 days of hourly runs. Worst case for supply: each day `claimsPerDay` open
// favours move to "claimed" and never return. In production a passing or
// failing proof puts a multi-completion favour back to "open"
// (src/lib/store.ts completeTask), so the real drain is smaller than this.
async function simulate(claimsPerDay: number) {
  const tasks: Task[] = [];
  let usedToday = 0;
  const lows: string[] = [];
  let atTarget = 0;
  let runs = 0;
  for (let h = 0; h < 60 * 24; h++) {
    const now = START + h * HOUR;
    if (h % 24 === 0) usedToday = 0;
    if (claimsPerDay > 0 && h % Math.floor(24 / claimsPerDay) === 0) {
      const open = tasks.find((t) => t.status === "open");
      if (open) open.status = "claimed";
    }
    usedToday += await runOnce(tasks, now, usedToday);
    const open = countOpenVisible(tasks, now + 1);
    if (h >= 24) {
      runs += 1;
      if (open >= REPLENISH_TARGET_OPEN) atTarget += 1;
      if (open < BOARD_MIN_OPEN) lows.push(`${new Date(now).toISOString()} open=${open}`);
    }
  }
  return { tasks, lows, atTarget, runs };
}

describe("STALL 2026-09-26: the pool holds the floor with the model off", () => {
  // Measured under this worst case: the pool holds at 2 permanent claims a day
  // and fails at 3. Above that, the model is the engine.
  it("with 2 favours claimed a day, the board never drops below the floor and sits at the target 95% of hours", async () => {
    const { lows, atTarget, runs } = await simulate(2);
    expect(lows.slice(0, 5), `${lows.length} hourly runs below the floor`).toEqual([]);
    expect(atTarget / runs).toBeGreaterThanOrEqual(0.95);
  });

  it("keeps the visible board at or above BOARD_MIN_OPEN for 60 days of hourly runs, after day 1", async () => {
    const tasks: Task[] = [];
    let usedToday = 0;
    let day = -1;
    const lows: string[] = [];
    for (let h = 0; h < 60 * 24; h++) {
      const now = START + h * HOUR;
      const d = Math.floor(h / 24);
      if (d !== day) {
        day = d;
        usedToday = 0;
      }
      usedToday += await runOnce(tasks, now, usedToday);
      const open = countOpenVisible(tasks, now + 1);
      if (h >= 24 && open < BOARD_MIN_OPEN) lows.push(`${new Date(now).toISOString()} open=${open}`);
    }
    expect(lows.slice(0, 5), `${lows.length} hourly runs below the floor`).toEqual([]);
  });

  it("never reposts a favour whose previous run was created in the last NO_REPEAT_DAYS", async () => {
    const tasks: Task[] = [];
    let usedToday = 0;
    for (let h = 0; h < 60 * 24; h++) {
      const now = START + h * HOUR;
      if (h % 24 === 0) usedToday = 0;
      usedToday += await runOnce(tasks, now, usedToday);
    }
    const byDesc = new Map<string, number[]>();
    for (const t of tasks) {
      const k = normaliseDescription(t.description);
      byDesc.set(k, [...(byDesc.get(k) ?? []), Date.parse(t.createdAt)]);
    }
    for (const [k, times] of byDesc) {
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1], k).toBeGreaterThanOrEqual(NO_REPEAT_DAYS * DAY);
      }
    }
  });

  it("the 25 Sep shape (the original 15 all blocked by the no-repeat rule, 1 still open) still yields a full run", async () => {
    const now = START + 40 * DAY;
    // 14 were posted 15 to 28 days ago: their 336 h deadline passed 1 to 14
    // days ago, so expire-tasks has expired them and recentDescriptions still
    // blocks them. 1 was posted 3 days ago and is still open. Status follows the
    // deadline, the way the expiry cron sets it.
    const tasks: Task[] = FALLBACK_FAVOURS.slice(0, 15).map((f, i) => {
      const t = taskFrom(f, now - (i === 0 ? 3 : 14 + i) * DAY);
      t.status = new Date(t.deadline).getTime() > now ? "open" : "expired";
      return t;
    });
    expect(tasks.filter((t) => t.status === "open").length).toBe(1);
    expect(recentDescriptions(tasks, now).length).toBe(15);
    const plan = planReplenish({ tasks, recycledRecently: new Set(), usedToday: 0, now, recycle: false });
    expect(plan.generateCount).toBe(6);
    const gen = await generateFavourSpecs(plan.generateCount, new Set(), { recent: recentDescriptions(tasks, now), allowModel: false });
    const chosen = balanceKinds(gen.specs, tasks.filter((t) => t.status === "open"), plan.generateCount);
    expect(chosen.length).toBe(6);
    const blocked = tasks.map((t) => t.description);
    for (const c of chosen) expect(isNearDuplicate(c.description, blocked), c.description).toBe(false);
  });

  it("every pool favour is valid, unique, and not a near-duplicate of another", () => {
    const seen: string[] = [];
    for (const f of FALLBACK_FAVOURS) {
      expect(validateFavourSpec(f), f.description).not.toBeNull();
      expect(isNearDuplicate(f.description, seen), f.description).toBe(false);
      seen.push(f.description);
    }
    // Enough to cover the day cap many times over.
    expect(FALLBACK_FAVOURS.length).toBeGreaterThanOrEqual(3 * REPLENISH_MAX_PER_DAY);
  });
});
