import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";

export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  if (!address) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, address });
}
