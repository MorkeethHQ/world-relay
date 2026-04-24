import { NextRequest, NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit-core/signing";

export async function POST(req: NextRequest) {
  const signingKey = process.env.RP_SIGNING_KEY;
  if (!signingKey) {
    return NextResponse.json({ error: "RP signing key not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { action } = body;

  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: signingKey,
    action,
  });

  return NextResponse.json({
    sig,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}
