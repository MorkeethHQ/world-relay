import { getRedis } from "./redis";

const POF_PREFIX = "pof:";
const POF_INDEX_KEY = "pof:__index";
const MAX_HISTORY = 20;

// --- Single source of truth for the season economy ---
// Points are NOT dollars. Every award in this file pulls from this table so
// there is exactly one place to tune the economy. Per-task earnings stay in the
// 1-10 band; completion is the headline reward, everything else is small.
// The all-time schedule is designed so a runner's totalPoints tracks roughly
// favoursCompleted * 10 + longestStreak * 2, and does not drift over time.
export const SEASON_ECONOMY = {
  FAVOUR_COMPLETED: 10, // headline reward for a verified completion
  FAVOUR_ATTEMPTED: 2, // submitted proof / attempted a favour
  FAVOUR_CLAIMED: 2, // claimed an open favour
  FAVOUR_POSTED: 3, // posted a favour for others
  DAILY_ACTIVITY: 1, // once-per-day show-up bonus
  STREAK_BONUS_PER_DAY: 1, // per consecutive day, on completion
  STREAK_BONUS_MAX_DAYS: 7, // cap the streak bonus at 7 days (max +7)
} as const;

// Streak bonus paid on a completion, capped so no single task pays more than
// FAVOUR_COMPLETED + STREAK_BONUS_MAX_DAYS.
function streakBonusFor(streak: number): number {
  const capped = Math.min(Math.max(streak, 0), SEASON_ECONOMY.STREAK_BONUS_MAX_DAYS);
  return capped * SEASON_ECONOMY.STREAK_BONUS_PER_DAY;
}

// Only real wallet addresses (verified humans who can receive USDC) may earn
// points or appear on the leaderboard. Blocks anonymous/dev_/e2e_/demo_
// identities from ever polluting stats or the public Ranks again.
const isRealWallet = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a);

// --- Seasons ---
// Monthly seasons. Season 1 is January 2026 (UTC). Season number increments
// every calendar month. The weekly zset sprint runs on top of this as a
// short-cycle competition; seasons are the longer arc that resets monthly.
const SEASON_EPOCH_YEAR = 2026;

export type Season = {
  number: number;
  startsAt: string; // ISO
  endsAt: string; // ISO (exclusive: first instant of next season)
  daysRemaining: number;
};

export function getCurrentSeason(now: Date = new Date()): Season {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  const number = (year - SEASON_EPOCH_YEAR) * 12 + month + 1;
  const startsAt = new Date(Date.UTC(year, month, 1));
  const endsAt = new Date(Date.UTC(year, month + 1, 1));
  const msRemaining = endsAt.getTime() - now.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));
  return {
    number,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daysRemaining,
  };
}

export type ProofOfFavour = {
  address: string;
  totalPoints: number;
  level: string;
  favoursAttempted: number;
  favoursCompleted: number;
  favoursPosted: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string; // ISO date string (date only, for streak tracking)
  pointsHistory: Array<{ action: string; points: number; timestamp: string }>; // last 20 entries
};

// --- Level thresholds ---

const LEVELS: Array<{ name: string; minPoints: number }> = [
  { name: "Legend", minPoints: 1000 },
  { name: "Veteran Runner", minPoints: 400 },
  { name: "Trusted Runner", minPoints: 150 },
  { name: "Local Runner", minPoints: 50 },
  { name: "New Runner", minPoints: 0 },
];

export function getLevel(points: number): string {
  for (const l of LEVELS) {
    if (points >= l.minPoints) return l.name;
  }
  return "New Runner";
}

export function getPointsToNextLevel(points: number): {
  nextLevel: string;
  pointsNeeded: number;
  progress: number;
} {
  // Find current level and the one above it
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].minPoints) {
      if (i === 0) {
        // Already at max level
        return { nextLevel: "Legend", pointsNeeded: 0, progress: 1 };
      }
      const next = LEVELS[i - 1];
      const current = LEVELS[i];
      const needed = next.minPoints - points;
      const range = next.minPoints - current.minPoints;
      const progress = range > 0 ? (points - current.minPoints) / range : 1;
      return { nextLevel: next.name, pointsNeeded: needed, progress };
    }
  }
  // Fallback: at zero
  const next = LEVELS[LEVELS.length - 2]; // Local Runner
  return { nextLevel: next.name, pointsNeeded: next.minPoints, progress: 0 };
}

// --- Helpers ---

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultProfile(address: string): ProofOfFavour {
  return {
    address,
    totalPoints: 0,
    level: "New Runner",
    favoursAttempted: 0,
    favoursCompleted: 0,
    favoursPosted: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: "",
    pointsHistory: [],
  };
}

function updateStreak(profile: ProofOfFavour): void {
  const today = todayDateStr();
  if (profile.lastActivityDate === today) {
    // Already active today, no streak change
    return;
  }

  if (!profile.lastActivityDate) {
    // First activity ever
    profile.currentStreak = 1;
    profile.lastActivityDate = today;
    if (profile.currentStreak > profile.longestStreak) {
      profile.longestStreak = profile.currentStreak;
    }
    return;
  }

  const lastDate = new Date(profile.lastActivityDate + "T00:00:00Z");
  const todayDate = new Date(today + "T00:00:00Z");
  const diffMs = todayDate.getTime() - lastDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 1) {
    // Consecutive day
    profile.currentStreak += 1;
  } else {
    // Gap — reset streak
    profile.currentStreak = 1;
  }

  profile.lastActivityDate = today;
  if (profile.currentStreak > profile.longestStreak) {
    profile.longestStreak = profile.currentStreak;
  }
}

// --- Redis persistence ---

// Consistent UTC, Monday-anchored week key. The key is the date of the Monday
// that opens the current week (UTC), matching todayDateStr()'s UTC basis so the
// weekly sprint and daily streaks never disagree about which day it is.
function weekKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun .. 6=Sat
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `pof:weekly:${y}-${m}-${dd}`;
}

async function trackWeeklyPoints(address: string, points: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = weekKey();
  await redis.zincrby(key, points, address).catch(console.error);
  await redis.expire(key, 14 * 86400).catch(console.error);
}

async function saveProfile(profile: ProofOfFavour): Promise<void> {
  // Airtight guard: never persist or index a non-wallet identity. This is the
  // one write path all record*/award functions share, so dev_/e2e_/anonymous
  // ids can never re-pollute pof:__index or the leaderboard on post/claim/submit.
  if (!isRealWallet(profile.address)) return;
  const redis = getRedis();
  if (!redis) return;
  const key = `${POF_PREFIX}${profile.address}`;
  await redis.set(key, JSON.stringify(profile)).catch(console.error);
  await redis.sadd(POF_INDEX_KEY, profile.address).catch(console.error);
}

export async function getWeeklyLeaderboard(limit = 10): Promise<Array<{ address: string; weeklyPoints: number }>> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const key = weekKey();
    // Over-fetch, then filter non-wallets at read time so legacy dev_/e2e_/
    // anonymous entries left in the zset never surface on the public board.
    const results = await redis.zrange(key, 0, limit * 4 - 1, { rev: true, withScores: true });
    const entries: Array<{ address: string; weeklyPoints: number }> = [];
    for (let i = 0; i < results.length; i += 2) {
      const address = String(results[i]);
      if (!isRealWallet(address)) continue;
      entries.push({ address, weeklyPoints: Number(results[i + 1]) });
    }
    return entries.slice(0, limit);
  } catch (err) {
    console.error("[PoF] Weekly leaderboard failed:", err);
    return [];
  }
}

// --- Public API ---

export async function getProofOfFavour(address: string): Promise<ProofOfFavour> {
  const redis = getRedis();
  if (!redis) return defaultProfile(address);

  try {
    const raw = await redis.get(`${POF_PREFIX}${address}`);
    if (!raw) return defaultProfile(address);
    const profile: ProofOfFavour =
      typeof raw === "string" ? JSON.parse(raw) : (raw as ProofOfFavour);
    return profile;
  } catch (err) {
    console.error(`[PoF] Failed to read profile for ${address}:`, err);
    return defaultProfile(address);
  }
}

export async function awardPoints(
  address: string,
  action: string,
  points: number
): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  profile.totalPoints += points;
  profile.level = getLevel(profile.totalPoints);

  // Append to history, keep last MAX_HISTORY entries
  profile.pointsHistory.push({
    action,
    points,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);

  await saveProfile(profile);
  trackWeeklyPoints(address, points).catch(console.error);
  return profile;
}

export async function recordFavourClaimed(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  const points = SEASON_ECONOMY.FAVOUR_CLAIMED;
  profile.totalPoints += points;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_claimed",
    points,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  trackWeeklyPoints(address, points).catch(console.error);
  return profile;
}

export async function recordFavourAttempted(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  const points = SEASON_ECONOMY.FAVOUR_ATTEMPTED;
  profile.totalPoints += points;
  profile.favoursAttempted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_attempted",
    points,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  trackWeeklyPoints(address, points).catch(console.error);
  return profile;
}

export async function recordFavourCompleted(
  address: string,
  streak: number
): Promise<ProofOfFavour> {
  const completion = SEASON_ECONOMY.FAVOUR_COMPLETED;
  const streakBonus = streakBonusFor(streak);
  const totalAwarded = completion + streakBonus;

  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  profile.totalPoints += totalAwarded;
  profile.favoursCompleted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_completed",
    points: completion,
    timestamp: new Date().toISOString(),
  });
  if (streakBonus > 0) {
    profile.pointsHistory.push({
      action: "streak_bonus",
      points: streakBonus,
      timestamp: new Date().toISOString(),
    });
  }
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  trackWeeklyPoints(address, totalAwarded).catch(console.error);
  return profile;
}

export async function recordFavourFailed(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  profile.currentStreak = 0;

  profile.pointsHistory.push({
    action: "favour_failed",
    points: 0,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  profile.lastActivityDate = todayDateStr();
  await saveProfile(profile);
  return profile;
}

export async function recordFavourPosted(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  const points = SEASON_ECONOMY.FAVOUR_POSTED;
  profile.totalPoints += points;
  profile.favoursPosted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_posted",
    points,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  trackWeeklyPoints(address, points).catch(console.error);
  return profile;
}

export async function recordDailyActivity(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  if (!isRealWallet(address)) return profile;
  const today = todayDateStr();

  // Only award daily activity points once per day
  if (profile.lastActivityDate === today) {
    return profile;
  }

  const points = SEASON_ECONOMY.DAILY_ACTIVITY;
  profile.totalPoints += points;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "daily_activity",
    points,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  trackWeeklyPoints(address, points).catch(console.error);
  return profile;
}

export async function getTopRunners(limit = 10): Promise<ProofOfFavour[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const addresses = await redis.smembers(POF_INDEX_KEY);
    if (!addresses || addresses.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const addr of addresses) {
      pipeline.get(`${POF_PREFIX}${addr}`);
    }
    const results = await pipeline.exec();

    const profiles: ProofOfFavour[] = [];
    for (const raw of results) {
      if (!raw) continue;
      const profile: ProofOfFavour =
        typeof raw === "string" ? JSON.parse(raw) : (raw as ProofOfFavour);
      // Read-time guard: drop any legacy dev_/e2e_/anonymous rows still in the
      // index so they never rank on the public board.
      if (!isRealWallet(profile.address)) continue;
      profiles.push(profile);
    }

    return profiles
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, limit);
  } catch (err) {
    console.error("[PoF] Failed to fetch leaderboard:", err);
    return [];
  }
}
