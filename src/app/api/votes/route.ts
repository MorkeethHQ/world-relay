import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { fetchProduct, type FetchResult } from "@/lib/product-fetch";
import { CANDIDATES, CANDIDATES_FROM, castVote, tallies, voteRows } from "@/lib/product-votes";

// GET  /api/votes        -> the products people can vote on, with each count and
//                           whether the caller voted. Private: it names "mine".
// POST /api/votes { id } -> one vote from the signed-in World wallet.
//
// The links read here are the fixed list in lib/product-votes.ts. No caller
// chooses a link. Each page is read through the fence in lib/product-fetch.ts
// and kept for ten minutes, so a visit does not make this server call out.

const KEEP_MS = 10 * 60_000;
const pages = new Map<string, { at: number; result: FetchResult }>();

async function page(id: string, url: string, now: number): Promise<FetchResult> {
  const kept = pages.get(id);
  if (kept && now - kept.at < KEEP_MS) return kept.result;
  const result = await fetchProduct(url).catch((): FetchResult => ({ ok: false, reason: "unreadable" }));
  // A failed read is kept for one minute only, so one slow answer does not hide a product for ten.
  pages.set(id, { at: result.ok ? now : now - KEEP_MS + 60_000, result });
  return result;
}

const priv = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const now = Date.now();
  const wallet = getAuthedAddress(req, now);
  const read = Object.fromEntries(await Promise.all(CANDIDATES.map(async (c) => [c.id, await page(c.id, c.url, now)] as const)));
  return NextResponse.json({ from: CANDIDATES_FROM, rows: voteRows(read, await tallies(wallet)), signedIn: !!wallet }, { headers: priv });
}

export async function POST(req: NextRequest) {
  const wallet = getAuthedAddress(req, Date.now());
  if (!wallet) return NextResponse.json({ error: "Sign in to vote.", code: "reauth_required" }, { status: 403, headers: priv });
  if (!(await rateLimit(`vote:${wallet}`, 20, 60_000)).ok || !(await rateLimit(`vote-ip:${getClientIp(req)}`, 40, 60_000)).ok) {
    return NextResponse.json({ error: "Too many votes. Try again in a minute." }, { status: 429, headers: priv });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const result = await castVote(body?.id, wallet);
  if (result.ok) return NextResponse.json(result, { headers: priv });
  if (result.reason === "unknown_product") return NextResponse.json({ error: "That product is not on the list." }, { status: 404, headers: priv });
  if (result.reason === "wallet_required") return NextResponse.json({ error: "Open FAVOUR in World App to vote.", code: "wallet_required" }, { status: 403, headers: priv });
  return NextResponse.json({ error: "Your vote was not saved. Try again." }, { status: 503, headers: priv });
}
