import { NextRequest, NextResponse } from "next/server";
import { createPlatformPost, listPlatformPosts, parsePlatformPost } from "@/lib/platform-posts";
import { getAuthedAddress } from "@/lib/session";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const viewer = getAuthedAddress(req, Date.now());
  return NextResponse.json({ posts: await listPlatformPosts(viewer) });
}

export async function POST(req: NextRequest) {
  const author = getAuthedAddress(req, Date.now());
  if (author === null) return NextResponse.json({ error: "Sign in with World to post." }, { status: 401 });
  const limit = await rateLimit(`platform-post:${author}:${getClientIp(req)}`, 4, 60 * 60_000);
  if (limit.ok === false) return NextResponse.json({ error: "Four posts per hour is the limit." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const post = body && typeof body === "object" ? parsePlatformPost(body, author) : null;
  if (post === null) return NextResponse.json({ error: "Choose a post type and add a title and note. Do not include wallet addresses or secrets." }, { status: 400 });
  await createPlatformPost(post);
  const publicPost = (await listPlatformPosts(author)).find((item) => item.id === post.id);
  return NextResponse.json({ post: publicPost }, { status: 201 });
}
