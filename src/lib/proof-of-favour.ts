import { getRedis } from "./redis";

const POF_PREFIX = "pof:";
const POF_INDEX_KEY = "pof:__index";
const MAX_HISTORY = 20;

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

async function saveProfile(profile: ProofOfFavour): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const key = `${POF_PREFIX}${profile.address}`;
  await redis.set(key, JSON.stringify(profile)).catch(console.error);
  // Maintain an index set for leaderboard queries
  await redis.sadd(POF_INDEX_KEY, profile.address).catch(console.error);
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

  // Update streak based on date
  updateStreak(profile);

  await saveProfile(profile);
  return profile;
}

export async function recordFavourClaimed(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  profile.totalPoints += 5;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_claimed",
    points: 5,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  return profile;
}

export async function recordFavourAttempted(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  profile.totalPoints += 10;
  profile.favoursAttempted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_attempted",
    points: 10,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  return profile;
}

export async function recordFavourCompleted(
  address: string,
  streak: number
): Promise<ProofOfFavour> {
  const streakBonus = streak * 2;
  const totalAwarded = 25 + streakBonus;

  const profile = await getProofOfFavour(address);
  profile.totalPoints += totalAwarded;
  profile.favoursCompleted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_completed",
    points: 25,
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
  return profile;
}

export async function recordFavourFailed(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  profile.totalPoints += 5;
  profile.currentStreak = 0;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_failed",
    points: 5,
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
  profile.totalPoints += 5;
  profile.favoursPosted += 1;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "favour_posted",
    points: 5,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
  return profile;
}

export async function recordDailyActivity(address: string): Promise<ProofOfFavour> {
  const profile = await getProofOfFavour(address);
  const today = todayDateStr();

  // Only award daily activity points once per day
  if (profile.lastActivityDate === today) {
    return profile;
  }

  profile.totalPoints += 3;
  profile.level = getLevel(profile.totalPoints);

  profile.pointsHistory.push({
    action: "daily_activity",
    points: 3,
    timestamp: new Date().toISOString(),
  });
  if (profile.pointsHistory.length > MAX_HISTORY) {
    profile.pointsHistory = profile.pointsHistory.slice(-MAX_HISTORY);
  }

  updateStreak(profile);
  await saveProfile(profile);
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
