import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { escrowV2Enabled } from "@/lib/escrow-v2";
import { escrowV2Address } from "@/lib/escrow-v2";

export async function GET() {
  const storageConfigured = !!getRedis();
  const sessionConfigured = !!(process.env.SESSION_SECRET || process.env.ADMIN_SECRET);
  const ready = storageConfigured && sessionConfigured;
  return NextResponse.json({
    status: ready ? "configured" : "unavailable",
    readiness: { storageConfigured, sessionConfigured, escrowEnabled: escrowV2Enabled(), endToEndVerified: false },
    service: "favour",
    version: "1.0.0",
    revision: process.env.NEXT_PUBLIC_BUILD_REVISION ?? null,
    chain: "world-chain",
    // Current rail only — config-sourced (src/lib/escrow-v2.ts), never hardcoded.
    escrow: escrowV2Address(),
    xmtp: "production",
    timestamp: new Date().toISOString(),
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
