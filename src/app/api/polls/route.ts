import { NextRequest, NextResponse } from "next/server";
import { listPolls, createPoll } from "@/lib/polls-store";

export async function GET() {
  const polls = await listPolls();
  const sanitized = polls.map(({ voters, ...rest }) => ({
    ...rest,
    voterCount: Object.keys(voters).length,
  }));
  return NextResponse.json({ polls: sanitized });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { question, options, creator, category, durationHours } = body;

  if (!question || !options || options.length < 2 || !creator) {
    return NextResponse.json({ error: "question, options (2+), and creator required" }, { status: 400 });
  }

  const poll = await createPoll({ question, options, creator, category, durationHours });
  return NextResponse.json({ poll }, { status: 201 });
}
