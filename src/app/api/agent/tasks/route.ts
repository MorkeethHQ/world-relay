import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks, getTask } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";
import { createEscrowTaskWithKey } from "@/lib/escrow";
import { getRedis } from "@/lib/redis";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

function checkAuth(req: NextRequest): boolean {
  if (!AGENT_API_KEY) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === AGENT_API_KEY;
}

function getAgentWalletKey(agentId: string): string | null {
  const envKey = `AGENT_WALLET_${agentId.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey] || null;
}

function isInAppRequest(req: NextRequest): boolean {
  const host = req.headers.get("host") || "";
  if (!host) return false;
  const origin = req.headers.get("origin") || "";
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer") || "";
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!isInAppRequest(req) && !checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await listTasks();
  const openTasks = tasks.filter((t) => t.status === "open");

  return NextResponse.json({
    tasks: openTasks.map((t) => ({
      id: t.id,
      description: t.description,
      location: t.location,
      lat: t.lat,
      lng: t.lng,
      bountyUsdc: t.bountyUsdc,
      deadline: t.deadline,
      status: t.status,
      createdAt: t.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!isInAppRequest(req) && !checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { agent_id, description, location, lat, lng, bounty_usdc, deadline_hours, callback_url, recurring_hours, recurring_count } = body;

  // Funding method (pick one or none):
  // A) "escrow_tx_hash" + "on_chain_id" — agent funded it themselves on-chain
  // B) "fund": true — use agent's registered wallet (env var)
  // C) Neither — task posted unfunded, humans can fund via World App
  const { fund, escrow_tx_hash, on_chain_id } = body;

  if (!description || !location || !bounty_usdc) {
    return NextResponse.json({
      error: "Missing required fields",
      required: ["description", "location", "bounty_usdc"],
      optional: ["agent_id", "lat", "lng", "deadline_hours", "callback_url", "fund", "escrow_tx_hash", "on_chain_id"],
      funding_methods: {
        self_funded: "Pass escrow_tx_hash + on_chain_id after calling RelayEscrow.createTask() yourself",
        registered_wallet: "Pass fund=true (requires AGENT_WALLET_<ID> env var on server)",
        human_funded: "Pass nothing — task shows 'needs funding' and any human can fund it via World App",
      },
    }, { status: 400 });
  }

  if (callback_url) {
    try {
      const cbUrl = new URL(callback_url);
      if (cbUrl.protocol !== "https:") {
        return NextResponse.json({ error: "callback_url must use HTTPS" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid callback_url" }, { status: 400 });
    }
  }

  const agentId = agent_id || null;
  const poster = agentId ? `agent_${agentId}` : `agent_${crypto.randomUUID().slice(0, 8)}`;

  // Determine funding
  let onChainId: number | null = null;
  let escrowTxHash: string | null = null;
  let fundingMethod: "self" | "wallet" | "human" = "human";

  // Path A: Agent already funded on-chain — verify the tx exists
  if (escrow_tx_hash && on_chain_id != null) {
    onChainId = Number(on_chain_id);
    escrowTxHash = escrow_tx_hash;
    fundingMethod = "self";
  }
  // Path B: Fund from registered agent wallet
  else if (fund) {
    const walletKey = getAgentWalletKey(agentId || "default");
    if (!walletKey) {
      return NextResponse.json({
        error: `No wallet registered for agent "${agentId}"`,
        hint: `Set AGENT_WALLET_${(agentId || "DEFAULT").toUpperCase().replace(/-/g, "_")} on the server, OR fund the task yourself and pass escrow_tx_hash`,
        alternatives: {
          self_fund: `Call RelayEscrow.createTask("${description.slice(0, 50)}...", ${Number(bounty_usdc) * 1e6}, deadline) at ${process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0xc976e463bD209E09cb15a168A275890b872AA1F0"}`,
          human_fund: "Remove fund=true and a human will fund it from the World App",
        },
      }, { status: 400 });
    }

    const escrowResult = await createEscrowTaskWithKey(
      walletKey,
      description,
      Number(bounty_usdc),
      Number(deadline_hours) || 24,
    );

    if (!escrowResult) {
      return NextResponse.json({
        error: "Agent wallet funding failed — likely insufficient USDC",
        hint: "Send USDC to the agent wallet on World Chain (chainId 480)",
      }, { status: 400 });
    }

    onChainId = escrowResult.onChainId;
    escrowTxHash = escrowResult.txHash;
    fundingMethod = "wallet";
  }
  // Path C: No funding — human will fund later

  const task = createTask({
    poster,
    description,
    location,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    bountyUsdc: Number(bounty_usdc),
    deadlineHours: Number(deadline_hours) || 24,
    agentId,
    recurring: recurring_hours ? { intervalHours: Number(recurring_hours), totalRuns: Number(recurring_count) || 7 } : null,
    callbackUrl: callback_url || null,
    onChainId,
    escrowTxHash,
  });

  if (escrowTxHash) {
    const redis = getRedis();
    if (redis) {
      await redis.set(`task:${task.id}`, JSON.stringify(task));
    }
  }

  // Post task creation to XMTP thread
  postTaskCreated(task).catch(console.error);

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, agentId || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", briefing);
  }).catch(console.error);

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
      poster: task.poster,
      description: task.description,
      location: task.location,
      bountyUsdc: task.bountyUsdc,
      deadline: task.deadline,
      status: task.status,
      onChainId: task.onChainId,
      escrowTxHash: task.escrowTxHash,
    },
    funding: {
      method: fundingMethod,
      funded: !!escrowTxHash,
      escrowTxHash,
      onChainId,
      ...(fundingMethod === "human" ? {
        message: "Task posted — waiting for a human to fund it via World App",
        fund_url: `https://world-relay.vercel.app/task/${task.id}`,
      } : {
        message: `Task funded with $${bounty_usdc} USDC on-chain`,
      }),
    },
    escrow_contract: process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0xc976e463bD209E09cb15a168A275890b872AA1F0",
    ...(callback_url ? { callback_url_registered: true } : {}),
  }, { status: 201 });
}
