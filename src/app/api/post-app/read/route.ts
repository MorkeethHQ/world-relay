import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchProduct } from "@/lib/product-fetch";

// POST /api/post-app/read { url } -> what FAVOUR read from the maker's page: a
// PROPOSAL the maker confirms or changes. Nothing is saved.
//
// This makes OUR server call a link a stranger typed, so it is closed three ways:
// a signed-in World wallet only, a rate limit per wallet and per address, and the
// fence in lib/product-fetch.ts (https, public addresses only, capped, timed).
export async function POST(req: NextRequest) {
  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return NextResponse.json({ error: "Sign in to post your app.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to post your app.", code: "wallet_required" }, { status: 403 });
  }
  const byWallet = await rateLimit(`post-read:${owner}`, 10, 60_000);
  const byIp = await rateLimit(`post-read-ip:${getClientIp(req)}`, 20, 60_000);
  if (!byWallet.ok || !byIp.ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const result = await fetchProduct((body as { url?: unknown } | null)?.url);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
  return NextResponse.json({ proposal: result.proposal }, { headers: { "Cache-Control": "private, no-store" } });
}
