import { NextRequest, NextResponse } from "next/server";
import { getPublishedCampaign } from "@/lib/campaign-drafts";
import { listContributions } from "@/lib/completions";
import { readHunt, recordStamp, stampForReview, utcDay } from "@/lib/daily-hunt";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getAuthedAddress } from "@/lib/session";

// GET  /api/hunt                          -> today's stamps and the days in a row,
//                                            for the signed-in wallet only.
// POST /api/hunt { kind: "review", id }   -> a review stamp for a product on FAVOUR.
//
// Identity comes from the session cookie and never from the body
// (SECURITY-INVARIANTS.md). A stamp pays nothing and credits nothing. A vote
// stamp is written where the vote is cast, in /api/votes. A review stamp is
// written here, but only after the server finds the person's own accepted
// review of that product today in their contribution record: the client's word
// is not enough, and yesterday's review does not fill today's card.

const priv = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const now = Date.now();
  const wallet = getAuthedAddress(req, now);
  if (!wallet) return NextResponse.json({ signedIn: false, day: utcDay(now) }, { headers: priv });
  const hunt = await readHunt(wallet, now);
  return NextResponse.json({ signedIn: true, ...hunt }, { headers: priv });
}

export async function POST(req: NextRequest) {
  const now = Date.now();
  const wallet = getAuthedAddress(req, now);
  if (!wallet) return NextResponse.json({ error: "Sign in first.", code: "reauth_required" }, { status: 403, headers: priv });
  if (!(await rateLimit(`hunt:${wallet}`, 20, 60_000)).ok || !(await rateLimit(`hunt-ip:${getClientIp(req)}`, 40, 60_000)).ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: priv });
  }
  const body = (await req.json().catch(() => null)) as { kind?: unknown; id?: unknown } | null;
  if (body?.kind !== "review" || typeof body.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.id)) {
    return NextResponse.json({ error: "That is not a stamp." }, { status: 400, headers: priv });
  }

  // The claim is checked against records this server already holds.
  const campaign = await getPublishedCampaign(body.id).catch(() => null);
  const taskId = campaign && !campaign.hidden ? campaign.pieceTaskIds?.review ?? null : null;
  if (!taskId) return NextResponse.json({ error: "That product is not on FAVOUR." }, { status: 404, headers: priv });
  const today = utcDay(now);
  const done = (await listContributions(wallet)).some((c) => c.taskId === taskId && typeof c.at === "string" && c.at.slice(0, 10) === today);
  if (!done) return NextResponse.json({ error: "No accepted review of this product today." }, { status: 409, headers: priv });

  const result = await recordStamp(wallet, stampForReview(body.id), now);
  if (result.ok) return NextResponse.json({ ok: true, stamps: result.stamps }, { headers: priv });
  if (result.reason === "wallet_required") return NextResponse.json({ error: "Open FAVOUR in World App to collect stamps.", code: "wallet_required" }, { status: 403, headers: priv });
  return NextResponse.json({ error: "Your stamp was not saved." }, { status: 503, headers: priv });
}
