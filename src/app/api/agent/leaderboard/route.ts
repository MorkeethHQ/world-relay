import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { getAgentAnalytics } from "@/lib/agent-analytics";

const CACHE_KEY = "cache:leaderboard";
const CACHE_TTL_SECONDS = 300; // 5 minutes

type LeaderboardEntry = {
  rank: number;
  name: string;
  icon: string;
  completedTasks: number;
  successRate: number;
  totalSpentUsdc: number;
};

export async function GET() {
  try {
    const redis = getRedis();

    // Try cache first
    if (redis) {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const data = typeof cached === "string" ? JSON.parse(cached) : cached;
        return NextResponse.json(data, {
          headers: { "X-Cache": "HIT" },
        });
      }
    }

    // Compute fresh leaderboard
    const allStats = await getAgentAnalytics();

    // Sort by completed tasks descending, take top 10
    const sorted = [...allStats]
      .sort((a, b) => b.completedTasks - a.completedTasks)
      .slice(0, 10);

    const leaderboard: LeaderboardEntry[] = sorted.map((agent, idx) => ({
      rank: idx + 1,
      name: agent.name,
      icon: agent.icon,
      completedTasks: agent.completedTasks,
      successRate: agent.successRate,
      totalSpentUsdc: agent.totalSpentUsdc,
    }));

    const response = { leaderboard, updatedAt: new Date().toISOString() };

    // Cache in Redis
    if (redis) {
      await redis.set(CACHE_KEY, JSON.stringify(response), { ex: CACHE_TTL_SECONDS });
    }

    return NextResponse.json(response, {
      headers: { "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("[Leaderboard] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute leaderboard" },
      { status: 500 }
    );
  }
}
