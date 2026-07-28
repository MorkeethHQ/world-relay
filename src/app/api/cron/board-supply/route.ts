import { NextRequest, NextResponse } from "next/server";
import { ensureBoardSupply, BOARD_SUPPLY_TARGET } from "@/lib/board-supply";

/**
 * Keep N verifiable points favours live on the board.
 * Schedule: hourly (see vercel.json). Auth: CRON_SECRET bearer (same as other crons).
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await ensureBoardSupply({ target: BOARD_SUPPLY_TARGET });
  return NextResponse.json({ ok: true, ...result });
}
