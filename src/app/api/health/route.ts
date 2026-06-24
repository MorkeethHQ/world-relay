import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "relay",
    version: "1.0.0",
    chain: "world-chain",
    escrow: "0x274C38eA9944f57D24A59fbEf558bba2264f9351",
    xmtp: "production",
    timestamp: new Date().toISOString(),
  });
}
