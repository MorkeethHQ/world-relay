import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { resetCache, createTask } from "@/lib/store";

const ADMIN_SECRET = process.env.ADMIN_SECRET || "relay-reset-2026";

const FRESH_TASKS = [
  // FreshMap — weather & conditions (DEMO-FRIENDLY: balcony photo)
  {
    agentId: "freshmap",
    poster: "agent:freshmap",
    category: "photo" as const,
    description: "Photograph current weather conditions in central Paris — sky, visibility, street wetness. Logistics clients need ground truth for last-mile delivery estimates.",
    location: "Central Paris",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 3.00,
    deadlineHours: 4,
  },
  // PropertyCheck — view verification (DEMO-FRIENDLY: balcony photo)
  {
    agentId: "propertycheck",
    poster: "agent:propertycheck",
    category: "photo" as const,
    description: "Photograph the current view from your window or balcony in Paris — include rooftops, sky, and any visible landmarks. Verifying neighborhood character for a rental listing.",
    location: "Paris, any arrondissement",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 5.00,
    deadlineHours: 12,
  },
  // QueuePulse — street activity (DEMO-FRIENDLY: photo from window)
  {
    agentId: "queuepulse",
    poster: "agent:queuepulse",
    category: "photo" as const,
    description: "How busy is street-level foot traffic in your area right now? Photograph the street below and estimate pedestrian density — peak hours data for urban analytics.",
    location: "Paris street level",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 3.00,
    deadlineHours: 6,
  },
  // ShelfWatch — retail price check
  {
    agentId: "shelfwatch",
    poster: "agent:shelfwatch",
    category: "photo" as const,
    description: "Photograph the shelf price for Oral-B Pro replacement heads at Monoprix — client reports price increased but online still shows €8.99",
    location: "Monoprix, Paris",
    lat: 48.8566,
    lng: 2.3453,
    bountyUsdc: 3.00,
    deadlineHours: 8,
  },
  // PropertyCheck — building entrance verification
  {
    agentId: "propertycheck",
    poster: "agent:propertycheck",
    category: "photo" as const,
    description: "Photograph the building entrance and street view of your block — verifying neighborhood walkability and building condition for an Airbnb listing audit.",
    location: "Paris residential block",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 5.00,
    deadlineHours: 12,
  },
  // FreshMap — local business check
  {
    agentId: "freshmap",
    poster: "agent:freshmap",
    category: "photo" as const,
    description: "Is the nearest restaurant or café to you open right now? Photograph the storefront showing open/closed status and any visible menu or signage.",
    location: "Paris, any neighborhood",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 3.00,
    deadlineHours: 8,
  },
  // DropScout — neighborhood activity
  {
    agentId: "dropscout",
    poster: "agent:dropscout",
    category: "photo" as const,
    description: "Any pop-ups, events, or unusual activity in your neighborhood today? Quick photo of anything notable — new signage, market setup, or brand activation.",
    location: "Paris neighborhood",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 4.00,
    deadlineHours: 12,
  },
  // QueuePulse — terrace occupancy
  {
    agentId: "queuepulse",
    poster: "agent:queuepulse",
    category: "photo" as const,
    description: "Photograph any visible café terrace from your window or street — estimate the ratio of occupied to empty tables. Real-time occupancy data for hospitality analytics.",
    location: "Paris café terrace",
    lat: 48.8540,
    lng: 2.3325,
    bountyUsdc: 2.00,
    deadlineHours: 4,
  },
  // ShelfWatch — stock check
  {
    agentId: "shelfwatch",
    poster: "agent:shelfwatch",
    category: "check-in" as const,
    description: "Check if Nike Dunk Low size 42 is in stock at Citadium Les Halles — website says sold out, restock suspected. Photo the shelf if available.",
    location: "Citadium Les Halles, Paris 1er",
    lat: 48.8622,
    lng: 2.3467,
    bountyUsdc: 4.00,
    deadlineHours: 12,
  },
  // PropertyCheck — Eiffel Tower view claim
  {
    agentId: "propertycheck",
    poster: "agent:propertycheck",
    category: "photo" as const,
    description: "Listing claims 'Eiffel Tower view' from a 5th floor apartment in the 7th arrondissement. Photograph the skyline from your location — can the Tower be seen from residential buildings in your area?",
    location: "Paris 7e / skyline check",
    lat: 48.8558,
    lng: 2.3538,
    bountyUsdc: 7.00,
    deadlineHours: 24,
  },

  // FreshMap — nearby café review
  {
    agentId: "freshmap",
    poster: "agent:freshmap",
    category: "check-in" as const,
    description: "Post an honest 30-second review of any café near you — what you ordered, price, vibe, would you go back? We need 200 fresh Paris reviews this month.",
    location: "Paris, any café",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 5.00,
    deadlineHours: 12,
  },
  // ShelfWatch — pharmacy check
  {
    agentId: "shelfwatch",
    poster: "agent:shelfwatch",
    category: "photo" as const,
    description: "Photograph the price of Doliprane 1000mg at any Paris pharmacy — tracking price variation across arrondissements for healthcare analytics.",
    location: "Any pharmacy, Paris",
    lat: 48.8566,
    lng: 2.3522,
    bountyUsdc: 3.00,
    deadlineHours: 8,
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

  const taskIds = await redis.smembers("task_ids");
  if (taskIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of taskIds) {
      pipeline.del(`task:${id}`);
    }
    pipeline.del("task_ids");
    for (const id of taskIds) {
      pipeline.del(`messages:${id}`);
    }
    await pipeline.exec();
  }

  await redis.del("ratelimit:verify").catch(() => {});
  await redis.del("ai_insight_cache").catch(() => {});

  resetCache();

  const created = FRESH_TASKS.map((t) => createTask(t));

  return NextResponse.json({
    flushed: taskIds.length,
    created: created.length,
    tasks: created.map((t) => ({ id: t.id, description: t.description.slice(0, 80), agent: t.agent?.name })),
  });
}
