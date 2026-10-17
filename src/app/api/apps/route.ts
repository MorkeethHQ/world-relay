import { NextResponse } from "next/server";
import { listPendingApps } from "@/lib/posted-apps";

// GET /api/apps -> the posted apps waiting for YES, each with its outside count
// toward the 10 YES gate (lib/yes-gate.ts). Public: counts only, no voter.
export async function GET() {
  try {
    const apps = (await listPendingApps()).map(({ id, productName, productUrl, ask, yes, of, status }) => ({ id, productName, productUrl, ask, yes, of, status }));
    return NextResponse.json({ apps }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ error: "The list could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
