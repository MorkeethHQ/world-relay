import { NextRequest, NextResponse } from "next/server";
import { getNotifications, getUnreadCount } from "@/lib/notifications-store";
import { readerRefusal } from "@/lib/session";

const PRIVATE = { "Cache-Control": "private, no-store" };

// A person's notifications are private to that wallet. Measured on production
// 2026-10-12: this route answered 200 with 20 rows and unreadCount 50 to a
// caller with no cookie, for an address taken from the public feed. The read
// gate is readerRefusal over the one address asked for: 401 with no session,
// 403 for a different wallet, dark for the anonymous case until
// SESSION_ENFORCE is on. No client in src/ calls this route today.
export async function GET(req: NextRequest) {
  const user = new URL(req.url).searchParams.get("user");

  if (!user) {
    return NextResponse.json({ error: "Missing user param" }, { status: 400 });
  }

  const refusal = readerRefusal(req, [user], Date.now());
  if (refusal) return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status, headers: PRIVATE });

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(user, 20),
    getUnreadCount(user),
  ]);

  return NextResponse.json({ notifications, unreadCount }, { headers: PRIVATE });
}
