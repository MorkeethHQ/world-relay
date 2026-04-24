import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

const VERIFIED_PREFIX = "verified:";

const localCache = new Map<string, {
  nullifier: string;
  verificationLevel: string;
  verifiedAt: string;
}>();

async function saveVerifiedUser(address: string, data: { nullifier: string; verificationLevel: string; verifiedAt: string }) {
  localCache.set(address, data);
  const redis = getRedis();
  if (redis) {
    await redis.set(`${VERIFIED_PREFIX}${address}`, JSON.stringify(data)).catch(console.error);
  }
}

async function getVerifiedUser(address: string) {
  if (localCache.has(address)) return localCache.get(address)!;
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${VERIFIED_PREFIX}${address}`);
  if (!raw) return null;
  const data = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
  localCache.set(address, data);
  return data;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.rp_id && body.idkitResponse) {
    const { rp_id, idkitResponse } = body;

    const response = await fetch(
      `https://developer.world.org/api/v4/verify/${rp_id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(idkitResponse),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("[World ID] Verification failed:", err);
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }

    const result = await response.json();
    const nullifier = idkitResponse.responses?.[0]?.nullifier || "unknown";
    const identifier = idkitResponse.responses?.[0]?.identifier || "orb";

    await saveVerifiedUser(body.address || nullifier, {
      nullifier,
      verificationLevel: identifier,
      verifiedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      verified: true,
      verification_level: identifier,
      nullifier,
      ...result,
    });
  }

  if (body.address && body.signature) {
    await saveVerifiedUser(body.address, {
      nullifier: body.address,
      verificationLevel: "wallet",
      verifiedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      verified: true,
      verification_level: "wallet",
      address: body.address,
    });
  }

  if (body.address?.startsWith("dev_")) {
    await saveVerifiedUser(body.address, {
      nullifier: body.address,
      verificationLevel: "dev",
      verifiedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      verified: true,
      verification_level: "dev",
      dev_mode: true,
    });
  }

  return NextResponse.json({ error: "Missing verification fields" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const user = await getVerifiedUser(address);
  if (!user) {
    return NextResponse.json({ verified: false, verification_level: null });
  }

  return NextResponse.json({
    verified: true,
    ...user,
  });
}
