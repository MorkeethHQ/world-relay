import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { welcomeView } from "@/lib/welcome-journey";

// GET /api/welcome -> the Welcome campaign and its steps. Signed out, every step
// reads "todo". Signed in, each step carries the state of THIS wallet's own
// instance, taken from the session and never from a query string, so nobody can
// read another person's Welcome proofs by knowing their address.
export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  const view = await welcomeView(address);
  if (!view) return NextResponse.json({ welcome: null }, { headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ welcome: view }, { headers: { "Cache-Control": "private, no-store" } });
}
