import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";

// THE TOP FAVOUR — the daily gate.
//
// You do ONE favour before you enter the marketplace. The entry fee is paid in
// contribution, not money — which is the thing FAVOUR could never solve, since
// nobody would pay money and everyone will pay one answer.
//
// The loop is three beats: GUESS what the world will say -> SUBMIT your own
// answer -> REVEAL. Results are locked until you have contributed, so the gate
// reads as unwrapping rather than as a toll.
//
// Rules (tests enforce them):
// - One submission per wallet per UTC day. Resubmission is rejected, not merged.
// - Results are NEVER returned to a caller who has not submitted today.
// - The gate blocks ACTING, never browsing (enforced at the call site).
// - Points only. This never touches USDC or escrow (invariant 1 stays untouched).
// - Every prompt must be answerable anywhere in ~30s (see PROMPTS).
export const DAILY_POINTS = 3;
export const DAILY_STREAK_BONUS = 2; // added at a 3-day streak and beyond
export const DAILY_GUESS_BONUS = 2; // for a close guess on a number prompt

export type DailyPromptType = "choice" | "number";

export type DailyPrompt = {
  date: string; // YYYY-MM-DD (UTC)
  question: string;
  type: DailyPromptType;
  options?: string[]; // choice only
  unit?: string; // number only, e.g. "EUR"
  hint?: string;
};

export type DailySubmission = {
  answer: string; // the contribution
  guess: string; // what they thought the world would say, captured BEFORE answer
  at: string;
};

export type DailyResults = {
  total: number;
  distribution: Record<string, number>; // choice: option -> count. number: bucket -> count
  median?: number; // number prompts only
  yourAnswer: string;
  yourGuess: string;
  guessWasClose: boolean;
  // "You vs the world" — the line that makes the reveal land.
  verdict: string;
  percentile?: number; // number prompts: share of the world you are above
};

// The prompt pool. HARD CONSTRAINT: every one of these must be answerable
// ANYWHERE, in about 30 seconds, with no shop/landmark/travel required. A
// location-dependent prompt ("the price of bread") is a great DATA prompt and a
// terrible GATE prompt — on a bus with no shop you would be locked out of your
// own app. Those belong in the weekly mission, not here.
export const PROMPTS: Omit<DailyPrompt, "date">[] = [
  { question: "How many people can you see right now?", type: "number", hint: "Look up. Best guess is fine." },
  { question: "What is the weather where you are?", type: "choice", options: ["Sun", "Cloud", "Rain", "Snow", "Dark"] },
  { question: "How did you get somewhere today?", type: "choice", options: ["Walked", "Drove", "Transit", "Cycled", "Stayed in"] },
  { question: "How many hours did you sleep?", type: "number", unit: "hours" },
  { question: "Is today better or worse than yesterday?", type: "choice", options: ["Better", "Same", "Worse"] },
  { question: "What is the last thing you drank?", type: "choice", options: ["Water", "Coffee", "Tea", "Something sweet", "Something strong"] },
  { question: "How many unread messages do you have?", type: "number" },
  { question: "Are you inside or outside?", type: "choice", options: ["Inside", "Outside"] },
  { question: "How far are you from home?", type: "choice", options: ["I'm home", "Minutes", "An hour", "Further", "Another country"] },
  { question: "How many times have you checked your phone this hour?", type: "number" },
  { question: "What woke you up today?", type: "choice", options: ["Alarm", "Light", "Noise", "A person", "Just woke"] },
  { question: "Rate today out of 10.", type: "number", hint: "0 is grim, 10 is the best day this year." },
  { question: "Are you wearing shoes?", type: "choice", options: ["Yes", "No"] },
  { question: "How many screens are on around you?", type: "number" },
];

const promptKey = (date: string) => `daily:prompt:${date}`;
const subsKey = (date: string) => `daily:sub:${date}`;
const streakKey = (address: string) => `daily:streak:${address}`;

export function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`).getTime() - 86400000;
  return new Date(d).toISOString().slice(0, 10);
}

// The prompt for a given day is deterministic: same day, same prompt, for
// everyone on earth. That is the whole point — the reveal is only interesting
// because every human answered the SAME question on the SAME day.
export function promptForDate(date: string): DailyPrompt {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return { ...PROMPTS[h % PROMPTS.length], date };
}

// An explicitly curated prompt (set by admin) wins over the deterministic pool,
// so a prompt can be authored for a day that deserves one.
export async function getPrompt(date: string): Promise<DailyPrompt> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(promptKey(date));
      if (raw) {
        const p = typeof raw === "string" ? JSON.parse(raw) : (raw as DailyPrompt);
        if (p?.question) return { ...p, date };
      }
    } catch {
      // A bad stored prompt must never take the gate down; fall through to the pool.
    }
  }
  return promptForDate(date);
}

export async function getSubmission(date: string, address: string): Promise<DailySubmission | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget(subsKey(date), address);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as DailySubmission);
}

export async function hasSubmitted(date: string, address: string): Promise<boolean> {
  return (await getSubmission(date, address)) !== null;
}

async function readAll(date: string): Promise<Record<string, DailySubmission>> {
  const redis = getRedis();
  if (!redis) return {};
  const all = (await redis.hgetall(subsKey(date))) || {};
  const out: Record<string, DailySubmission> = {};
  for (const [addr, raw] of Object.entries(all)) {
    try {
      out[addr] = typeof raw === "string" ? JSON.parse(raw) : (raw as DailySubmission);
    } catch {
      // Skip an unparseable row rather than failing the whole reveal.
    }
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// "You paid EUR1.20. World median EUR0.85. You are in the most expensive 12%."
// This line is the product. Without it the gate is just a toll.
function buildVerdict(
  prompt: DailyPrompt,
  mine: DailySubmission,
  all: DailySubmission[],
): { verdict: string; percentile?: number; median?: number } {
  if (prompt.type === "number") {
    const nums = all.map((s) => Number(s.answer)).filter((n) => Number.isFinite(n));
    if (!nums.length) return { verdict: "You are the first person on earth to answer today." };
    const med = median(nums);
    const mineNum = Number(mine.answer);
    const below = nums.filter((n) => n < mineNum).length;
    const percentile = Math.round((below / nums.length) * 100);
    const unit = prompt.unit ? ` ${prompt.unit}` : "";
    if (mineNum === med) {
      return { verdict: `You answered ${mineNum}${unit}. So did the world — you are exactly the median.`, percentile, median: med };
    }
    const dir = mineNum > med ? "above" : "below";
    const share = mineNum > med ? 100 - percentile : percentile;
    return {
      verdict: `You said ${mineNum}${unit}. The world says ${med}${unit}. You are ${dir} ${Math.max(1, 100 - share)}% of everyone who answered.`,
      percentile,
      median: med,
    };
  }

  const counts: Record<string, number> = {};
  for (const s of all) counts[s.answer] = (counts[s.answer] || 0) + 1;
  const total = all.length;
  const mineCount = counts[mine.answer] || 0;
  const share = total ? Math.round((mineCount / total) * 100) : 100;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (total === 1) return { verdict: "You are the first person on earth to answer today." };
  if (top && top[0] === mine.answer) {
    return { verdict: `"${mine.answer}" — you are with the majority. ${share}% of the world said the same.` };
  }
  return { verdict: `"${mine.answer}" — only ${share}% of the world agreed. Most said "${top?.[0]}".` };
}

function bucketed(prompt: DailyPrompt, all: DailySubmission[]): Record<string, number> {
  const counts: Record<string, number> = {};
  if (prompt.type === "choice") {
    for (const o of prompt.options || []) counts[o] = 0;
    for (const s of all) if (s.answer in counts) counts[s.answer] += 1;
    return counts;
  }
  for (const s of all) {
    const n = Number(s.answer);
    if (!Number.isFinite(n)) continue;
    const k = String(Math.round(n));
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function guessIsClose(prompt: DailyPrompt, guess: string, truth: number | string): boolean {
  if (prompt.type === "choice") return guess === truth;
  const g = Number(guess);
  const t = Number(truth);
  if (!Number.isFinite(g) || !Number.isFinite(t)) return false;
  // Within 20%, or within 1 for small numbers where a percentage is meaningless.
  return Math.abs(g - t) <= Math.max(1, Math.abs(t) * 0.2);
}

// THE REVEAL. Returns null when the caller has not contributed — the lock is
// enforced here, in the data layer, so no route can accidentally leak it.
export async function getResults(date: string, address: string): Promise<DailyResults | null> {
  const mine = await getSubmission(date, address);
  if (!mine) return null;

  const prompt = await getPrompt(date);
  const all = Object.values(await readAll(date));
  const { verdict, percentile, median: med } = buildVerdict(prompt, mine, all);

  let truth: number | string;
  if (prompt.type === "number") {
    truth = med ?? Number(mine.answer);
  } else {
    const counts = bucketed(prompt, all);
    truth = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? mine.answer;
  }

  return {
    total: all.length,
    distribution: bucketed(prompt, all),
    median: med,
    yourAnswer: mine.answer,
    yourGuess: mine.guess,
    guessWasClose: guessIsClose(prompt, mine.guess, truth),
    verdict,
    percentile,
  };
}

export async function getStreak(address: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const raw = await redis.get(streakKey(address));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function bumpStreak(address: string, date: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 1;
  const didYesterday = await hasSubmitted(previousDate(date), address);
  const next = didYesterday ? (await getStreak(address)) + 1 : 1;
  // 60 days of grace: a streak that has not been touched in two months is over.
  await redis.set(streakKey(address), String(next), { ex: 60 * 86400 }).catch(() => {});
  return next;
}

export type SubmitResult =
  | { ok: true; results: DailyResults; pointsAwarded: number; streak: number }
  | { ok: false; error: string };

// Submit today's answer. `guess` is what they thought the world would say and is
// captured BEFORE they see anything — it is the first beat of the loop and the
// reason the reveal has stakes.
export async function submitDaily(input: {
  date: string;
  address: string;
  answer: string;
  guess: string;
}): Promise<SubmitResult> {
  const { date, address } = input;
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Store unavailable" };

  const answer = String(input.answer ?? "").trim();
  const guess = String(input.guess ?? "").trim();
  if (!answer) return { ok: false, error: "Pick an answer first" };
  if (!guess) return { ok: false, error: "Guess what the world will say first" };

  const prompt = await getPrompt(date);
  if (prompt.type === "choice") {
    const opts = prompt.options || [];
    if (!opts.includes(answer)) return { ok: false, error: "That is not one of today's options" };
    if (!opts.includes(guess)) return { ok: false, error: "That is not one of today's options" };
  } else {
    if (!Number.isFinite(Number(answer))) return { ok: false, error: "Answer with a number" };
    if (!Number.isFinite(Number(guess))) return { ok: false, error: "Guess with a number" };
  }

  const submission: DailySubmission = { answer, guess, at: new Date().toISOString() };

  // One per human per day. hsetnx is the whole guarantee: two concurrent
  // submissions cannot both win, and a resubmission is rejected rather than
  // silently overwriting the first answer (which would let someone edit after
  // peeking at a friend's reveal).
  const won = await redis.hsetnx(subsKey(date), address, JSON.stringify(submission));
  if (!won) return { ok: false, error: "You have already done today's favour" };

  const streak = await bumpStreak(address, date);
  const results = await getResults(date, address);

  let pointsAwarded = DAILY_POINTS;
  if (streak >= 3) pointsAwarded += DAILY_STREAK_BONUS;
  if (results?.guessWasClose) pointsAwarded += DAILY_GUESS_BONUS;

  // Points are best-effort: a points failure must never cost someone the
  // submission they already made, or the gate would eat contributions.
  await awardPoints(address, "daily_favour", pointsAwarded).catch(() => {});

  return {
    ok: true,
    results: results as DailyResults,
    pointsAwarded,
    streak,
  };
}
