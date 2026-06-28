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

  const { secret } = await req.json().catch(() => ({ secret: "" }));
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listTasks } = await import("@/lib/store");
  const existing = await listTasks();
  const existingOnChainIds = new Set(existing.filter(t => t.onChainId != null).map(t => t.onChainId));
  const existingDescriptions = new Set(existing.map(t => t.description.slice(0, 80)));

  const created = [];

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
