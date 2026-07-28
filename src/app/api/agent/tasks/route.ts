import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";
import { checkAgentAuth } from "@/lib/api-keys";
import { toApiTask } from "@/lib/task-serializer";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { CUSTODY_RETIRED } from "@/lib/custody";

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
  const auth = await checkAgentAuth(req);
  if (!isInAppRequest(req) && !auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") || "open";
  const agentId = url.searchParams.get("agent_id") || null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const allTasks = await listTasks();

  // Filter by status
  let filtered = allTasks;
  if (statusFilter !== "all") {
    filtered = filtered.filter((t) => t.status === statusFilter);
  }

  // Filter by agent_id (poster matches agent_<id> or agent:<id>)
  if (agentId) {
    filtered = filtered.filter(
      (t) => t.poster === `agent_${agentId}` || t.poster === `agent:${agentId}`
    );
  }

  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    tasks: paged.map((t) => {
      const base: Record<string, unknown> = {
        id: t.id,
        description: t.description,
        location: t.location,
        lat: t.lat,
        lng: t.lng,
        bountyUsdc: t.bountyUsdc,
        deadline: t.deadline,
        status: t.status,
        createdAt: t.createdAt,
      };

      // Include extra fields for completed/failed tasks
      if (t.status === "completed" || t.status === "failed") {
        base.claimant = t.claimant;
        base.proofImageUrl = toApiTask(t).proofImageUrl;
        base.attestationTxHash = t.attestationTxHash;
        if (t.verificationResult) {
          base.verificationResult = {
            verdict: t.verificationResult.verdict,
            confidence: t.verificationResult.confidence,
          };
        }
      }

      return base;
    }),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await checkAgentAuth(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized", hint: "Pass your API key as: Authorization: Bearer <key>" }, { status: 401 });
  }

  // Custody retired: any escrow funding / binding request is gone. Checked after
  // auth (API key required) but before rate-limit / createTask. createEscrowTaskWithKey
  // is also gated; this route must not advertise fund_url / escrow_contract or
  // store a USDC task waiting for human funding that the UI can no longer honour.
  const body = await req.json();
  const { fund, escrow_tx_hash, on_chain_id } = body;
  if (CUSTODY_RETIRED && (fund || escrow_tx_hash || on_chain_id != null)) {
    return NextResponse.json({
      error: "Custody retired",
      detail: "FAVOUR no longer holds funds in escrow. Post a points favour (omit fund / escrow_tx_hash / on_chain_id) or use campaign unlock for USDC.",
    }, { status: 410 });
  }

  // Rate limit: 30 tasks per hour per IP
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`agent-create:${ip}`, 30, 3_600_000);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded. Max 30 tasks per hour." }, { status: 429 });
  }

  const { agent_id, lat, lng, bounty_usdc, deadline_hours, callback_url, recurring_hours, recurring_count } = body;

  // Sanitize text inputs
  const description = sanitizeInput(body.description || "", 500);
  const location = sanitizeInput(body.location || "", 200);

  if (!description || !location || bounty_usdc == null) {
    return NextResponse.json({
      error: "Missing required fields",
      required: ["description", "location", "bounty_usdc"],
      optional: ["agent_id", "lat", "lng", "deadline_hours", "callback_url"],
      note: CUSTODY_RETIRED
        ? "Points only. bounty_usdc is a points value (1–10). Escrow funding is retired."
        : undefined,
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

  const points = Number(bounty_usdc);
  if (!Number.isFinite(points) || points < 1 || points > 10) {
    return NextResponse.json({
      error: "Points favours must be between 1 and 10 points.",
    }, { status: 400 });
  }

  const agentId = agent_id || null;
  const poster = agentId ? `agent_${agentId}` : `agent_${crypto.randomUUID().slice(0, 8)}`;

  const task = await createTask({
    poster,
    description,
    location,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    bountyUsdc: points,
    deadlineHours: Number(deadline_hours) || 24,
    agentId,
    recurring: recurring_hours ? { intervalHours: Number(recurring_hours), totalRuns: Number(recurring_count) || 7 } : null,
    callbackUrl: callback_url || null,
    onChainId: null,
    escrowTxHash: null,
    rewardType: "points",
  });

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
      rewardType: "points",
      deadline: task.deadline,
      status: task.status,
      onChainId: null,
      escrowTxHash: null,
    },
    funding: {
      method: "points",
      funded: false,
      message: "Points favour posted. Escrow funding is retired — campaign USDC is paid by direct transfer, not via this API.",
    },
    ...(callback_url ? { callback_url_registered: true } : {}),
  }, { status: 201 });
}
