import { NextRequest, NextResponse } from "next/server";
import { vote } from "@/lib/polls-store";
import { trackEvent } from "@/lib/track";
import { recordDailyActivity } from "@/lib/proof-of-favour";

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

  // Never expose the voters map (wallet -> choice for every voter) to a client.
  const sanitize = (p: typeof poll) => {
    if (!p) return p;
    const { voters, ...rest } = p;
    return { ...rest, voterCount: Object.keys(voters).length };
  };

  if (error) {
    return NextResponse.json({ error, poll: sanitize(poll) }, { status: 400 });
  }

  // The app's most-used action, previously invisible to analytics.
  trackEvent("poll_vote", { pollId: id }).catch(() => {});
  // A vote is real daily activity: it feeds the streak + once-a-day bonus,
  // so there is ALWAYS a one-tap way to keep a streak alive.
  recordDailyActivity(userId).catch(console.error);
  return NextResponse.json({ poll: sanitize(poll) });
}
