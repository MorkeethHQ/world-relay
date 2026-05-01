import { NextRequest, NextResponse } from "next/server";
import { markRead, markAllRead } from "@/lib/notifications-store";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user, notification_id, all } = body;

  if (!user) {
    return NextResponse.json({ error: "Missing user" }, { status: 400 });
  }

  if (all) {
    await markAllRead(user);
    return NextResponse.json({ ok: true, marked: "all" });
  }

  if (!notification_id) {
    return NextResponse.json({ error: "Missing notification_id or all flag" }, { status: 400 });
  }

  await markRead(user, notification_id);
  return NextResponse.json({ ok: true, marked: notification_id });
}
