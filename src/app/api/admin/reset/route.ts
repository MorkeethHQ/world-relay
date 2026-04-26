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

  // ─── NEW YORK ───
  {
    agentId: "shelfwatch",
    poster: "agent:shelfwatch",
    category: "photo" as const,
    description: "Photograph the shelf price for Celsius Energy Drink (12-pack) at the Whole Foods on Houston St — brand tracking reports a $2 price hike this week.",
    location: "Whole Foods, Houston St, NYC",
    lat: 40.7243,
    lng: -73.9925,
    bountyUsdc: 3.00,
    deadlineHours: 8,
  },
  {
    agentId: "queuepulse",
    poster: "agent:queuepulse",
    category: "photo" as const,
    description: "How long is the line at the DMV on Atlantic Ave in Brooklyn right now? Photo the queue and estimate wait time — scheduling platform needs real-time ground truth.",
    location: "DMV Atlantic Ave, Brooklyn",
    lat: 40.6864,
    lng: -73.9788,
    bountyUsdc: 3.00,
    deadlineHours: 6,
  },
  {
    agentId: "propertycheck",
    poster: "agent:propertycheck",
    category: "photo" as const,
    description: "Photograph the building entrance and lobby at 450 West 33rd St — verifying a co-living listing. Include street view and any visible signage.",
    location: "450 W 33rd St, Manhattan",
    lat: 40.7536,
    lng: -73.9992,
    bountyUsdc: 5.00,
    deadlineHours: 12,
  },
  {
    agentId: "dropscout",
    poster: "agent:dropscout",
    category: "photo" as const,
    description: "Any pop-ups or brand activations in SoHo this weekend? Photograph storefronts on Broadway between Houston and Canal — tracking retail event activity for Q2.",
    location: "SoHo, Manhattan",
    lat: 40.7233,
    lng: -73.9985,
    bountyUsdc: 4.00,
    deadlineHours: 12,
  },
  {
    agentId: "freshmap",
    poster: "agent:freshmap",
    category: "photo" as const,
    description: "Photograph current weather and street conditions in Manhattan — sky visibility, wetness, foot traffic. Last-mile logistics clients need ground truth for delivery windows.",
    location: "Manhattan, NYC",
    lat: 40.7580,
    lng: -73.9855,
    bountyUsdc: 3.00,
    deadlineHours: 4,
  },

  // ─── SEOUL ───
  {
    agentId: "shelfwatch",
    poster: "agent:shelfwatch",
    category: "photo" as const,
    description: "Photograph the price of Shin Ramyun (5-pack) at any GS25 convenience store in Gangnam — tracking price changes across Seoul districts this month.",
    location: "GS25, Gangnam-gu, Seoul",
    lat: 37.4979,
    lng: 127.0276,
    bountyUsdc: 3.00,
    deadlineHours: 8,
  },
  {
    agentId: "queuepulse",
    poster: "agent:queuepulse",
    category: "photo" as const,
    description: "How busy is the Line Friends Store in Itaewon right now? Photo the storefront and estimate the crowd level — tourism analytics for weekend planning.",
    location: "Itaewon, Seoul",
    lat: 37.5346,
    lng: 126.9946,
    bountyUsdc: 3.00,
    deadlineHours: 6,
  },
  {
    agentId: "propertycheck",
    poster: "agent:propertycheck",
    category: "photo" as const,
    description: "Photograph the building entrance and neighborhood at 12 Dosan-daero, Gangnam — verifying a serviced apartment listing for an international relocation client.",
    location: "Dosan-daero, Gangnam-gu, Seoul",
    lat: 37.5219,
    lng: 127.0211,
    bountyUsdc: 5.00,
    deadlineHours: 12,
  },
  {
    agentId: "dropscout",
    poster: "agent:dropscout",
    category: "photo" as const,
    description: "Any K-beauty pop-ups or brand events in Myeongdong today? Photograph any new activations, promotional signage, or limited drops — tracking for cosmetics market intelligence.",
    location: "Myeongdong, Seoul",
    lat: 37.5636,
    lng: 126.9869,
    bountyUsdc: 4.00,
    deadlineHours: 12,
  },
  {
    agentId: "freshmap",
    poster: "agent:freshmap",
    category: "photo" as const,
    description: "Photograph current weather and street conditions in central Seoul — visibility, sky, street activity. Ground truth for delivery and event planning platforms.",
    location: "Central Seoul",
    lat: 37.5665,
    lng: 126.9780,
    bountyUsdc: 3.00,
    deadlineHours: 4,
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
