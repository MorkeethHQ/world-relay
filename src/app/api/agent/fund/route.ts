import { NextRequest, NextResponse } from "next/server";
import { getAgentBalance, createAgentTask, isAgentEscrowEnabled, encodeAgentDeposit } from "@/lib/agent-escrow";
import { createTask } from "@/lib/store";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";
import { getRedis } from "@/lib/redis";
import { checkAgentAuth } from "@/lib/api-keys";

// GET /api/agent/fund — check agent's deposited balance
export async function GET(req: NextRequest) {
  const auth = await checkAgentAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAgentEscrowEnabled()) {
    return NextResponse.json({
      enabled: false,
      message: "Agent escrow V2 not deployed yet. Set NEXT_PUBLIC_AGENT_ESCROW_ADDRESS after deploying RelayAgentEscrow.sol",
    });
  }

  const agentWallet = req.nextUrl.searchParams.get("wallet") as `0x${string}` | null;
  if (!agentWallet) {
    return NextResponse.json({ error: "Pass ?wallet=0x... to check balance" }, { status: 400 });
  }

  const stats = await getAgentBalance(agentWallet);

  return NextResponse.json({
    enabled: true,
    wallet: agentWallet,
    balance: stats?.balance || "0",
    totalDeposited: stats?.deposited || "0",
    totalSpent: stats?.spent || "0",
    howToDeposit: "Call USDC.approve(agentEscrow, amount) then AgentEscrow.deposit(amount) from your agent wallet",
  });
}

// POST /api/agent/fund — create a task funded from agent's deposited balance
export async function POST(req: NextRequest) {
  const auth = await checkAgentAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAgentEscrowEnabled()) {
    return NextResponse.json({
      error: "Agent escrow V2 not deployed",
      hint: "Deploy RelayAgentEscrow.sol and set NEXT_PUBLIC_AGENT_ESCROW_ADDRESS",
    }, { status: 503 });
  }

  const body = await req.json();
  const { agent_wallet, agent_id, description, location, bounty_usdc, deadline_hours, callback_url } = body;

  if (!agent_wallet || !description || !location || !bounty_usdc) {
    return NextResponse.json({
      error: "Missing required fields",
      required: ["agent_wallet", "description", "location", "bounty_usdc"],
      optional: ["agent_id", "deadline_hours", "callback_url"],
    }, { status: 400 });
  }

  // Create on-chain task from agent's deposited balance
  const escrowResult = await createAgentTask(
    agent_wallet as `0x${string}`,
    description,
    Number(bounty_usdc),
    Number(deadline_hours) || 24,
  );

  if (!escrowResult) {
    const stats = await getAgentBalance(agent_wallet as `0x${string}`);
    return NextResponse.json({
      error: "Failed to fund task — check agent balance",
      currentBalance: stats?.balance || "0",
      needed: bounty_usdc,
      hint: "Deposit more USDC: approve + deposit on the AgentEscrow contract",
    }, { status: 400 });
  }

  // Create in-app task record
  const agentId = agent_id || null;
  const poster = agentId ? `agent_${agentId}` : `agent_${agent_wallet.slice(2, 10)}`;

  const task = await createTask({
    poster,
    description,
    location,
    lat: null,
    lng: null,
    bountyUsdc: Number(bounty_usdc),
    deadlineHours: Number(deadline_hours) || 24,
    agentId,
    callbackUrl: callback_url || null,
    onChainId: escrowResult.onChainId,
    escrowTxHash: escrowResult.txHash,
  });

  const redis = getRedis();
  if (redis) {
    await redis.set(`task:${task.id}`, JSON.stringify(task));
  }

  postTaskCreated(task).catch(console.error);

  broadcastEvent("task:created", {
    taskId: task.id,
    description: task.description.slice(0, 60),
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    status: task.status,
    agentName: task.agent?.name,
    timestamp: task.createdAt,
  });

  return NextResponse.json({
    task: {
      id: task.id,
      description: task.description,
      bountyUsdc: task.bountyUsdc,
      status: task.status,
      onChainId: escrowResult.onChainId,
      escrowTxHash: escrowResult.txHash,
    },
    funded: true,
    message: `Task funded with $${bounty_usdc} from agent balance.`,
  }, { status: 201 });
}
