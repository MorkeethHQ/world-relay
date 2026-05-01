import { NextRequest, NextResponse } from "next/server";
import { getNotifications, getUnreadCount } from "@/lib/notifications-store";

export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user");

  if (!user) {
    return NextResponse.json({ error: "Missing user param" }, { status: 400 });
  }

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(user, 20),
    getUnreadCount(user),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
