import { NextResponse } from "next/server";
import { getXmtpStatus } from "@/lib/xmtp";

export async function GET() {
  const status = await getXmtpStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
  });
}
