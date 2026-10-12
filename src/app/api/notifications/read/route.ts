import { NextRequest, NextResponse } from "next/server";
import { markRead, markAllRead } from "@/lib/notifications-store";
import { ownershipError } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { user, notification_id, all } = body;

  if (!user) {
    return NextResponse.json({ error: "Missing user" }, { status: 400 });
  }

  // `user` is a public body field. The session must be that wallet
  // (ownershipError, honours SESSION_ENFORCE) before anything is marked.
  const owner = ownershipError(req, user, Date.now());
  if (owner) return NextResponse.json({ error: owner }, { status: 403 });

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
