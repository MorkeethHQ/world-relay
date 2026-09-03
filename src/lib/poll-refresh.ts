import Anthropic from "@anthropic-ai/sdk";
import { getRedis } from "./redis";
import { createPoll, listPolls, type Poll } from "./polls-store";

// POLL SUPPLY ENGINE
//
// Why this file exists: until 2026-09-03 nothing on the server ever created a
// poll. Polls were user-generated only, `createPoll` defaults to a 72-hour
// window, and `Polls.tsx` splits the list into ACTIVE and ENDED. So the live
// polls tab held 12 polls of which ZERO were active — six of them about a World
// Cup that finished on Jul 19 — and the feed's poll rail (which filters to
// active) rendered nothing at all. The board rules govern which polls show; no
// rule governed whether any existed.
//
// Same safety posture as board-replenish and daily-generator: a deterministic
// pool is the floor, a model call is an UPGRADE, and every failure path lands on
// the pool. A poll surface must never starve on a model.

const MODEL = process.env.POLL_REFRESH_MODEL || "claude-sonnet-5";

// The floor the active poll list never sits below.
export const POLL_MIN_ACTIVE = 4;
// Per-run and per-day ceilings, so a bad day cannot flood the tab.
export const POLL_MAX_PER_RUN = 3;
export const POLL_MAX_PER_DAY = 6;
// Editorial polls run a week, not the 72-hour user default. A 3-day window on a
// board this quiet means a poll expires before most of the 471 registered users
// open the app again.
export const POLL_DURATION_HOURS = 168;
// Don't re-ask a question we asked recently, even after it has ended.
export const POLL_REASK_COOLDOWN_DAYS = 45;

const USED_KEY = (day: string) => `poll_refresh:used:${day}`;

export type PollSpec = { question: string; options: string[]; category: string };

// Evergreen and undateable ON PURPOSE. The World Cup polls are the cautionary
// tale: a topical poll is dead the day the tournament ends, and the tab had no
// other supply. Nothing here expires with a calendar.
export const FALLBACK_POLLS: PollSpec[] = [
  { question: "What actually gets you to open an app twice in one day?", options: ["Money", "A streak I don't want to break", "Curiosity", "A notification"], category: "general" },
  { question: "Someone offers you $5 for a five-minute favour. What's your answer?", options: ["Yes, easy", "Depends what it is", "Depends who's asking", "No, not worth it"], category: "general" },
  { question: "How far would you walk for a small favour?", options: ["Whatever's on my street", "Ten minutes", "Across town", "Not walking anywhere"], category: "general" },
  { question: "What's the most useless thing you own?", options: ["Cables for nothing", "Clothes I never wear", "A gadget I used once", "Nothing, I'm ruthless"], category: "general" },
  { question: "First thing you do when a stranger asks you for directions?", options: ["Help properly", "Point vaguely and go", "Pull out my phone for them", "Pretend not to hear"], category: "general" },
  { question: "What proves a photo is real to you?", options: ["Something in the background", "The lighting", "Nothing, I assume it's fake", "The person's face"], category: "general" },
  { question: "Which is worth more — 100 points or $1?", options: ["The dollar, obviously", "The points, I'm collecting", "Depends what points buy", "Neither is worth my time"], category: "general" },
  { question: "How do you decide a place is worth going to?", options: ["A friend said so", "Reviews online", "It looked busy", "I just walked in"], category: "general" },
  { question: "What's the last thing you did purely to help someone?", options: ["Today, something small", "This week", "Can't remember", "I do it constantly"], category: "general" },
  { question: "Honest answer — do you read app onboarding?", options: ["Never, skip it all", "Skim it", "Every word", "Only when I'm stuck"], category: "general" },
  { question: "You're paid to photograph one thing near you right now. What's easiest?", options: ["A shop front", "A price or menu", "The street", "Nothing near me is interesting"], category: "general" },
  { question: "What would make you trust a task board with your time?", options: ["Someone actually got paid", "Real reviews", "A big name behind it", "Nothing would"], category: "general" },
];

// ---------------------------------------------------------------------------
// PURE PLANNER
// ---------------------------------------------------------------------------

export function normaliseQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function activePolls(polls: Poll[], now: number = Date.now()): Poll[] {
  return polls.filter((p) => new Date(p.endsAt).getTime() > now);
}

export type PollRefreshPlan = { activeCount: number; deficit: number; createCount: number };

export function planPollRefresh(input: {
  polls: Poll[];
  usedToday: number;
  now?: number;
}): PollRefreshPlan {
  const now = input.now ?? Date.now();
  const activeCount = activePolls(input.polls, now).length;
  const deficit = Math.max(0, POLL_MIN_ACTIVE - activeCount);
  const createCount = Math.max(
    0,
    Math.min(deficit, POLL_MAX_PER_RUN, POLL_MAX_PER_DAY - input.usedToday),
  );
  return { activeCount, deficit, createCount };
}

// Questions we must not re-ask: every active poll, plus anything asked inside
// the cooldown window. Ended-and-cold questions become reusable, which is what
// keeps a 12-entry pool from running out.
export function avoidQuestions(polls: Poll[], now: number = Date.now()): Set<string> {
  const coldBefore = now - POLL_REASK_COOLDOWN_DAYS * 86_400_000;
  const out = new Set<string>();
  for (const p of polls) {
    const fresh = new Date(p.createdAt).getTime() >= coldBefore;
    const active = new Date(p.endsAt).getTime() > now;
    if (fresh || active) out.add(normaliseQuestion(p.question));
  }
  return out;
}

export function validatePollSpec(raw: unknown): PollSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const question = typeof p.question === "string" ? p.question.trim() : "";
  if (question.length < 10 || question.length > 120) return null;
  if (!Array.isArray(p.options)) return null;
  const options = p.options
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim())
    .filter((o) => o.length > 0 && o.length <= 44);
  // 2-4 options, all distinct. A duplicated option splits a tally between two
  // identical rows, the same collision the football cron guards against.
  if (options.length < 2 || options.length > 4) return null;
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return null;
  const category = typeof p.category === "string" && p.category.trim() ? p.category.trim().slice(0, 24) : "general";
  return { question, options, category };
}

// ---------------------------------------------------------------------------
// GENERATION — pool is the floor, model is the upgrade
// ---------------------------------------------------------------------------

export async function generatePollSpecs(
  count: number,
  avoid: Set<string>,
): Promise<{ specs: PollSpec[]; generated: number; reason?: string }> {
  const fromPool = (n: number, taken: Set<string>): PollSpec[] => {
    const picked: PollSpec[] = [];
    for (const p of FALLBACK_POLLS) {
      if (picked.length >= n) break;
      const key = normaliseQuestion(p.question);
      if (avoid.has(key) || taken.has(key)) continue;
      taken.add(key);
      picked.push(p);
    }
    return picked;
  };

  if (count <= 0) return { specs: [], generated: 0 };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { specs: fromPool(count, new Set()), generated: 0, reason: "no ANTHROPIC_API_KEY" };

  const system = `You write POLLS for FAVOUR, a task board inside World App where every user is a verified human. A poll is one question with 2-4 short options that anyone anywhere can answer in five seconds with no research.

HARD RULES:
- EVERGREEN. Never reference a date, a season, a tournament, an election, a news event, or anything that stops being true. A poll about the World Cup is dead the day the final ends.
- Answerable by anyone on earth. No local knowledge, no prices, no currencies, no buying anything.
- Options are 1-5 words each, mutually exclusive, and none of them is the obviously "correct" or virtuous answer.
- Direct and a little provocative. No emoji, no hashtags, no "which of these".
- The interesting ones are about habits, trust, effort, money-vs-time and what people actually do — not opinions about FAVOUR itself.

Return ONLY a JSON array, no preamble, no code fence. Each element:
{"question": "...", "options": ["...", "..."], "category": "general"}`;

  const user = `Write ${count} polls. Do NOT reuse or lightly reword any of these:\n${[...avoid]
    .slice(0, 60)
    .map((q) => `- ${q}`)
    .join("\n")}`;

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
      return { specs: fromPool(count, new Set()), generated: 0, reason: "no JSON array in response" };
    }
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const specs: PollSpec[] = [];
    const taken = new Set<string>();
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        if (specs.length >= count) break;
        const spec = validatePollSpec(raw);
        if (!spec) continue;
        const k = normaliseQuestion(spec.question);
        if (avoid.has(k) || taken.has(k)) continue;
        taken.add(k);
        specs.push(spec);
      }
    }
    const generated = specs.length;
    if (specs.length < count) specs.push(...fromPool(count - specs.length, taken));
    return { specs, generated, reason: generated < count ? "model output partially rejected, pool topped up" : undefined };
  } catch (err) {
    return { specs: fromPool(count, new Set()), generated: 0, reason: `generation failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// EXECUTOR
// ---------------------------------------------------------------------------

export type PollRefreshReceipt = {
  ok: true;
  activeCount: number;
  deficit: number;
  usedToday: number;
  created: { id: string; question: string }[];
  generatedByModel: number;
  reason?: string;
};

export async function runPollRefresh(now: number = Date.now()): Promise<PollRefreshReceipt> {
  const redis = getRedis();
  const day = new Date(now).toISOString().slice(0, 10);
  const usedToday = redis ? Number((await redis.get(USED_KEY(day))) ?? 0) : 0;

  const polls = await listPolls();
  const plan = planPollRefresh({ polls, usedToday, now });

  if (plan.createCount === 0) {
    return { ok: true, activeCount: plan.activeCount, deficit: plan.deficit, usedToday, created: [], generatedByModel: 0, reason: "at or above the floor" };
  }

  const { specs, generated, reason } = await generatePollSpecs(plan.createCount, avoidQuestions(polls, now));

  const created: { id: string; question: string }[] = [];
  for (const spec of specs) {
    try {
      const poll = await createPoll({
        question: spec.question,
        options: spec.options,
        // Editorial authorship, same convention as predictions. Poll creation
        // through /api/polls requires a wallet; this path is server-side only.
        creator: "favour",
        category: spec.category,
        durationHours: POLL_DURATION_HOURS,
      });
      created.push({ id: poll.id, question: poll.question });
    } catch {
      // One failed write must never abort the run — the remaining specs are
      // still worth creating.
      continue;
    }
  }

  if (redis && created.length > 0) {
    await redis.set(USED_KEY(day), usedToday + created.length, { ex: 172_800 });
  }

  return { ok: true, activeCount: plan.activeCount, deficit: plan.deficit, usedToday, created, generatedByModel: generated, reason };
}
