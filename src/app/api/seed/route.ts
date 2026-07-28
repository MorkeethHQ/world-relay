import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/store";
import { CUSTODY_RETIRED } from "@/lib/custody";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Legacy hardcoded funded seeds were removed: several carried a placeholder
// escrowTxHash ("funded") that passed truthiness funding guards with no on-chain
// backing (Inv 3). Funded seeding now goes ONLY through the batch path below
// (body.tasks → isEscrowTaskFunded verification). Points onboarding seeds are safe.
// With CUSTODY_RETIRED, the funded batch path is closed — ops scripts that still
// deposit on-chain must not bind those deposits into the app.
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
      if (CUSTODY_RETIRED && funded) {
        return NextResponse.json({
          error: "Custody retired",
          detail: `Funded seed at index ${i} rejected. Points-only seeds are still allowed.`,
        }, { status: 410 });
      }
      const pointsOnly = t.rewardType === "points";
      // Points tasks carry a points VALUE in bountyUsdc (0-10, never funded); USDC
      // tasks must be escrow-funded. Points and money never cross (Inv 1/3).
      const validPoints = pointsOnly && t.bountyUsdc >= 0 && t.bountyUsdc <= 10;
      const validUsdc = !CUSTODY_RETIRED && !pointsOnly && t.bountyUsdc > 0 && funded;
      if (
        typeof t.description !== "string" || !t.description.trim() ||
        typeof t.location !== "string" || !t.location.trim() ||
        !CATEGORIES.has(t.category) ||
        typeof t.deadlineHours !== "number" || t.deadlineHours <= 0 ||
        typeof t.bountyUsdc !== "number" ||
        !(validPoints || validUsdc)
      ) {
        return NextResponse.json(
          { error: `Invalid task at index ${i}: USDC tasks need onChainId + escrowTxHash; points tasks need rewardType "points" and value 0-10` },
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
      // Onboarding seeds are engagement, never money — mark them points so they
      // don't render as an unfunded "$ USDC" badge (rewardType defaults to usdc).
      rewardType: "points",
    });
    created.push({ id: task.id, description: task.description.slice(0, 60), maxCompletions: t.maxCompletions });
  }

  return NextResponse.json({ seeded: created.length, tasks: created }, { status: 201 });
}
