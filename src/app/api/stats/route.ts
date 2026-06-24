import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import type { Task } from "@/lib/types";

const CACHE_KEY = "cache:stats";
const CACHE_TTL = 60; // seconds

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis unavailable" }, { status: 503 });
  }

  // Check cache first
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const data = typeof cached === "string" ? JSON.parse(cached) : cached;
      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      });
    }
  } catch {
    // cache miss or parse error, compute fresh
  }

  try {
    const stats = await computeStats(redis);

    // Store in cache with TTL
    await redis
      .set(CACHE_KEY, JSON.stringify(stats), { ex: CACHE_TTL })
      .catch(() => {});

    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("[Stats] Failed to compute stats:", err);
    return NextResponse.json(
      { error: "Failed to compute stats" },
      { status: 500 },
    );
  }
}

async function computeStats(redis: NonNullable<ReturnType<typeof getRedis>>) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  // Fetch all task IDs
  const taskIds: string[] = await redis.smembers("task_ids");

  // Fetch all tasks via pipeline
  let tasks: Task[] = [];
  if (taskIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of taskIds) {
      pipeline.get(`task:${id}`);
    }
    const results = await pipeline.exec();
    for (const raw of results) {
      if (!raw) continue;
      const task: Task =
        typeof raw === "string" ? JSON.parse(raw) : (raw as Task);
      tasks.push(task);
    }
  }

  // Task counts by status
  let open = 0;
  let claimed = 0;
  let completed = 0;
  let totalBounty = 0;
  let paidOut = 0;
  let last24h = 0;
  let last7d = 0;
  const posters = new Set<string>();
  const claimants = new Set<string>();

  for (const task of tasks) {
    // Status counts
    if (task.status === "open") open++;
    else if (task.status === "claimed") claimed++;
    else if (task.status === "completed") completed++;

    // Bounty volume
    const bounty = Number(task.bountyUsdc) || 0;
    totalBounty += bounty;
    if (task.status === "completed") paidOut += bounty;

    // Activity
    const createdAt = new Date(task.createdAt).getTime();
    if (createdAt >= oneDayAgo) last24h++;
    if (createdAt >= sevenDaysAgo) last7d++;

    // Unique users from tasks
    if (task.poster) posters.add(task.poster);
    if (task.claimant) claimants.add(task.claimant);
  }

  // Fetch pof:__index for known profiles
  const pofAddresses: string[] = await redis.smembers("pof:__index");

  // Count verified:* keys via SCAN
  const verifiedAddresses = new Set<string>();
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, {
      match: "verified:*",
      count: 200,
    });
    cursor = typeof nextCursor === "string" ? parseInt(nextCursor, 10) : nextCursor;
    for (const key of keys) {
      const addr = key.replace("verified:", "");
      verifiedAddresses.add(addr);
    }
  } while (cursor !== 0);

  // Total unique users: union of pof addresses, verified addresses, posters, claimants
  const allUsers = new Set<string>([
    ...pofAddresses,
    ...verifiedAddresses,
    ...posters,
    ...claimants,
  ]);

  // Visitor counts
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(now - 86400 * 1000).toISOString().slice(0, 10);

  const [visitorsTotal, visitorsToday, visitorsYesterday] = await Promise.all([
    redis.scard("visitors:all"),
    redis.scard(`visitors:${today}`),
    redis.scard(`visitors:${yesterday}`),
  ]);

  const avgBounty = tasks.length > 0 ? totalBounty / tasks.length : 0;

  return {
    users: {
      total: allUsers.size,
      verified: verifiedAddresses.size,
      activeRunners: claimants.size,
      activePosters: posters.size,
    },
    tasks: {
      total: taskIds.length,
      open,
      claimed,
      completed,
    },
    volume: {
      totalBountyUsdc: Math.round(totalBounty * 100) / 100,
      paidOutUsdc: Math.round(paidOut * 100) / 100,
      avgBountyUsdc: Math.round(avgBounty * 100) / 100,
    },
    activity: {
      last24h,
      last7d,
    },
    visitors: {
      total: visitorsTotal,
      today: visitorsToday,
      yesterday: visitorsYesterday,
    },
  };
}
