import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ tasks: listTasks() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { poster, description, location, bountyUsdc, deadlineHours } = body;

  if (!poster || !description || !location || !bountyUsdc) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const task = createTask({
    poster,
    description,
    location,
    bountyUsdc: Number(bountyUsdc),
    deadlineHours: Number(deadlineHours) || 24,
  });

  return NextResponse.json({ task }, { status: 201 });
}
