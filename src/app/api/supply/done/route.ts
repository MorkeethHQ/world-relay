import { NextRequest, NextResponse } from "next/server";
import { listDoneSupplyTemplates } from "@/lib/board-supply";

/**
 * Templates this wallet has already completed (board-supply anti-repeat).
 * Same trust model as the rest of the app: client passes wallet address.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() || "";
  if (address.length < 5) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }
  const doneTemplateIds = await listDoneSupplyTemplates(address);
  return NextResponse.json(
    { doneTemplateIds },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
