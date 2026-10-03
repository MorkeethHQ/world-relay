import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { companyAppealHistory } from "@/lib/company-appeal";
export async function GET(req: NextRequest) {
  const wallet = getAuthedAddress(req, Date.now());
  if (!wallet) return NextResponse.json({ reviews: [] }, { headers: { "Cache-Control": "private, no-store" } });
  try { return NextResponse.json({ reviews: await companyAppealHistory(wallet) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Review history is unavailable. Please reload." }, { status: 503 }); }
}
