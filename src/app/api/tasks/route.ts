import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";

let autoSeedTriggered = false;

export async function GET() {
  const tasks = await listTasks();
  if (tasks.length === 0 && !autoSeedTriggered) {
    autoSeedTriggered = true;
    try {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${origin}/api/seed`, { method: "POST" });
      const seeded = await listTasks();
      return NextResponse.json({ tasks: seeded });
    } catch {
      return NextResponse.json({ tasks: [] });
    }
  }
  return NextResponse.json({ tasks });
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

  // Post task creation to XMTP thread
  postTaskCreated(task).catch(console.error);

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, task.agent?.id || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", "🗺️ SCOUT BRIEFING\n━━━━━━━━━━━━━━━━━━\n" + briefing);
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
