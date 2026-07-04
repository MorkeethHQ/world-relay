import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/store";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const FUNDED_TASKS = [
  { description: "Review a coffee shop near you. Photo your drink, rate it 1-10, and say if you'd go back.", location: "Any city", category: "review" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 0, escrowTxHash: "0x64fede14d1faf387f87470871b40e50e048e0d297bf5f35e1c0619b323d35594" },
  { description: "Review the last meal you ate out. Photo the food, rate the experience, and share one honest opinion.", location: "Any city", category: "review" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 2, escrowTxHash: "0x7ecc43b2479173c5c6130712ee4b9f7694f582079160518a87ab368e09ee9d28" },
  { description: "Post about RELAY on X or Instagram. Share what you think of the app. Screenshot your post as proof.", location: "Anywhere", category: "social" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 1, escrowTxHash: "0xcef96e6d49e50fcee6dfd5a1e703e14da83ba91e7a6798cbed72e4cf6afbfb05" },
  { description: "Find a cool spot in your city that deserves more attention. Photo it and tell us why it's worth visiting.", location: "Any city", category: "review" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 3, escrowTxHash: "funded" },
  { description: "Try any World App mini app you haven't used before. Screenshot it and share your first impressions.", location: "Anywhere", category: "custom" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 4, escrowTxHash: "funded" },
  { description: "Go to a local store and photo the most interesting product you see. Tell us the price and why it caught your eye.", location: "Any city", category: "check-in" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 5, escrowTxHash: "funded" },
  { description: "Photo your neighbourhood right now. Show us what daily life looks like where you are.", location: "Anywhere", category: "review" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 6, escrowTxHash: "funded" },
  { description: "Write a short review of the World App itself. What do you use most? What's missing?", location: "Anywhere", category: "feedback" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 7, escrowTxHash: "funded" },
  { description: "Share your daily commute in one photo. Where are you going and how? Train, bus, walk, bike?", location: "Anywhere", category: "photo" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 8, escrowTxHash: "funded" },
  { description: "What's the best street food near you? Photo it with the price visible. Tell us if it's worth it.", location: "Any city", category: "review" as const, bountyUsdc: 1.0, deadlineHours: 336, agentId: "relay", onChainId: 9, escrowTxHash: "funded" },
];

const ONBOARDING_TASKS = [
  { description: "Try RELAY Favours and tell us what you think! What's confusing? What's cool? What would you change?", location: "Anywhere", category: "feedback" as const, bountyUsdc: 0.50, deadlineHours: 336, agentId: "relay", maxCompletions: 50 },
  { description: "What favour would you ask someone nearby to do for you right now? Describe the task and how much you'd pay.", location: "Anywhere", category: "feedback" as const, bountyUsdc: 0.50, deadlineHours: 336, agentId: "relay", maxCompletions: 50 },
  { description: "Rate this mini app out of 10. What's your favourite part and your least favourite part? Be brutally honest.", location: "Anywhere", category: "feedback" as const, bountyUsdc: 0.50, deadlineHours: 336, agentId: "relay", maxCompletions: 50 },
];

export async function POST(req: NextRequest) {
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({ secret: "" }));
  const { secret } = body;
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listTasks } = await import("@/lib/store");
  const existing = await listTasks();
  const existingOnChainIds = new Set(existing.filter(t => t.onChainId != null).map(t => t.onChainId));
  const existingDescriptions = new Set(existing.map(t => t.description.slice(0, 80)));

  const created = [];

  // Template-driven batch seeding (scripts/fund-batch.ts): body.tasks replaces
  // the hardcoded lists below. Money rule enforced here too: a task either
  // carries a real escrow funding (onChainId + tx hash) or is points-only —
  // never an unfunded USDC bounty.
  if (Array.isArray(body.tasks)) {
    const CATEGORIES = new Set(["photo", "delivery", "check-in", "custom", "feedback", "review", "social", "errand"]);
    for (const [i, t] of body.tasks.entries()) {
      // A funded seed must carry a REAL on-chain tx hash (0x + 64 hex), not a
      // truthy placeholder like "funded" — otherwise the task passes every
      // truthiness-based funding guard in the app with no on-chain backing.
      const funded = t.onChainId != null && typeof t.escrowTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(t.escrowTxHash);
      const pointsOnly = t.rewardType === "points";
      if (
        typeof t.description !== "string" || !t.description.trim() ||
        typeof t.location !== "string" || !t.location.trim() ||
        !CATEGORIES.has(t.category) ||
        typeof t.deadlineHours !== "number" || t.deadlineHours <= 0 ||
        typeof t.bountyUsdc !== "number" || t.bountyUsdc < 0 ||
        (t.bountyUsdc > 0 && !funded) ||
        (t.bountyUsdc === 0 && !pointsOnly)
      ) {
        return NextResponse.json(
          { error: `Invalid task at index ${i}: USDC tasks need onChainId + escrowTxHash, zero-bounty tasks need rewardType "points"` },
          { status: 400 }
        );
      }
    }

    for (const t of body.tasks) {
      if (t.onChainId != null && existingOnChainIds.has(t.onChainId)) continue;
      if (existingDescriptions.has(t.description.slice(0, 80))) continue;
      const agentId = typeof t.agentId === "string" && t.agentId ? t.agentId : "relay";
      const task = await createTask({
        poster: `agent:${agentId}`,
        category: t.category,
        description: t.description,
        location: t.location,
        bountyUsdc: t.bountyUsdc,
        deadlineHours: t.deadlineHours,
        agentId,
        onChainId: t.onChainId ?? null,
        escrowTxHash: t.escrowTxHash ?? null,
        rewardType: t.rewardType,
        maxCompletions: typeof t.maxCompletions === "number" ? t.maxCompletions : undefined,
        campaignId: typeof t.campaignId === "string" ? t.campaignId : undefined,
      });
      created.push({ id: task.id, description: task.description.slice(0, 60), funded: t.onChainId != null, onChainId: t.onChainId ?? null });
    }
    return NextResponse.json({ seeded: created.length, tasks: created }, { status: 201 });
  }

  for (const t of FUNDED_TASKS) {
    if (existingOnChainIds.has(t.onChainId)) continue;
    const task = await createTask({
      poster: `agent:${t.agentId}`,
      category: t.category,
      description: t.description,
      location: t.location,
      bountyUsdc: t.bountyUsdc,
      deadlineHours: t.deadlineHours,
      agentId: t.agentId,
      onChainId: t.onChainId,
      escrowTxHash: t.escrowTxHash,
    });
    created.push({ id: task.id, description: task.description.slice(0, 60), funded: true, onChainId: t.onChainId });
  }

  for (const t of ONBOARDING_TASKS) {
    if (existingDescriptions.has(t.description.slice(0, 80))) continue;
    const task = await createTask({
      poster: `agent:${t.agentId}`,
      category: t.category,
      description: t.description,
      location: t.location,
      bountyUsdc: t.bountyUsdc,
      deadlineHours: t.deadlineHours,
      agentId: t.agentId,
      maxCompletions: t.maxCompletions,
    });
    created.push({ id: task.id, description: task.description.slice(0, 60), maxCompletions: t.maxCompletions });
  }

  return NextResponse.json({ seeded: created.length, tasks: created }, { status: 201 });
}
