import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { publishDraft } from "@/lib/campaign-drafts";
import { createTask } from "@/lib/store";
import { castYes } from "@/lib/posted-apps";

// POST /api/apps/vote { id } -> one YES from the signed-in wallet for one posted
// app. At 10 distinct outside wallets the app is published as its maker
// (lib/posted-apps.ts). The wallet is the session's, never the body's.

const priv = { "Cache-Control": "private, no-store" };
const REFUSED = {
  unknown_app: [404, "That app is not waiting for votes."],
  not_pending: [409, "That app is already published."],
  own_app: [403, "You cannot vote for your own app."],
  wallet_required: [403, "Open FAVOUR in World App to vote."],
  unavailable: [503, "Your vote was not saved. Try again."],
} as const;

export async function POST(req: NextRequest) {
  const wallet = getAuthedAddress(req, Date.now());
  if (!wallet) return NextResponse.json({ error: "Sign in to vote.", code: "reauth_required" }, { status: 403, headers: priv });
  if (!(await rateLimit(`app-vote:${wallet}`, 20, 60_000)).ok || !(await rateLimit(`app-vote-ip:${getClientIp(req)}`, 40, 60_000)).ok) {
    return NextResponse.json({ error: "Too many votes. Try again in a minute." }, { status: 429, headers: priv });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const result = await castYes(body?.id, wallet, { publish: (owner, id, now) => publishDraft(owner, id, now, (t) => createTask(t)) });
  if (result.ok) return NextResponse.json(result, { headers: priv });
  const [status, error] = REFUSED[result.reason];
  return NextResponse.json({ error, code: result.reason }, { status, headers: priv });
}
