import { NextRequest, NextResponse } from "next/server";
import { likePlatformPost } from "@/lib/platform-posts";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const wallet = getAuthedAddress(req, Date.now());
  if (wallet === null) return NextResponse.json({ error: "Sign in with World to like posts." }, { status: 401 });
  const { id } = await params;
  const limit = await rateLimit(`platform-like:${wallet}`, 120, 60 * 60_000);
  if (limit.ok === false) return NextResponse.json({ error: "Like limit reached. Try again later." }, { status: 429 });
  const result = await likePlatformPost(id, wallet);
  if (result === null) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
