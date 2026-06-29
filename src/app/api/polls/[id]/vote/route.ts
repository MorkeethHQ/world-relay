import { NextRequest, NextResponse } from "next/server";
import { vote } from "@/lib/polls-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { userId, option } = body;

  if (!userId || !option) {
    return NextResponse.json({ error: "userId and option required" }, { status: 400 });
  }

  const { poll, error } = await vote(id, userId, option);
  if (error) {
    return NextResponse.json({ error, poll }, { status: 400 });
  }

  const { voters, ...sanitized } = poll;
  return NextResponse.json({ poll: { ...sanitized, voterCount: Object.keys(voters).length } });
}
