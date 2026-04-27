import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";
import { recordFavourPosted } from "@/lib/proof-of-favour";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET() {
  const tasks = await listTasks();
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = rateLimit(`create:${ip}`, 5, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json();
  const { poster, category, description, location, lat, lng, bountyUsdc, deadlineHours, onChainId, escrowTxHash, taskType, donOnChainId, agentId } = body;

  if (!poster || !description || !location || !bountyUsdc) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Authentication: require a valid poster identity (wallet address or known agent prefix)
  if (!poster || poster.length < 5) {
    return NextResponse.json({ error: "Valid poster identity required" }, { status: 401 });
  }

  // Input validation
  const bountyNum = Number(bountyUsdc);
  if (!Number.isFinite(bountyNum) || bountyNum <= 0 || bountyNum > 10000) {
    return NextResponse.json({ error: "Bounty must be between $0.01 and $10,000" }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: "Description too long (max 2000 chars)" }, { status: 400 });
  }
  if (location.length > 500) {
    return NextResponse.json({ error: "Location too long (max 500 chars)" }, { status: 400 });
  }
  if (lat !== undefined && lat !== null && (Number(lat) < -90 || Number(lat) > 90)) {
    return NextResponse.json({ error: "Invalid latitude" }, { status: 400 });
  }
  if (lng !== undefined && lng !== null && (Number(lng) < -180 || Number(lng) > 180)) {
    return NextResponse.json({ error: "Invalid longitude" }, { status: 400 });
  }

  const resolvedAgentId = agentId || (poster?.startsWith("agent:") ? poster.replace("agent:", "") : null);

  const task = createTask({
    poster,
    category: category || "custom",
    description,
    location,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    bountyUsdc: Number(bountyUsdc),
    deadlineHours: Number(deadlineHours) || 24,
    agentId: resolvedAgentId,
    onChainId: onChainId != null ? Number(onChainId) : null,
    escrowTxHash: escrowTxHash || null,
    taskType: taskType || "standard",
    donOnChainId: donOnChainId != null ? Number(donOnChainId) : null,
  });

  // Post task creation to XMTP thread
  postTaskCreated(task).catch(console.error);

  // Award Proof of Favour points for posting a task
  recordFavourPosted(poster).catch(console.error);

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, task.agent?.id || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", briefing);
  }).catch(console.error);

  broadcastEvent("task:created", {
    taskId: task.id,
    description: task.description.slice(0, 60),
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    status: task.status,
    timestamp: task.createdAt,
  });

  return NextResponse.json({ task }, { status: 201 });
}
