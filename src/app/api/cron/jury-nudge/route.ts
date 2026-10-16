import { NextRequest, NextResponse } from "next/server";
import { runJuryNudgePass } from "@/lib/jury-nudge";

// The jury comeback pass (lib/jury-nudge.ts). Dark until JURY_NUDGE_ENFORCE is
// "true"; deduped per UTC day, so a retry can never double-send.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runJuryNudgePass(Date.now()).catch((e) => {
    console.error("[Cron] jury nudge failed:", e);
    return { error: String(e) };
  });
  return NextResponse.json({ ok: true, ...result });
}
