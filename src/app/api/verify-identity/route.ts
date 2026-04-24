import { NextRequest, NextResponse } from "next/server";

const verifiedUsers = new Map<string, {
  nullifier: string;
  verificationLevel: string;
  verifiedAt: string;
}>();

export async function POST(req: NextRequest) {
  const body = await req.json();

  // IDKit v4 proof verification
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

    verifiedUsers.set(body.address || nullifier, {
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

  // Legacy walletAuth verification (MiniKit)
  if (body.address && body.signature) {
    verifiedUsers.set(body.address, {
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

  // Dev mode fallback
  if (body.address?.startsWith("dev_")) {
    verifiedUsers.set(body.address, {
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

  const user = verifiedUsers.get(address);
  if (!user) {
    return NextResponse.json({ verified: false, verification_level: null });
  }

  return NextResponse.json({
    verified: true,
    ...user,
  });
}
