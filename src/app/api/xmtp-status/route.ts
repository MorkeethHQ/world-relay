import { NextResponse } from "next/server";
import { getXmtpStatus } from "@/lib/xmtp";

export async function GET() {
  const status = await getXmtpStatus();
  return NextResponse.json(status);
}
