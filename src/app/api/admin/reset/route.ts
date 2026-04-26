import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { resetCache, createTask } from "@/lib/store";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "relay-reset-2026";

const FRESH_TASKS = [
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "photo" as const,
    description: "Photograph the view from your window or balcony — show the Parisian rooftops and skyline",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.50,
    deadlineHours: 12,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "check-in" as const,
    description: "Report the current weather in Paris: temperature, conditions, wind, and how it feels outside. Text description is enough — no photo needed.",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.15,
    deadlineHours: 6,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "photo" as const,
    description: "Find and photograph peonies, roses, or any seasonal spring flowers blooming in Paris",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.25,
    deadlineHours: 24,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "custom" as const,
    description: "Price check: find the cheapest espresso within walking distance and report the café name, exact price, and location",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.20,
    deadlineHours: 12,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "custom" as const,
    description: "Vibe check: rate the nearest café or coworking spot — noise level (1-10), wifi quality, seating availability, and overall vibe",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.30,
    deadlineHours: 12,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "check-in" as const,
    description: "How busy is your nearest metro station right now? Rate crowding 1-10, estimate wait time for next train, note any disruptions",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.20,
    deadlineHours: 6,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "custom" as const,
    description: "Street noise audit: stand outside for 60 seconds and describe what you hear — traffic, birds, construction, people, music. Rate noise 1-10.",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.15,
    deadlineHours: 6,
  },
  {
    poster: "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e",
    category: "custom" as const,
    description: "Find 3 events happening in Paris this weekend. List name, venue, date, and a one-line description for each.",
    location: "Paris, France",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 0.35,
    deadlineHours: 24,
  },
];

export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({ secret: "" }));
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis not available" }, { status: 500 });
  }

  // Flush all task data
  const taskIds = await redis.smembers("task_ids");
  if (taskIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of taskIds) {
      pipeline.del(`task:${id}`);
    }
    pipeline.del("task_ids");
    // Also clear messages and reputation
    for (const id of taskIds) {
      pipeline.del(`messages:${id}`);
    }
    await pipeline.exec();
  }

  // Clear rate limits and insights cache
  await redis.del("ratelimit:verify").catch(() => {});
  await redis.del("ai_insight_cache").catch(() => {});

  // Reset in-memory cache
  resetCache();

  // Create fresh tasks
  const created = FRESH_TASKS.map((t) => createTask(t));

  return NextResponse.json({
    flushed: taskIds.length,
    created: created.length,
    tasks: created.map((t) => ({ id: t.id, description: t.description.slice(0, 60) })),
  });
}
