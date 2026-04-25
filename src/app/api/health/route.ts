import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "relay",
    version: "1.0.0",
    chain: "world-chain",
    escrow: "0xc976e463bD209E09cb15a168A275890b872AA1F0",
    xmtp: "production",
    timestamp: new Date().toISOString(),
  });
}
