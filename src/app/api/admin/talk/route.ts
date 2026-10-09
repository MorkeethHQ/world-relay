import { NextRequest, NextResponse } from "next/server";
import { hideMessage, REPORTS_KEY, defaultTalkStore } from "@/lib/talk";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Admin review of Talk, behind ADMIN_SECRET like admin/polls:
//   { secret, action: "hide",   room, messageId }  the message is absent from every read
//   { secret, action: "unhide", room, messageId }  it is back
//   { secret, action: "reports" }                  the review list, newest first
// Nothing is deleted.
export async function POST(req: NextRequest) {
  if (!ADMIN_SECRET) return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (body.action === "hide" || body.action === "unhide") {
    const ok = await hideMessage(body.room, body.messageId, body.action === "hide");
    return ok ? NextResponse.json({ ok: true, hidden: body.action === "hide" }) : NextResponse.json({ error: "Not applied. Check room and messageId, and the store." }, { status: 503 });
  }
  if (body.action === "reports") {
    const s = defaultTalkStore();
    if (!s) return NextResponse.json({ error: "Store unavailable" }, { status: 503 });
    const reports = await s.lrange(REPORTS_KEY, 0, 199).catch(() => null);
    return reports ? NextResponse.json({ reports }) : NextResponse.json({ error: "Store unavailable" }, { status: 503 });
  }
  return NextResponse.json({ error: 'action must be "hide", "unhide" or "reports"' }, { status: 400 });
}
