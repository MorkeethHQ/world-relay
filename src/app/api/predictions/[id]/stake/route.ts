import { NextResponse } from "next/server";

// Retired 7 October. Existing stakes still resolve through the original engine.
export async function POST() {
  return NextResponse.json({ error: "New prediction stakes are closed. Existing stakes will still be settled." }, { status: 410 });
}
