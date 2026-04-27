import { getRedis } from "./redis";
import { awardPoints } from "./proof-of-favour";

// --- Challenge rotation (7 challenges, one per day of the week) ---

const CHALLENGES = [
  {
    day: 0,
    id: "sunday-spot",
    title: "Your Favourite Spot",
    description:
      "Photograph your favourite spot in your neighbourhood — a bench, a view, a corner you always pass.",
    category: "photo",
    why: "Building a local knowledge graph of places people actually love",
  },
  {
    day: 1,
    id: "monday-coffee",
    title: "Coffee Price Check",
    description:
      "What does a coffee cost near you? Photograph a menu or price board at your nearest café.",
    category: "check-in",
    why: "Tracking real-time price data across cities worldwide",
  },
  {
    day: 2,
    id: "tuesday-weather",
    title: "Weather Ground Truth",
    description:
      "How's the weather outside your window right now? Photograph the sky and street conditions.",
    category: "photo",
    why: "Ground truth for logistics and delivery routing models",
  },
  {
    day: 3,
    id: "wednesday-open",
    title: "Open or Closed?",
    description:
      "Is your nearest store or café open right now? Photograph the storefront showing its status.",
    category: "check-in",
    why: "Real-time business hours verification for map APIs",
  },
  {
    day: 4,
    id: "thursday-crowd",
    title: "Street Pulse",
    description:
      "How crowded is your street right now? Photograph the view and estimate foot traffic.",
    category: "photo",
    why: "Pedestrian density data for urban analytics",
  },
  {
    day: 5,
    id: "friday-sky",
    title: "Golden Hour",
    description:
      "Photograph the sky from where you are right now — capture the light, the colours, the moment.",
    category: "photo",
    why: "Visual conditions data for content and photography platforms",
  },
  {
    day: 6,
    id: "saturday-event",
    title: "What's Happening?",
    description:
      "Anything interesting near you today? A market, pop-up, event, or unusual activity. Photograph it.",
    category: "photo",
    why: "Real-time event and activity detection",
  },
];

// --- Types ---

export type DailyChallenge = {
  id: string;
  title: string;
  description: string;
  category: string;
  why: string;
  date: string; // ISO date YYYY-MM-DD
  pointsReward: number; // always 15
  streakBonus: number; // extra points if user has done consecutive daily challenges
};

export type ChallengeCompletion = {
  address: string;
  challengeId: string;
  date: string;
  proofImageBase64?: string;
  proofNote?: string;
  completedAt: string;
  pointsEarned: number;
};

// --- Helpers ---

const BASE_POINTS = 15;
const MAX_STREAK_BONUS = 30;
const STREAK_BONUS_PER_DAY = 3;
const COMPLETION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const RECENT_LIST_MAX = 10;

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayOfWeek(): number {
  return new Date().getDay(); // 0 = Sunday
}

function streakBonusFor(streak: number): number {
  return Math.min(streak * STREAK_BONUS_PER_DAY, MAX_STREAK_BONUS);
}

// --- Public API ---

export function getTodaysChallenge(streakForBonus = 0): DailyChallenge {
  const dow = dayOfWeek();
  const c = CHALLENGES[dow];
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    category: c.category,
    why: c.why,
    date: todayDateStr(),
    pointsReward: BASE_POINTS,
    streakBonus: streakBonusFor(streakForBonus),
  };
}

export async function hasCompletedToday(address: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const date = todayDateStr();
  const key = `daily:${date}:${address}`;
  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    console.error("[DailyChallenge] hasCompletedToday error:", err);
    return false;
  }
}

export async function getChallengeStreak(address: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  try {
    const raw = await redis.get(`daily:streak:${address}`);
    if (!raw) return 0;
    const streak = typeof raw === "string" ? parseInt(raw, 10) : (raw as number);
    return isNaN(streak) ? 0 : streak;
  } catch (err) {
    console.error("[DailyChallenge] getChallengeStreak error:", err);
    return 0;
  }
}

/**
 * Count consecutive days the user has completed challenges, checking backwards
 * from yesterday. This is used to recalculate the streak from ground truth.
 */
async function recalculateStreak(address: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  let streak = 0;
  const now = new Date();

  // Check backwards from yesterday
  for (let i = 1; i <= 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const key = `daily:${dateStr}:${address}`;
    try {
      const exists = await redis.exists(key);
      if (exists === 1) {
        streak++;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  return streak;
}

export async function completeChallenge(
  address: string,
  proofImageBase64?: string,
  proofNote?: string
): Promise<{
  completion: ChallengeCompletion;
  pointsEarned: number;
  newTotal: number;
}> {
  // Check if already completed today
  const alreadyDone = await hasCompletedToday(address);
  if (alreadyDone) {
    throw new Error("Already completed today's challenge");
  }

  const date = todayDateStr();

  // Recalculate streak from stored completions (days before today)
  const previousStreak = await recalculateStreak(address);
  // After completing today, the new streak is previousStreak + 1
  const newStreak = previousStreak + 1;
  const streakBonus = streakBonusFor(newStreak);
  const totalPoints = BASE_POINTS + streakBonus;

  const challenge = getTodaysChallenge(newStreak);

  const completion: ChallengeCompletion = {
    address,
    challengeId: challenge.id,
    date,
    proofImageBase64,
    proofNote,
    completedAt: new Date().toISOString(),
    pointsEarned: totalPoints,
  };

  // Store in Redis
  const redis = getRedis();
  if (redis) {
    const completionKey = `daily:${date}:${address}`;
    const countKey = `daily:${date}:count`;
    const recentKey = `daily:${date}:recent`;
    const streakKey = `daily:streak:${address}`;

    // Store without the base64 image in the recent list (too large)
    const completionForList: ChallengeCompletion = {
      ...completion,
      proofImageBase64: undefined,
    };

    try {
      const pipeline = redis.pipeline();

      // Store full completion with TTL
      pipeline.set(completionKey, JSON.stringify(completion));
      pipeline.expire(completionKey, COMPLETION_TTL_SECONDS);

      // Increment daily counter
      pipeline.incr(countKey);
      pipeline.expire(countKey, COMPLETION_TTL_SECONDS);

      // Push to recent list (trim to last RECENT_LIST_MAX)
      pipeline.lpush(recentKey, JSON.stringify(completionForList));
      pipeline.ltrim(recentKey, 0, RECENT_LIST_MAX - 1);
      pipeline.expire(recentKey, COMPLETION_TTL_SECONDS);

      // Update streak
      pipeline.set(streakKey, newStreak);

      await pipeline.exec();
    } catch (err) {
      console.error("[DailyChallenge] completeChallenge Redis error:", err);
    }
  }

  // Award points via proof-of-favour system
  const profile = await awardPoints(address, "daily-challenge", totalPoints);

  return {
    completion,
    pointsEarned: totalPoints,
    newTotal: profile.totalPoints,
  };
}

export async function getDailyChallengeStats(
  date?: string
): Promise<{
  totalCompletions: number;
  recentCompletions: ChallengeCompletion[];
}> {
  const redis = getRedis();
  const targetDate = date || todayDateStr();

  if (!redis) {
    return { totalCompletions: 0, recentCompletions: [] };
  }

  try {
    const countKey = `daily:${targetDate}:count`;
    const recentKey = `daily:${targetDate}:recent`;

    const [countRaw, recentRaw] = await Promise.all([
      redis.get(countKey),
      redis.lrange(recentKey, 0, RECENT_LIST_MAX - 1),
    ]);

    const totalCompletions = countRaw
      ? typeof countRaw === "string"
        ? parseInt(countRaw, 10)
        : (countRaw as number)
      : 0;

    const recentCompletions: ChallengeCompletion[] = [];
    if (recentRaw && Array.isArray(recentRaw)) {
      for (const item of recentRaw) {
        try {
          const parsed: ChallengeCompletion =
            typeof item === "string"
              ? JSON.parse(item)
              : (item as ChallengeCompletion);
          recentCompletions.push(parsed);
        } catch {
          // Skip malformed entries
        }
      }
    }

    return { totalCompletions: isNaN(totalCompletions) ? 0 : totalCompletions, recentCompletions };
  } catch (err) {
    console.error("[DailyChallenge] getDailyChallengeStats error:", err);
    return { totalCompletions: 0, recentCompletions: [] };
  }
}
