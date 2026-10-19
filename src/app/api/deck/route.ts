import { NextResponse } from "next/server";
import { listDeck } from "@/lib/deck";

// GET /api/deck -> the swipe deck: Oscar's projects, posted projects, Show HN.
// Public: names, lines, pictures and counts, never a wallet.
export async function GET() {
  try {
    return NextResponse.json({ cards: await listDeck() }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "The deck could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
