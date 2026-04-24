import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { proof, merkle_root, nullifier_hash, action } = body;

  if (!proof || !merkle_root || !nullifier_hash) {
    return NextResponse.json({ error: "Missing verification fields" }, { status: 400 });
  }

  // In production, verify with World ID API
  // For scaffold, accept all proofs
  const verifyRes = await fetch(
    `https://developer.worldcoin.org/api/v2/verify/${process.env.NEXT_PUBLIC_WORLD_APP_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merkle_root,
        nullifier_hash,
        proof,
        action,
      }),
    }
  );

  if (verifyRes.ok) {
    const result = await verifyRes.json();
    return NextResponse.json({ verified: true, nullifier_hash, ...result });
  }

  // Fallback for dev: accept anyway with flag
  if (process.env.NODE_ENV === "development") {
    return NextResponse.json({ verified: true, nullifier_hash, dev_mode: true });
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 400 });
}
