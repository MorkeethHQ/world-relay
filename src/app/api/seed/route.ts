import { NextRequest, NextResponse } from "next/server";
import { createTask, hasAgentTasks, seedTask } from "@/lib/store";
import { SEED_TASKS, COMPLETED_TASK_EXAMPLES, getAgent } from "@/lib/agents";
import { getEscrowState, createEscrowTask } from "@/lib/escrow";
import { addMessage } from "@/lib/messages";
import type { Task } from "@/lib/types";

const LIVE_ESCROW_TASKS = [
  {
    onChainId: 6,
    escrowTxHash: "0xdbd4462ae39c618edae731524ae034842d98b35cffd2a45a95af324d45f6b406",
    description: "Photo the nearest cafe or restaurant entrance. Include the name and any visible menu or hours.",
    location: "Your current location",
    category: "photo" as const,
    bountyUsdc: 0.25,
    deadlineHours: 72,
    agentId: "pricehawk",
  },
  {
    onChainId: 7,
    escrowTxHash: "0x32af60ab66a0c10dd032c779512dd75ea8f6d43e8e17944d54d487834a64f48c",
    description: "Photograph the closest traffic light or pedestrian crossing from where you are right now.",
    location: "Your current location",
    category: "photo" as const,
    bountyUsdc: 0.25,
    deadlineHours: 72,
    agentId: "freshmap",
  },
  {
    onChainId: 8,
    escrowTxHash: "0x935f1279c7e9240b78f36441a6d73d064dfc3e8e85fff43c8fa178797c19486d",
    description: "Take a photo of the view from your current window or balcony. Include sky and at least one building.",
    location: "Your current location",
    category: "photo" as const,
    bountyUsdc: 0.25,
    deadlineHours: 72,
    agentId: "claimseye",
  },
  {
    onChainId: 9,
    escrowTxHash: "0x90217ddc54fd6eda2dcb8c0863bcdde4899f43dc2c0b8b0707a63859fa3f0f41",
    description: "Photo a public bench, bus stop, or seating area near you. Show its current condition.",
    location: "Your current location",
    category: "check-in" as const,
    bountyUsdc: 0.25,
    deadlineHours: 72,
    agentId: "accessmap",
  },
  {
    onChainId: 10,
    escrowTxHash: "0x7ac150ffacfcf801034b0918c7711782500ef74f95d63c3cfe48ed925af27af4",
    description: "Photograph the nearest park, garden, or green space entrance. Include any signage.",
    location: "Your current location",
    category: "photo" as const,
    bountyUsdc: 0.25,
    deadlineHours: 72,
    agentId: "greenaudit",
  },
];

export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "true";
  const judgeOnly = req.nextUrl.searchParams.get("judges") === "true";

  if (!force && !judgeOnly) {
    const alreadySeeded = await hasAgentTasks();
    if (alreadySeeded) {
      return NextResponse.json({ seeded: 0, message: "Already seeded" });
    }
  }

  const results: { id: string; description: string; onChainId: number | null; escrowTxHash: string | null }[] = [];

  if (!judgeOnly) {
    for (const seed of SEED_TASKS) {
      const task = createTask({
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
      results.push({ id: task.id, description: seed.description.slice(0, 50), onChainId: null, escrowTxHash: null });
    }
  }

  // Judge bounty — restricted with claim code, $1 USDC on-chain
  const judgeTask = createTask({
    poster: "agent_claimseye",
    category: "photo",
    description: "Prove you are a real human: take a selfie with your World ID orb verification visible on screen. First verified claim wins $1 USDC.",
    location: "World Build 3 — Hackathon Venue",
    bountyUsdc: 1,
    deadlineHours: 168,
    agentId: "claimseye",
    onChainId: 11,
    escrowTxHash: "0x3c2cd8a93e01fb535352488f0f2a58147d696e31d9c79d8c552e137d6c25596a",
    claimCode: "WORLDBUILD3",
  });
  results.push({ id: judgeTask.id, description: "Judge bounty ($1 USDC, code-gated)", onChainId: 11, escrowTxHash: judgeTask.escrowTxHash });

  // Create tasks with pre-funded on-chain escrow
  const escrowResults: typeof results = [];
  for (const et of LIVE_ESCROW_TASKS) {
    const task = createTask({
      poster: `agent_${et.agentId}`,
      category: et.category,
      description: et.description,
      location: et.location,
      bountyUsdc: et.bountyUsdc,
      deadlineHours: et.deadlineHours,
      agentId: et.agentId,
      onChainId: et.onChainId,
      escrowTxHash: et.escrowTxHash,
    });

    escrowResults.push({
      id: task.id,
      description: et.description.slice(0, 60),
      onChainId: et.onChainId,
      escrowTxHash: et.escrowTxHash,
    });
  }

  // Auto-create one on-chain escrow task so judges see a real contract TX on World Chain explorer
  let newEscrowTask: { id: string; onChainId: number; txHash: string } | null = null;
  try {
    const onChainResult = await createEscrowTask(
      "Photograph any street art or mural in your city. Include the full piece and surrounding context.",
      0.25,
      168 // 1 week deadline
    );
    if (onChainResult) {
      const task = createTask({
        poster: "agent_claimseye",
        category: "photo",
        description: "Photograph any street art or mural in your city. Include the full piece and surrounding context.",
        location: "Any city — NYC, Seoul, Paris, or anywhere",
        bountyUsdc: 0.25,
        deadlineHours: 168,
        agentId: "claimseye",
        onChainId: onChainResult.onChainId,
        escrowTxHash: onChainResult.txHash,
      });
      newEscrowTask = { id: task.id, onChainId: onChainResult.onChainId, txHash: onChainResult.txHash };
    }
  } catch (err) {
    console.error("[Seed] On-chain escrow task failed:", err);
  }

  // ── Completed Demo Task ───────────────────────────────────────────────
  // Seeds the QueueWatch Louvre task that has gone through the full lifecycle:
  // posted → claimed → proof submitted → verified → payment released.
  // This proves the entire RELAY pipeline works end-to-end for judges.
  const COMPLETED_DEMO_ID = "completed-louvre-queue";
  const completedExample = COMPLETED_TASK_EXAMPLES[0];
  const completedDemoAgent = getAgent(completedExample.agentId)!;

  const completedTask: Task = {
    id: COMPLETED_DEMO_ID,
    poster: `agent_${completedExample.agentId}`,
    claimant: completedExample.claimant,
    category: completedExample.category,
    description: completedExample.description,
    location: completedExample.location,
    lat: completedExample.lat,
    lng: completedExample.lng,
    bountyUsdc: completedExample.bountyUsdc,
    deadline: new Date(Date.now() + 6 * 3600_000).toISOString(),
    status: "completed",
    proofImageUrl: completedExample.proofImageUrl,
    proofImages: completedExample.proofImageUrl ? [completedExample.proofImageUrl] : null,
    proofNote: null,
    verificationResult: completedExample.verificationResult,
    attestationTxHash: null,
    agent: completedDemoAgent,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: 5,
    escrowTxHash: completedExample.escrowTxHash,
    claimCode: null,
    claimantVerification: completedExample.claimantVerificationLevel as "device",
    createdAt: new Date(Date.now() - 8 * 3600_000).toISOString(), // posted 8 hours ago
  };

  seedTask(completedTask);

  // Seed World Chat messages showing the full lifecycle conversation
  for (const msg of completedExample.worldChatMessages) {
    const sender = msg.sender === "claimant" ? completedExample.claimant : msg.sender;
    await addMessage(COMPLETED_DEMO_ID, sender, msg.text);
  }

  const escrowState = await getEscrowState().catch(() => null);

  return NextResponse.json({
    seeded: results.length,
    completedDemo: COMPLETED_DEMO_ID,
    escrowTasks: escrowResults,
    newEscrowTask,
    escrow: escrowState,
    message: `Seeded ${results.length} agent tasks + ${escrowResults.length} live escrow tasks + 1 completed demo task with real USDC on World Chain`,
  });
}
