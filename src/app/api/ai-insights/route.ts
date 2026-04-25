import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { listTasks } from "@/lib/store";
import { getRedis } from "@/lib/redis";

const CACHE_KEY = "ai:insight:latest";
const CACHE_TTL = 300; // 5 minutes

type CachedInsight = {
  insight: string;
  generatedAt: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";

  // Check Redis cache first (unless forced refresh)
  if (!refresh) {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          const parsed: CachedInsight =
            typeof cached === "string" ? JSON.parse(cached) : (cached as CachedInsight);
          return NextResponse.json(parsed);
        }
      } catch (err) {
        console.error("[AI Insights] Redis cache read failed:", err);
      }
    }
  }

  // Fetch all tasks and compute stats
  const tasks = await listTasks();
  const total = tasks.length;
  const open = tasks.filter((t) => t.status === "open").length;
  const claimed = tasks.filter((t) => t.status === "claimed").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const totalUsdc = tasks.reduce((s, t) => s + t.bountyUsdc, 0);
  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : "0";

  // Confidence stats
  const confidences = tasks
    .filter((t) => t.verificationResult?.confidence)
    .map((t) => t.verificationResult!.confidence);
  const avgConfidence =
    confidences.length > 0
      ? (confidences.reduce((s, c) => s + c, 0) / confidences.length * 100).toFixed(1)
      : "N/A";

  // Top agents by task count
  const agentCounts = new Map<string, { name: string; count: number }>();
  for (const t of tasks) {
    if (t.agent) {
      const existing = agentCounts.get(t.agent.id);
      if (existing) {
        existing.count++;
      } else {
        agentCounts.set(t.agent.id, { name: t.agent.name, count: 1 });
      }
    }
  }
  const topAgents = Array.from(agentCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((a) => `${a.name} (${a.count} tasks)`)
    .join(", ");

  // Unique cities
  const cities = new Set(tasks.map((t) => t.location.split(",").pop()?.trim()).filter(Boolean));

  const statsText = `Network Stats:
- Total tasks: ${total}
- Open: ${open}, Claimed: ${claimed}, Completed: ${completed}
- Completion rate: ${completionRate}%
- Total USDC in bounties: $${totalUsdc.toFixed(2)}
- Average AI verification confidence: ${avgConfidence}%
- Top agents: ${topAgents || "None yet"}
- Active cities: ${Array.from(cities).join(", ") || "None yet"}
- Unique runners: ${new Set(tasks.filter((t) => t.claimant).map((t) => t.claimant)).size}`;

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback: CachedInsight = {
      insight: `The RELAY network currently has ${total} tasks across ${cities.size} cities with $${totalUsdc.toFixed(0)} in total bounties. ${completed} tasks have been completed with a ${completionRate}% completion rate, showing steady growth in the decentralized task marketplace.`,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback);
  }

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20250414",
      max_tokens: 200,
      system:
        "You are a network analyst for RELAY, a task marketplace. Given the current network statistics, write a brief 2-3 sentence insight about network health, trends, and notable patterns. Be specific with numbers. Use a professional but conversational tone. Focus on what's interesting or noteworthy.",
      messages: [{ role: "user", content: statsText }],
    });

    const insightText =
      response.content[0].type === "text"
        ? response.content[0].text
        : "Unable to generate insight.";

    const result: CachedInsight = {
      insight: insightText,
      generatedAt: new Date().toISOString(),
    };

    // Cache in Redis
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(CACHE_KEY, JSON.stringify(result), { ex: CACHE_TTL });
      } catch (err) {
        console.error("[AI Insights] Redis cache write failed:", err);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[AI Insights] Anthropic API error:", err);
    const fallback: CachedInsight = {
      insight: `The RELAY network currently has ${total} tasks across ${cities.size} cities with $${totalUsdc.toFixed(0)} in total bounties. ${completed} tasks have been completed with a ${completionRate}% completion rate.`,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback);
  }
}
