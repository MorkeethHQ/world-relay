import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { broadcastEvent } from "@/lib/sse";

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { poster, category, description, location, lat, lng, bountyUsdc, deadlineHours, onChainId, escrowTxHash } = body;

  if (!poster || !description || !location || !bountyUsdc) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const task = createTask({
    poster,
    category: category || "custom",
    description,
    location,
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    bountyUsdc: Number(bountyUsdc),
    deadlineHours: Number(deadlineHours) || 24,
    onChainId: onChainId != null ? Number(onChainId) : null,
    escrowTxHash: escrowTxHash || null,
  });

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, task.agent?.id || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", "🗺️ AI SCOUT BRIEFING\n━━━━━━━━━━━━━━━━━━\n" + briefing + "\n\nThis briefing was auto-generated for potential claimants.");
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
