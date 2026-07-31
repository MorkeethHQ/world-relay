import { NextResponse } from "next/server";
import { escrowV2Address } from "@/lib/escrow-v2";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "favour",
    version: "1.0.0",
    chain: "world-chain",
    // Current rail only — config-sourced (src/lib/escrow-v2.ts), never hardcoded.
    escrow: escrowV2Address(),
    xmtp: "production",
    timestamp: new Date().toISOString(),
  });
}
