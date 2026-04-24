import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";

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

  return NextResponse.json({ task }, { status: 201 });
}
