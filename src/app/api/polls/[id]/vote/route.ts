import { NextRequest, NextResponse } from "next/server";
import { vote } from "@/lib/polls-store";

// A vote is only counted per verified wallet. userId must be a wallet address;
// this stops a client from minting fresh ids to vote repeatedly.
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

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

  if (typeof userId !== "string" || !WALLET_RE.test(userId)) {
    return NextResponse.json({ error: "A valid wallet address is required to vote" }, { status: 400 });
  }

  const { poll, error } = await vote(id, userId, option);
  if (error) {
    return NextResponse.json({ error, poll }, { status: 400 });
  }

  const { voters, ...sanitized } = poll;
  return NextResponse.json({ poll: { ...sanitized, voterCount: Object.keys(voters).length } });
}
