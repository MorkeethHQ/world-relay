import Anthropic from "@anthropic-ai/sdk";
import type { Task, TaskCategory } from "./types";
import { getRedis } from "./redis";
import { createTask, listTasks } from "./store";
import { isFunded } from "./reward";
import { isCompanyPiece } from "./board-rank";
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

// R6 as amended 2026-09-16. This is no longer a floor the machine maintains.
// It is the line below which the board needs a HUMAN to post. See BOARD-RULES.md
// R6 and `isBoardBelowFloor` below.
export const BOARD_MIN_OPEN = 8;

// The replenish engine is OFF unless this is explicitly "true".
//
// Ruling 2026-09-16, Oscar: "Favour has a lot of stale boring items still".
// Measured that day: 24 of the 25 open favours shared a single timestamp from
// one replenish run twelve days earlier, none was at a real place, and
// agent-posted tasks had produced 19 completions across 74 tasks against 460
// across 105 human ones.
//
// The default is OFF and that direction matters. SESSION_ENFORCE in session.ts
// uses the same env-switch shape but defaults to the PERMISSIVE side, which is
// why an identity invariant has been dormant in production for months. Here the
// default is the safe side: a deploy that forgets the variable does not post.
export function replenishEnabled(): boolean {
  return process.env.BOARD_REPLENISH_ENABLED === "true";
}

// The floor as a signal rather than a promise. With the engine off, nothing
// automatic satisfies BOARD_MIN_OPEN, so the honest reading is "a person should
// post something", not "the system is broken".
export function isBoardBelowFloor(tasks: Task[], now: number = Date.now()): boolean {
  return countOpenVisible(tasks, now) < BOARD_MIN_OPEN;
}
// RE-ENABLED WITH A QUALITY GATE, 2026-09-21. Oscar: "right now we just REFRESH the
// favours once again, we need to have infinite ones." That supersedes the 16 Sep
// kill, but the reason for the kill still stands (one run posted 24 of 25 open
// favours, stale and samey), so the engine comes back with the fixes for exactly
// that:
//   - a TARGET of about 15 open favours, topped up hourly by cron;
//   - no ask reposted if it, or a near-duplicate, was on the board in the last 14
//     days, whatever happened to it (NO_REPEAT_DAYS, isNearDuplicate);
//   - kinds rotate: no single category takes more than half of a run, and the
//     categories thinnest on the board come first (balanceKinds);
//   - model calls are capped per day, because each one is spend on the key.
// Everything that made it safe before still holds: points only, named agents,
// no money field anywhere, seeded caps and one pass per person unchanged.
export const REPLENISH_TARGET_OPEN = 15;
export const REPLENISH_MAX_PER_RUN = 6;
export const REPLENISH_MAX_PER_DAY = 20;
export const RECYCLE_COOLDOWN_DAYS = 14;
export const NO_REPEAT_DAYS = 14;
export const NEAR_DUP_THRESHOLD = 0.6;
export const MODEL_CALLS_PER_DAY = 6;
// R8 — recycle can never take the whole run. Recycling is cheaper than
// generating, so a recycle-first planner with an unbounded share picks recycle
// every time: the board always has expired points favours, so generateCount was
// structurally ~0 and the SAME ten fallback descriptions rotated on and off the
// board from Jul 30 to Sep 3 (verified live: all 8 open favours on 2026-09-03
// were FALLBACK_FAVOURS entries). At most half of each run may be recycled, so
// fresh supply reaches the board on every single run, not just when the recycle
// pool happens to run dry.
// RECYCLING OFF, 2026-09-21. The first run after re-enabling recycled two old agent
// ERRANDS ("Look for any pop-up stall...", "Find a public water fountain...") of the
// exact "go and find" shape the Sep 3 pool rewrite retired and the Sep 16 ruling
// called stale. The recycle backlog is, by construction, the old supply, so it is not
// a source of fresh favours. Fresh supply is the model and the curated pool only.
export const RECYCLE_ENABLED = false;
export const RECYCLE_MAX_SHARE = 0.5;
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
  // "feedback" added 2026-09-03. It was excluded, and it is the single
  // best-performing category on the board by a wide margin: measured all-time,
  // completions per task posted were feedback 10.17, social 2.46, review 1.13,
  // custom 0.92, check-in 0.40, photo 0.32. The engine that refills the board
  // was structurally forbidden from making the thing people actually do.
  // Its board SHARE stays governed by BOARD-RULES R1 (max 3 of the first 15),
  // which is the rule that should cap it — not a silent absence from this set.
  "feedback",
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

// NEAR-DUPLICATES. An exact-match check let a lightly reworded ask back on the board
// ("What is one thing people in your country do..." vs "...that the rest of the
// world should copy"). Compared on the content words (4+ letters, common words
// dropped) by Jaccard overlap: at or above NEAR_DUP_THRESHOLD, it is the same ask.
const STOP = new Set(["what","that","this","with","from","your","have","where","when","which","there","they","their","them","would","could","should","about","right","today","just","into","than","then","only","every","some","more","most","one","the","and","for","are","you"]);
function contentWords(d: string): Set<string> {
  return new Set(normaliseDescription(d).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
}
export function similarity(a: string, b: string): number {
  const A = contentWords(a), B = contentWords(b);
  if (A.size === 0 || B.size === 0) return normaliseDescription(a) === normaliseDescription(b) ? 1 : 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
export function isNearDuplicate(d: string, against: Iterable<string>): boolean {
  const n = normaliseDescription(d);
  for (const other of against) {
    if (normaliseDescription(other) === n) return true;
    if (similarity(d, other) >= NEAR_DUP_THRESHOLD) return true;
  }
  return false;
}

// Every ask that was on the board in the last NO_REPEAT_DAYS, in any state: still
// open, completed, expired, cancelled. "Was open" is read as "was created or is
// still open" within the window. Raw descriptions, for isNearDuplicate.
export function recentDescriptions(tasks: Task[], now: number = Date.now()): string[] {
  const since = now - NO_REPEAT_DAYS * 86_400_000;
  return tasks
    .filter((t) => t.status === "open" || new Date(t.createdAt).getTime() >= since || new Date(t.deadline).getTime() >= since)
    .map((t) => t.description);
}

// KIND ROTATION. At most half of a run may share a category, and categories that
// are thinnest on the open board go first, so a run cannot fill the board with one
// shape of ask (the 16 Sep failure was 24 near-identical favours).
export function balanceKinds(specs: FavourSpec[], openTasks: Task[], count: number): FavourSpec[] {
  const onBoard = new Map<string, number>();
  for (const t of openTasks) onBoard.set(t.category, (onBoard.get(t.category) ?? 0) + 1);
  const perKindCap = Math.max(1, Math.ceil(count / 2));
  const sorted = [...specs].sort((a, b) => (onBoard.get(a.category) ?? 0) - (onBoard.get(b.category) ?? 0));
  const taken = new Map<string, number>();
  const out: FavourSpec[] = [];
  for (const s of sorted) {
    if (out.length >= count) break;
    const n = taken.get(s.category) ?? 0;
    if (n >= perKindCap) continue;
    taken.set(s.category, n + 1);
    out.push(s);
  }
  // Rotation is a preference, not a reason to leave the board short: if the
  // candidates cannot fill the run within the per-kind cap, the rest fill it.
  for (const s of sorted) {
    if (out.length >= count) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
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
  // Rewritten 2026-09-03 from production completion rates. The old pool was ten
  // photo ERRANDS ("photograph a laundromat's posted hours") and drew 0.32
  // completions per task; every one of the ten most-completed favours in the
  // app's history was a text ask, and text proofs pass AI verification 42/42
  // while photo proofs are flagged 44% of the time. The winning shape is not
  // "fun vs boring", it is ASK FOR A VIEW, NOT AN ERRAND — say something from
  // where you are sitting, in one sentence, that is worth reading afterwards.
  // The best performer of all time ("What would you ask a verified human to do
  // that you'd never ask a stranger") drew 42 completions at ZERO points, so
  // the reward is not what moves people. The question is.
  { description: "What would you ask a verified human nearby to do, that you would never ask a stranger? One honest sentence.", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "What is the most useless thing you own, and why do you still have it?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Tell us one thing about where you live that outsiders always get wrong.", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "What is the last thing you did purely to help someone, with nothing in it for you?", category: "custom", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Recommend one place near you that visitors always miss, and say in one line why locals go.", category: "review", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Any city" },
  { description: "What is something everyone where you live knows, that no website would ever tell you?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "An AI can read everything ever written and still cannot answer this: what does today smell like where you are?", category: "custom", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "What is the smallest thing that made your day better today? Be specific, not inspirational.", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "Settle it for the rest of us: what is the correct thing to do when a stranger asks you for directions?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Post in your own words what you would tell a friend who has never used FAVOUR, and paste the link in your note.", category: "social", points: 25, deadlineHours: 336, maxCompletions: 50, agentId: "hermes", location: "Anywhere" },
  { description: "What is one thing people in your country do that you think the rest of the world should copy?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "Describe a favour you genuinely need done this week. Real needs only — we read every one.", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  // A few SHOW-ME photo asks, deliberately kept: the peer jury runs on images,
  // and a flagged photo is no longer a dead end now that lib/jury-appeal.ts
  // gives a human quorum the final call. "Show me yours" from where you already
  // are, never "go and find".
  { description: "Show us the view from wherever you are sitting right now, exactly as it is. No tidying up first.", category: "photo", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Show us the most-used object within arm's reach, and say how you can tell it is the most used.", category: "photo", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "Show us something near you that is broken but still used every day, and say who puts up with it.", category: "photo", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  // Extended 2026-09-26. A 336 h favour stays blocked for about 28 days, so the
  // original fifteen cannot hold the floor once the model is down. Same shape:
  // a view from where you already are, in one or two honest sentences.
  { description: "Which kitchen sound tells you the evening has actually begun?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Name the habit you keep defending even when nobody else gets it.", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "What colour is the sky doing beyond your window this minute?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "If the room went suddenly quiet, which song would you put on?", category: "feedback", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "How did your morning coffee taste before it cooled off?", category: "feedback", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Who in your household laughs soonest when plans start to wobble?", category: "feedback", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Which item on your desk has stayed untouched since yesterday?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "How is the weather looking from your chair, without standing up?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "What small ritual starts your work even on a slow afternoon?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "Which corner of your home catches the kindest daylight?", category: "feedback", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "What did you almost say aloud and then decide to swallow instead?", category: "feedback", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Which supper would you happily eat again tomorrow night?", category: "feedback", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "What is the nicest message you received and left unanswered?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "How loud is your street at this hour, in one plain word?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Any city" },
  { description: "What plant, cup, or scrap of paper sits closest to your elbow?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Which childhood game do you remember every single rule of?", category: "feedback", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "What tune keeps looping inside your head at this moment?", category: "feedback", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "Share a local custom guests find charming and residents find tiring.", category: "feedback", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Any city" },
  { description: "At which hour is your whole building usually calmest?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Any city" },
  { description: "What fabric are you wearing, and why did you choose that particular layer?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Which book or short clip had you snorting sometime lately?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "What scent greets you once the front door swings open?", category: "feedback", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Any city" },
  { description: "Share one firm opinion your city would gladly argue against.", category: "feedback", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Any city" },
  { description: "What tiny repair indoors have you been quietly postponing?", category: "feedback", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "How many mugs sit in the sink, and whose mug looks oldest?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "What is the softest surface you can reach without getting up?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Which neighbour's cooking drifts down the hallway toward your seat?", category: "feedback", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Any city" },
  { description: "What joke lands reliably with the folks you eat beside?", category: "feedback", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "Paint the light around you in three blunt words, nothing pretty.", category: "feedback", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "What was that recent text really asking you for, underneath?", category: "feedback", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Which shoes by the entrance have clearly walked the most miles?", category: "feedback", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Any city" },
  { description: "What outdoor noise would you grieve if it vanished tonight?", category: "feedback", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "Quote whatever your kettle just produced, hiss and all.", category: "custom", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "What is glowing on your screen that you keep pretending not to notice?", category: "custom", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "Finish this from your seat: my favourite perch is right beside what?", category: "custom", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "What arrives in your ears when you shut both eyes for five seconds?", category: "custom", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "Which belonging would you grab if the lights blinked out tonight?", category: "custom", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "How is the ceiling above you appearing from your current slouch?", category: "custom", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Anywhere" },
  { description: "What peculiar fact do you know about the stairwell in your block?", category: "custom", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Any city" },
  { description: "Say how the breeze feels against your cheek, skipping any poetry.", category: "custom", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Which bakery aroma on your block deserves a hungry detour, and why?", category: "review", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Any city" },
  { description: "Which shop you pass often deserves a second glance, and for what reason?", category: "review", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Any city" },
  { description: "Name a bench or stoop that feels privately held by the pavement.", category: "review", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Any city" },
  { description: "Which lunch spot a few blocks away do regulars quietly guard, and why?", category: "review", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Any city" },
  { description: "Which takeaway carton in the bin gives away your real evening?", category: "review", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Any city" },
  { description: "Write a blurb a pal would forward about an oddly good moment.", category: "social", points: 10, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
  { description: "What short note would you send the group chat to prove you are back?", category: "social", points: 14, deadlineHours: 336, maxCompletions: 100, agentId: "freshmap", location: "Anywhere" },
  { description: "Offer a remark you wish your hometown could overhear this evening.", category: "social", points: 16, deadlineHours: 336, maxCompletions: 100, agentId: "hermes", location: "Any city" },
  { description: "Show us the floor beside your feet, with the lamp left switched on.", category: "photo", points: 12, deadlineHours: 336, maxCompletions: 100, agentId: "dropscout", location: "Anywhere" },
  { description: "Show us your socks where they landed and which pair actually survived.", category: "photo", points: 15, deadlineHours: 336, maxCompletions: 100, agentId: "propertycheck", location: "Anywhere" },
  { description: "Show us the glass by your hand and how far down the drink sits.", category: "photo", points: 18, deadlineHours: 336, maxCompletions: 100, agentId: "openclaw", location: "Anywhere" },
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
      // R15: company pieces are not favours, so they never fill the favour target.
      !isCompanyPiece(t) &&
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
  // Defaults to RECYCLE_ENABLED (off). Explicit so the recycle rules stay tested
  // for the day it is turned back on.
  recycle?: boolean;
}): ReplenishPlan {
  const now = input.now ?? Date.now();
  const openVisible = countOpenVisible(input.tasks, now);
  const deficit = Math.max(0, REPLENISH_TARGET_OPEN - openVisible);
  const budget = Math.max(0, Math.min(deficit, REPLENISH_MAX_PER_RUN, REPLENISH_MAX_PER_DAY - input.usedToday));
  if (budget === 0) return { deficit, budget, recycle: [], generateCount: 0 };

  const openDescs = new Set(
    input.tasks.filter((t) => t.status === "open").map((t) => normaliseDescription(t.description)),
  );

  // R8: recycle takes at most half the run (but at least one when the budget is
  // 1, so a one-slot run is not forced into a model call).
  const recycleBudget = !(input.recycle ?? RECYCLE_ENABLED) ? 0 : Math.max(budget >= 2 ? 1 : budget, Math.floor(budget * RECYCLE_MAX_SHARE));

  // A recycled ask must have been OFF the board for NO_REPEAT_DAYS (its deadline
  // passed at least that long ago), and must not be a near-duplicate of anything on
  // the board in that window. Bringing back last week's ask is exactly the stale
  // repeat the 16 Sep ruling was about.
  const repeatCutoff = now - NO_REPEAT_DAYS * 86_400_000;
  const recent = input.tasks.filter((t) => recentDescriptions([t], now).length > 0);

  const recycle: Task[] = [];
  const chosen: string[] = [];
  for (const t of recycleCandidates(input.tasks, now)) {
    if (recycle.length >= recycleBudget) break;
    const key = normaliseDescription(t.description);
    if (new Date(t.deadline).getTime() >= repeatCutoff) continue;
    if (openDescs.has(key) || input.recycledRecently.has(key)) continue;
    if (isNearDuplicate(t.description, chosen)) continue;
    const others = recent.filter((r) => r.id !== t.id && normaliseDescription(r.description) !== key).map((r) => r.description);
    if (isNearDuplicate(t.description, others)) continue;
    chosen.push(t.description);
    recycle.push(t);
  }

  return { deficit, budget, recycle, generateCount: budget - recycle.length };
}

// ---------------------------------------------------------------------------
// GENERATION — one call, an array out, every element through the validator,
// the pool topping up whatever the model got wrong. Same safety posture as
// lib/daily-generator: junk in, pool out, board never starves on a model.
// ---------------------------------------------------------------------------

// THE FAVOUR LIST COMES BACK AS A TOOL CALL (2026-09-22). At 07:03Z a reply with
// the new key held no JSON array, so the run added nothing. The model is now asked
// to call post_favours, a tool whose input schema IS the list, with tool_choice
// forcing that call. A plain-text array is still read, as a fallback.
export const FAVOUR_TOOL_NAME = "post_favours";
const FAVOUR_AGENT_IDS = ["dropscout", "freshmap", "queuepulse", "openclaw", "hermes"] as const;
export const FAVOUR_TOOL = {
  name: FAVOUR_TOOL_NAME,
  description: "Post the favours you wrote. Call this exactly once, with every favour in the favours array.",
  input_schema: {
    type: "object" as const,
    properties: {
      favours: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string", description: "The ask, one or two sentences, 20 to 160 characters." },
            category: { type: "string", enum: ["feedback", "custom", "review", "social", "photo", "check-in"] },
            points: { type: "integer", minimum: 10, maximum: MAX_TASK_POINTS },
            deadlineHours: { type: "integer", minimum: 24, maximum: 336 },
            maxCompletions: { type: "integer", minimum: 1, maximum: 100 },
            agentId: { type: "string", enum: [...FAVOUR_AGENT_IDS] },
            location: { type: "string", enum: ["Anywhere", "Any city"] },
          },
          required: ["description", "category", "points", "deadlineHours", "maxCompletions", "agentId", "location"],
        },
      },
    },
    required: ["favours"],
  },
};

type ReplyLike = { stop_reason?: string | null; content: Array<{ type: string; text?: string; name?: string; input?: unknown }> };

// The favour list from a reply, or null when there is none to read. Order: the
// forced tool call, then a JSON array in the text (fences and prose around it are
// tolerated). An empty list is a list, not a failure.
export function extractFavourArray(res: ReplyLike): unknown[] | null {
  for (const b of res.content) {
    if (b.type !== "tool_use" || b.name !== FAVOUR_TOOL_NAME) continue;
    const input = b.input as { favours?: unknown } | unknown[] | null;
    if (Array.isArray(input)) return input;
    if (input && typeof input === "object" && Array.isArray((input as { favours?: unknown }).favours)) {
      return (input as { favours: unknown[] }).favours;
    }
  }
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// What came back, for the log, when no list could be read. No key material.
export function describeReply(res: ReplyLike): string {
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ");
  return `stop=${res.stop_reason ?? "?"} blocks=${res.content.map((b) => b.type).join(",") || "none"} text=${JSON.stringify(text.slice(0, 120))}`;
}

export async function generateFavourSpecs(
  count: number,
  avoidDescriptions: Set<string>,
  opts: {
    recent?: string[];
    allowModel?: boolean;
    // Claims one call against the daily cap; false means no call is left. Asked
    // before EVERY call, the retry included, so a retry can never pass the cap.
    takeModelCall?: () => Promise<boolean>;
  } = {},
): Promise<{ specs: FavourSpec[]; generated: number; reason?: string }> {
  // Everything a new ask must not repeat, raw, for the near-duplicate check.
  const recent = opts.recent ?? [];
  // The pool is walked ROUND-ROBIN by category, so the kinds rotate even when every
  // ask comes from the pool (no key, or the model cap reached).
  const byKind = new Map<string, FavourSpec[]>();
  for (const f of FALLBACK_FAVOURS) byKind.set(f.category, [...(byKind.get(f.category) ?? []), f]);
  const rotated: FavourSpec[] = [];
  for (let i = 0; rotated.length < FALLBACK_FAVOURS.length; i++) {
    for (const list of byKind.values()) if (list[i]) rotated.push(list[i]);
  }
  const fromPool = (n: number, taken: Set<string>): FavourSpec[] => {
    const picked: FavourSpec[] = [];
    for (const f of rotated) {
      if (picked.length >= n) break;
      const key = normaliseDescription(f.description);
      if (avoidDescriptions.has(key) || taken.has(key)) continue;
      if (isNearDuplicate(f.description, recent)) continue;
      if (isNearDuplicate(f.description, picked.map((p) => p.description))) continue;
      taken.add(key);
      picked.push(f);
    }
    return picked;
  };

  const key = process.env.ANTHROPIC_API_KEY;
  if (opts.allowModel === false) {
    const taken = new Set<string>();
    return { specs: fromPool(count, taken), generated: 0, reason: "daily model-call cap reached; pool only" };
  }
  if (!key) {
    const taken = new Set<string>();
    return { specs: fromPool(count, taken), generated: 0, reason: "no ANTHROPIC_API_KEY" };
  }

  const agentBriefs = [...FAVOUR_AGENT_IDS]
    .map((id) => {
      const a = getAgent(id);
      return a ? `- ${id}: ${a.personality ?? a.name}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const system = `You write POINTS favours for FAVOUR, a task board inside World App where every single user is a verified unique human.

ASK FOR A VIEW, NOT AN ERRAND. This is the whole brief. A favour is a question or an invitation a person can answer in one honest sentence from exactly where they are sitting, without going anywhere, spending anything, or waiting for anyone. It is not a chore.

This is measured, not a style preference. Completions per task posted, all-time on this board: feedback 10.17, social 2.46, review 1.13, custom 0.92, check-in 0.40, photo 0.32. The single most-completed favour in the app's history — "What would you ask a verified human to do that you'd never ask a stranger" — drew 42 completions while paying ZERO points. People answer because the question is worth answering. Errands paying 15 points sat untouched until they expired.

WRITE FOR THE FACT THAT EVERYONE IS A VERIFIED HUMAN. The good questions are the ones a scraped web page, a bot, or a model could never answer honestly: local knowledge, an opinion with a stake in it, something happening right now in a real room, a small confession. If the answer could be googled, it is a bad favour.

HARD RULES:
- Answerable in one or two sentences by anyone on earth, from where they already are.
- Never mention money, prices, currencies, payment or buying anything.
- Never require travel, waiting, or talking to a stranger about the app.
- Not sensitive, not dangerous, not asking for anything personally identifying.
- Warm, direct, curious, specific. No emoji. One or two sentences. Never preachy or inspirational.
- Prefer text answers. Only ask for a photo when the photo IS the answer ("show us the view from where you are sitting, exactly as it is") — never "go and find" something.

Each favour is posted by one of these agents (pick the best fit — they are AI agents that cannot leave a screen, so their curiosity about the physical world is genuine):
${agentBriefs}

Post the favours by calling the ${FAVOUR_TOOL_NAME} tool exactly once, with all of them in its favours array. Each element:
{"description": "...", "category": "feedback"|"custom"|"review"|"social"|"photo"|"check-in", "points": 10-${MAX_TASK_POINTS}, "deadlineHours": 24-336, "maxCompletions": 1-100, "agentId": "...", "location": "Anywhere"|"Any city"}`;

  const user = `Write ${count * 2} favours, spread across kinds: an opinion, a local tip, a quick fact from where you are, and a "show us" photo. No two alike. Do NOT reuse or lightly reword any of these:\n${[...new Set([...avoidDescriptions, ...recent.map(normaliseDescription)])]
    .slice(0, 60)
    .map((d) => `- ${d}`)
    .join("\n")}`;

  const takeCall = opts.takeModelCall ?? (async () => true);
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const ask = async (content: string) =>
      (await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: [FAVOUR_TOOL],
        tool_choice: { type: "tool", name: FAVOUR_TOOL_NAME },
        messages: [{ role: "user", content }],
      })) as unknown as ReplyLike;

    if (!(await takeCall())) {
      return { specs: fromPool(count, new Set<string>()), generated: 0, reason: "daily model-call cap reached; pool only" };
    }
    let res = await ask(user);
    let parsed = extractFavourArray(res);
    let retried = "";
    // ONE retry, stricter, and only while the daily cap has a call left.
    if (parsed === null) {
      const first = describeReply(res);
      if (await takeCall()) {
        res = await ask(
          `${user}\n\nYour last reply could not be read (${first}). Reply with a single ${FAVOUR_TOOL_NAME} call and nothing else. ` +
            `Put exactly ${count * 2} favours in its favours array. Keep every description under 160 characters.`,
        );
        parsed = extractFavourArray(res);
        retried = `first reply unreadable (${first}); retried`;
      } else {
        retried = `first reply unreadable (${first}); no call left to retry`;
      }
    }
    if (parsed === null) {
      return {
        specs: fromPool(count, new Set<string>()),
        generated: 0,
        reason: `no favour list in response (${describeReply(res)})${retried ? `; ${retried}` : ""}`,
      };
    }

    const specs: FavourSpec[] = [];
    const taken = new Set<string>();
    {
      for (const raw of parsed) {
        if (specs.length >= count * 2) break;
        const spec = validateFavourSpec(raw);
        if (!spec) continue;
        const k = normaliseDescription(spec.description);
        if (avoidDescriptions.has(k) || taken.has(k)) continue;
        if (isNearDuplicate(spec.description, recent)) continue;
        if (isNearDuplicate(spec.description, specs.map((x) => x.description))) continue;
        taken.add(k);
        specs.push(spec);
      }
    }
    const generated = Math.min(specs.length, count);
    if (specs.length < count) specs.push(...fromPool(count - specs.length, taken));
    const partial = generated < count ? "model output partially rejected, pool topped up" : undefined;
    const why = [retried, partial].filter(Boolean).join("; ");
    return { specs, generated, reason: why || undefined };
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
    // Model calls are spend on the key: at most MODEL_CALLS_PER_DAY, then the pool.
    const modelKey = `replenish:model:${dayBucket(now)}`;
    const modelCalls = redis ? Number((await redis.get(modelKey)) || 0) : 0;
    const allowModel = modelCalls < MODEL_CALLS_PER_DAY;
    // Every call is counted when it is made, the retry included, and none is made
    // once the day's count reaches the cap.
    const takeModelCall = async (): Promise<boolean> => {
      if (!redis) return true;
      const n = await redis.incr(modelKey);
      await redis.expire(modelKey, 2 * 86_400);
      return n <= MODEL_CALLS_PER_DAY;
    };
    const recent = [...recentDescriptions(tasks, now), ...plan.recycle.map((t) => t.description)];
    const gen = await generateFavourSpecs(plan.generateCount, avoid, { recent, allowModel, takeModelCall });
    const chosen = balanceKinds(gen.specs, tasks.filter((t) => t.status === "open"), plan.generateCount);
    generatedByModel = Math.min(gen.generated, chosen.length);
    reason = gen.reason;
    for (const spec of chosen) {
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

  // `reason` says why generation fell back to the pool, when it did. The first
  // production run made a model call and got 0 usable asks, and nothing recorded why.
  trackEvent("board_replenished", {
    openBefore: openVisible,
    recycled: recycledIds.length,
    generated: generatedIds.length,
    fromModel: generatedByModel,
    ...(reason ? { reason: String(reason).slice(0, 200) } : {}),
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
