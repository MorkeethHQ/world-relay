import { NextRequest, NextResponse } from "next/server";
import { createTask, hasAgentTasks } from "@/lib/store";
import { SEED_TASKS } from "@/lib/agents";

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "true";
  if (!force) {
    const alreadySeeded = await hasAgentTasks();
    if (alreadySeeded) {
      return NextResponse.json({ seeded: 0, message: "Already seeded" });
    }
  }

  let count = 0;
  for (const seed of SEED_TASKS) {
    createTask({
      poster: `agent_${seed.agentId}`,
      category: seed.category,
      description: seed.description,
      location: seed.location,
      lat: seed.lat,
      lng: seed.lng,
      bountyUsdc: seed.bountyUsdc,
      deadlineHours: seed.deadlineHours,
      agentId: seed.agentId,
      recurring: seed.recurring || null,
    });
    count++;
  }

  return NextResponse.json({ seeded: count, message: `Seeded ${count} demo tasks` });
}
