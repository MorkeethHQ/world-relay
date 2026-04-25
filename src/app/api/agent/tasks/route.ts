import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

function checkAuth(req: NextRequest): boolean {
  if (!AGENT_API_KEY) return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === AGENT_API_KEY;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
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
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { agent_id, description, location, lat, lng, bounty_usdc, deadline_hours, callback_url, recurring_hours, recurring_count } = body;

  if (!description || !location || !bounty_usdc) {
    return NextResponse.json({
      error: "Missing required fields",
      required: ["description", "location", "bounty_usdc"],
      optional: ["agent_id", "lat", "lng", "deadline_hours", "callback_url", "recurring_hours", "recurring_count"],
    }, { status: 400 });
  }

  const agentId = agent_id || null;
  const poster = agentId ? `agent_${agentId}` : `agent_${crypto.randomUUID().slice(0, 8)}`;

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
  });

  // Post task creation to XMTP thread
  postTaskCreated(task).catch(console.error);

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, agentId || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", "🗺️ AI SCOUT BRIEFING\n━━━━━━━━━━━━━━━━━━\n" + briefing + "\n\nThis briefing was auto-generated for potential claimants.");
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
    },
    message: "Task posted. A World ID-verified human will claim and complete it.",
    ...(callback_url ? { callback_url_registered: true } : {}),
  }, { status: 201 });
}
