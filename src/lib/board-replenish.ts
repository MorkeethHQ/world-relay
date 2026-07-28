import Anthropic from "@anthropic-ai/sdk";
import type { Task, TaskCategory } from "./types";
import { getRedis } from "./redis";
import { createTask, listTasks } from "./store";
import { isFunded } from "./reward";
import { MAX_TASK_POINTS } from "./proof-of-favour";
import { getAgent } from "./agents";
import { trackEvent } from "./track";

// BOARD REPLENISH ENGINE — the supply side of the board.
//
// The death spiral this closes (measured 2026-07-28): 121 tasks total, 2 open,
// 31 (26%) expired with nobody completing them. expire-tasks runs every day and
// only ever REMOVES supply; nothing on the server ever ADDS it. Seeding was a
// human pasting season JSONs — when the human stops, the board starves, the
// empty board churns the exact users the cap-hit redirect (cd963d0) just saved,
// and fewer users means fewer user-posted favours: a one-way ratchet to zero.
//
// THE MONEY RULE THAT SHAPES THIS FILE: this engine mints POINTS FAVOURS ONLY.
// It must be impossible for any path through this code to create a task that
// promises or touches USDC — no onChainId, no escrowTxHash, no rewardType
// "usdc", bounty clamped to the points ceiling. Money favours stay human-funded
// and escrow-bound (SECURITY-INVARIANTS.md); an autonomous generator writing
// money claims would be minting unfunded promises. Enforced by construction
// here and by guard tests in board-replenish.test.ts.
//
// Supply comes from two sources, cheapest truth first:
//   1. RECYCLE — expired, seeded, points-only favours that nobody ever claimed
//      get a fresh run. The work was already curated once; expiry on a starved
//      board says "nobody saw it", not "nobody wanted it".
//   2. GENERATE — the daily-quest generator pattern (lib/daily-generator):
//      one cheap model call, structural validation, and a deterministic
//      fallback pool so the board refills even with no API key and a model
//      that is down. A generated favour is an UPGRADE, never a dependency.

export const BOARD_MIN_OPEN = 8;
export const REPLENISH_MAX_PER_RUN = 6;
export const REPLENISH_MAX_PER_DAY = 12;
export const RECYCLE_COOLDOWN_DAYS = 7;
export const RECYCLE_WINDOW_DAYS = 30;

const MODEL = process.env.BOARD_REPLENISH_MODEL || process.env.DAILY_PROMPT_MODEL || "claude-sonnet-5";
const USED_KEY_PREFIX = "replenish:used:";
const RECYCLED_KEY_PREFIX = "replenish:recycled:";

// A points favour spec — everything the engine is allowed to decide.
// Note what is NOT here: any money field. That absence is the invariant.
export type FavourSpec = {
  description: string;
  category: TaskCategory;
  points: number; // becomes bountyUsdc on a points task; the payout IS this number (clamped)
  deadlineHours: number;
  maxCompletions: number;
  agentId: string;
  location: string;
};

const ALLOWED_CATEGORIES: ReadonlySet<TaskCategory> = new Set([
  "photo",
  "check-in",
  "custom",
  "social",
  "review",
] as TaskCategory[]);

// Words that have no business in a POINTS favour. A generated description that
// mentions money is either promising a payout this engine cannot fund, or
// asking the user to spend — both are banned outright, not cleaned up.
const MONEY_BANNED = /\$|usd|usdc|dollar|money|cash|pay(?:ment|out)?s?\b|bount(?:y|ies)|crypto|token|wallet|invest|deposit|withdraw|purchase|buy\b/i;

export function normaliseDescription(d: string): string {
  return d.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export function validateFavourSpec(raw: unknown): FavourSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  const description = typeof s.description === "string" ? s.description.trim() : "";
  if (description.length < 20 || description.length > 160) return null;
  if (MONEY_BANNED.test(description)) return null;

  const category = typeof s.category === "string" ? (s.category as TaskCategory) : null;
  if (!category || !ALLOWED_CATEGORIES.has(category)) return null;

  const points = typeof s.points === "number" && Number.isFinite(s.points) ? Math.round(s.points) : NaN;
  if (!Number.isInteger(points) || points < 1 || points > MAX_TASK_POINTS) return null;

  const deadlineHours =
    typeof s.deadlineHours === "number" && Number.isFinite(s.deadlineHours) ? Math.round(s.deadlineHours) : NaN;
  if (!Number.isInteger(deadlineHours) || deadlineHours < 24 || deadlineHours > 336) return null;

  const maxCompletions =
    typeof s.maxCompletions === "number" && Number.isFinite(s.maxCompletions) ? Math.round(s.maxCompletions) : NaN;
  if (!Number.isInteger(maxCompletions) || maxCompletions < 1 || maxCompletions > 100) return null;

  const agentId = typeof s.agentId === "string" ? s.agentId.trim() : "";
  if (!agentId || !getAgent(agentId)) return null;

  const location = typeof s.location === "string" && s.location.trim() ? s.location.trim().slice(0, 40) : "Anywhere";

  return { description, category, points, deadlineHours, maxCompletions, agentId, location };
}

// The deterministic floor. Every entry MUST pass validateFavourSpec (guard
// test enforces it) — the fallback is the one path that cannot be allowed to
// fail validation, because it runs precisely when everything else already has.
export const FALLBACK_FAVOURS: FavourSpec[] = [
  { description: "Photo the most interesting thing within 50 steps of where you are right now, and say why it caught your eye.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 50, agentId: "dropscout", location: "Anywhere" },
  { description: "Do a small favour for someone near you today — no spending, just help — and tell us what you did.", category: "custom", points: 20, deadlineHours: 168, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Photo the view from the nearest window and tell us one thing about it a map could never know.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 50, agentId: "freshmap", location: "Anywhere" },
  { description: "Show us what people are queuing for where you live — photo the line and guess the wait.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 50, agentId: "queuepulse", location: "Any city" },
  { description: "Photo a hand-written sign near you and translate or explain it for the rest of the world.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 50, agentId: "openclaw", location: "Anywhere" },
  { description: "Recommend one spot in your area that visitors always miss, with a photo and one line on why locals love it.", category: "review", points: 20, deadlineHours: 168, maxCompletions: 50, agentId: "freshmap", location: "Any city" },
  { description: "Photo the oldest object you can find around you right now and guess its age.", category: "photo", points: 10, deadlineHours: 168, maxCompletions: 50, agentId: "dropscout", location: "Anywhere" },
  { description: "Teach the world one useful phrase in your language — write it, say where it helps, photo where you are.", category: "social", points: 15, deadlineHours: 168, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "Check in from wherever you are: one photo, one line on what everyone around you is doing right now.", category: "check-in", points: 10, deadlineHours: 168, maxCompletions: 100, agentId: "queuepulse", location: "Anywhere" },
  { description: "Photo the best street art, mural, or unexpected colour you can reach on foot in five minutes.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 50, agentId: "dropscout", location: "Any city" },
  { description: "Show us breakfast where you live — photo what a normal morning actually looks like, no staging.", category: "photo", points: 15, deadlineHours: 168, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Photo a notice board, poster wall, or shop window near you — what is your neighbourhood talking about?", category: "photo", points: 10, deadlineHours: 168, maxCompletions: 50, agentId: "freshmap", location: "Any city" },
];

// ---------------------------------------------------------------------------
// PURE PLANNER — all the decisions, none of the IO. Unit-testable without a
// store; runReplenish below is a thin executor around it.
// ---------------------------------------------------------------------------

export function countOpenVisible(tasks: Task[], now: number = Date.now()): number {
  return tasks.filter(
    (t) =>
      t.status === "open" &&
      new Date(t.deadline).getTime() > now &&
      (t.rewardType === "points" || isFunded(t)),
  ).length;
}

// Only a task that is ALL of: expired, seeded, points-only, never claimed,
// never completed, and recently dead is worth a second run. Anything funded is
// excluded twice over (rewardType and escrow fields) — recycling an escrow
// reference would resurrect a claim on money that was already refunded.
export function recycleCandidates(tasks: Task[], now: number = Date.now()): Task[] {
  const windowStart = now - RECYCLE_WINDOW_DAYS * 86_400_000;
  return tasks
    .filter(
      (t) =>
        t.status === "expired" &&
        t.rewardType === "points" &&
        !isFunded(t) &&
        t.donOnChainId === null &&
        !t.claimant &&
        t.completionCount === 0 &&
        (!!t.agent || t.poster.startsWith("agent:")) &&
        new Date(t.deadline).getTime() >= windowStart,
    )
    .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime());
}

export type ReplenishPlan = {
  deficit: number;
  budget: number;
  recycle: Task[];
  generateCount: number;
};

export function planReplenish(input: {
  tasks: Task[];
  recycledRecently: Set<string>; // normalised descriptions on cooldown
  usedToday: number;
  now?: number;
}): ReplenishPlan {
  const now = input.now ?? Date.now();
  const openVisible = countOpenVisible(input.tasks, now);
  const deficit = Math.max(0, BOARD_MIN_OPEN - openVisible);
  const budget = Math.max(0, Math.min(deficit, REPLENISH_MAX_PER_RUN, REPLENISH_MAX_PER_DAY - input.usedToday));
  if (budget === 0) return { deficit, budget, recycle: [], generateCount: 0 };

  const openDescs = new Set(
    input.tasks.filter((t) => t.status === "open").map((t) => normaliseDescription(t.description)),
  );

  const recycle: Task[] = [];
  const chosen = new Set<string>();
  for (const t of recycleCandidates(input.tasks, now)) {
    if (recycle.length >= budget) break;
    const key = normaliseDescription(t.description);
    if (openDescs.has(key) || input.recycledRecently.has(key) || chosen.has(key)) continue;
    chosen.add(key);
    recycle.push(t);
  }

  return { deficit, budget, recycle, generateCount: budget - recycle.length };
}

// ---------------------------------------------------------------------------
// GENERATION — one call, an array out, every element through the validator,
// the pool topping up whatever the model got wrong. Same safety posture as
// lib/daily-generator: junk in, pool out, board never starves on a model.
// ---------------------------------------------------------------------------

export async function generateFavourSpecs(
  count: number,
  avoidDescriptions: Set<string>,
): Promise<{ specs: FavourSpec[]; generated: number; reason?: string }> {
  const fromPool = (n: number, taken: Set<string>): FavourSpec[] => {
    const picked: FavourSpec[] = [];
    for (const f of FALLBACK_FAVOURS) {
      if (picked.length >= n) break;
      const key = normaliseDescription(f.description);
      if (avoidDescriptions.has(key) || taken.has(key)) continue;
      taken.add(key);
      picked.push(f);
    }
    return picked;
  };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const taken = new Set<string>();
    return { specs: fromPool(count, taken), generated: 0, reason: "no ANTHROPIC_API_KEY" };
  }

  const agentBriefs = ["dropscout", "freshmap", "queuepulse", "openclaw", "hermes"]
    .map((id) => {
      const a = getAgent(id);
      return a ? `- ${id}: ${a.personality ?? a.name}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const system = `You write POINTS favours for FAVOUR, a task board inside World App where every user is a verified human.

A favour is a small real-world task a person completes with a photo as proof. These are POINTS favours: the reward is app points, never money. HARD RULES:
- Doable ANYWHERE on earth, by anyone, within a few minutes, spending nothing.
- Verifiable from a single photo plus a short note.
- Never mention money, prices, currencies, payment, or buying anything.
- Nothing sensitive, dangerous, or that requires talking to strangers about the app.
- Warm, direct, specific. No emoji. One or two sentences.

Each favour is posted by one of these agents (pick the best fit):
${agentBriefs}

Return ONLY a JSON array, no preamble, no code fence. Each element:
{"description": "...", "category": "photo"|"check-in"|"custom"|"social"|"review", "points": 10-${MAX_TASK_POINTS}, "deadlineHours": 24-336, "maxCompletions": 1-100, "agentId": "...", "location": "Anywhere"|"Any city"}`;

  const user = `Write ${count} favours. Do NOT reuse or lightly reword any of these:\n${[...avoidDescriptions]
    .slice(0, 60)
    .map((d) => `- ${d}`)
    .join("\n")}`;

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
      const taken = new Set<string>();
      return { specs: fromPool(count, taken), generated: 0, reason: "no JSON array in response" };
    }

    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const specs: FavourSpec[] = [];
    const taken = new Set<string>();
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        if (specs.length >= count) break;
        const spec = validateFavourSpec(raw);
        if (!spec) continue;
        const k = normaliseDescription(spec.description);
        if (avoidDescriptions.has(k) || taken.has(k)) continue;
        taken.add(k);
        specs.push(spec);
      }
    }
    const generated = specs.length;
    if (specs.length < count) specs.push(...fromPool(count - specs.length, taken));
    return { specs, generated, reason: generated < count ? "model output partially rejected, pool topped up" : undefined };
  } catch (err) {
    const taken = new Set<string>();
    return { specs: fromPool(count, taken), generated: 0, reason: `generation failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// EXECUTOR
// ---------------------------------------------------------------------------

export type ReplenishReceipt = {
  ok: true;
  openVisible: number;
  deficit: number;
  usedToday: number;
  recycled: string[]; // new task ids created from recycled favours
  generated: string[]; // new task ids created from generated/pool specs
  generatedByModel: number;
  reason?: string;
};

function dayBucket(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function runReplenish(now: number = Date.now()): Promise<ReplenishReceipt> {
  const redis = getRedis();
  const tasks = await listTasks();
  const openVisible = countOpenVisible(tasks, now);

  const usedKey = `${USED_KEY_PREFIX}${dayBucket(now)}`;
  const usedToday = redis ? Number((await redis.get(usedKey)) || 0) : 0;

  // Cooldown set: which normalised descriptions were recycled recently.
  const recycledRecently = new Set<string>();
  if (redis) {
    // Cooldown keys are per-description; membership is checked lazily below via
    // MGET-free single gets to keep this dependency-light on the mock store.
    for (const t of recycleCandidates(tasks, now)) {
      const k = normaliseDescription(t.description);
      if (await redis.get(`${RECYCLED_KEY_PREFIX}${k}`)) recycledRecently.add(k);
    }
  }

  const plan = planReplenish({ tasks, recycledRecently, usedToday, now });
  if (plan.budget === 0) {
    return {
      ok: true,
      openVisible,
      deficit: plan.deficit,
      usedToday,
      recycled: [],
      generated: [],
      generatedByModel: 0,
      reason: plan.deficit === 0 ? "board at or above floor" : "daily replenish cap reached",
    };
  }

  const recycledIds: string[] = [];
  for (const old of plan.recycle) {
    // A fresh task, not a resurrection: new id, new deadline, clean proof state.
    // POINTS-ONLY BY CONSTRUCTION: no onChainId, no escrowTxHash, rewardType
    // pinned to "points", bounty clamped into the points range.
    const created = await createTask({
      poster: old.poster,
      category: old.category,
      description: old.description,
      location: old.location,
      lat: old.lat,
      lng: old.lng,
      bountyUsdc: Math.min(Math.max(Math.round(old.bountyUsdc) || 1, 1), MAX_TASK_POINTS),
      deadlineHours: 168,
      agentId: old.agent?.id || null,
      rewardType: "points",
      maxCompletions: Math.min(Math.max(old.maxCompletions, 1), 100),
    });
    recycledIds.push(created.id);
    if (redis) {
      await redis.set(`${RECYCLED_KEY_PREFIX}${normaliseDescription(old.description)}`, "1", {
        ex: RECYCLE_COOLDOWN_DAYS * 86_400,
      });
    }
  }

  const generatedIds: string[] = [];
  let generatedByModel = 0;
  let reason: string | undefined;
  if (plan.generateCount > 0) {
    const avoid = new Set<string>([
      ...tasks.filter((t) => t.status === "open").map((t) => normaliseDescription(t.description)),
      ...plan.recycle.map((t) => normaliseDescription(t.description)),
    ]);
    const gen = await generateFavourSpecs(plan.generateCount, avoid);
    generatedByModel = gen.generated;
    reason = gen.reason;
    for (const spec of gen.specs) {
      const created = await createTask({
        poster: `agent:${spec.agentId}`,
        category: spec.category,
        description: spec.description,
        location: spec.location,
        bountyUsdc: spec.points,
        deadlineHours: spec.deadlineHours,
        agentId: spec.agentId,
        rewardType: "points",
        maxCompletions: spec.maxCompletions,
      });
      generatedIds.push(created.id);
    }
  }

  const createdCount = recycledIds.length + generatedIds.length;
  if (redis && createdCount > 0) {
    await redis.incrby(usedKey, createdCount);
    await redis.expire(usedKey, 2 * 86_400);
  }

  trackEvent("board_replenished", {
    openBefore: openVisible,
    recycled: recycledIds.length,
    generated: generatedIds.length,
    fromModel: generatedByModel,
  }).catch(() => {});

  return {
    ok: true,
    openVisible,
    deficit: plan.deficit,
    usedToday: usedToday + createdCount,
    recycled: recycledIds,
    generated: generatedIds,
    generatedByModel,
    ...(reason ? { reason } : {}),
  };
}
