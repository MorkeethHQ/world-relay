import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { getCompanyReview, saveCompanyDecision } from "@/lib/company-review";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return reply({ error: "Sign in with the wallet that owns this campaign.", code: "reauth_required" }, 403);
  try {
    const review = await getCompanyReview(owner, (await params).id);
    return review ? reply(review) : reply({ error: "No such campaign." }, 404);
  } catch { return reply({ error: "Evidence cannot be loaded right now. Please retry." }, 503); }
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return reply({ error: "Sign in with the wallet that owns this campaign.", code: "reauth_required" }, 403);
  if (!(await rateLimit(`company-review:${getClientIp(req)}`, 20, 60_000)).ok) return reply({ error: "Too many saves. Try again in a minute." }, 429);
  try {
    const result = await saveCompanyDecision(owner, (await params).id, await req.json().catch(() => null));
    return result.ok ? reply({ entry: result.entry }, 201) : reply({ error: result.error }, result.status);
  } catch { return reply({ error: "Your decision was not confirmed saved. Reload before trying again." }, 503); }
}
