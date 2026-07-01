import { NextRequest, NextResponse } from "next/server";
import { listPolls, createPoll } from "@/lib/polls-store";

// Poll authorship is attributed to a verified wallet, so the creator field must
// be a wallet address rather than an arbitrary client-supplied id.
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId") || "";
  const polls = await listPolls();
  const sanitized = polls.map(({ voters, ...rest }) => ({
    ...rest,
    voterCount: Object.keys(voters).length,
    // Tell the requesting user whether they already voted (and for what) so the
    // client can lock the poll persistently, not just for the current session.
    youVoted: userId ? !!voters[userId] : false,
    yourVote: userId ? voters[userId] || null : null,
  }));
  return NextResponse.json({ polls: sanitized });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { question, options, creator, category, durationHours } = body;

  if (!question || !options || options.length < 2 || !creator) {
    return NextResponse.json({ error: "question, options (2+), and creator required" }, { status: 400 });
  }

  if (typeof creator !== "string" || !WALLET_RE.test(creator)) {
    return NextResponse.json({ error: "A valid wallet address is required to create a poll" }, { status: 400 });
  }

  const poll = await createPoll({ question, options, creator, category, durationHours });
  return NextResponse.json({ poll }, { status: 201 });
}
