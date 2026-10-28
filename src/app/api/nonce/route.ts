import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { SIWE_COOKIE, SIWE_PREFIX, SIWE_TTL_S } from "@/lib/wallet-challenge";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  if (!(await rateLimit(`wallet-nonce:${getClientIp(req)}`, 20, 60_000)).ok) return NextResponse.json({ error: "Too many sign-in attempts. Try again shortly." }, { status: 429 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Sign-in storage is unavailable." }, { status: 503 });
  const nonce = randomBytes(24).toString("hex");
  try {
    await redis.set(`${SIWE_PREFIX}${nonce}`, req.nextUrl.origin, { ex: SIWE_TTL_S });
  } catch {
    return NextResponse.json({ error: "Sign-in storage is unavailable." }, { status: 503 });
  }
  const res = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SIWE_COOKIE, nonce, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "strict", path: "/", maxAge: SIWE_TTL_S });
  return res;
}
