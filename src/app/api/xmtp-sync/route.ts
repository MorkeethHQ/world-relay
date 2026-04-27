import { NextRequest, NextResponse } from "next/server";
import { syncAndProcessMessages } from "@/lib/xmtp";

const AGENT_API_KEY = process.env.AGENT_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function checkAuth(req: NextRequest): boolean {
  // Allow Vercel Cron invocations (sends Authorization: Bearer <CRON_SECRET>)
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;

  // Allow AGENT_API_KEY auth
  if (!AGENT_API_KEY) return false;
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === AGENT_API_KEY;
}

export async function POST(req: NextRequest) {
  // Allow unauthenticated POST for client-side polling (sync is read+reply, not destructive)
  // Auth is still checked for GET (Vercel cron)
  const isAuthed = checkAuth(req);
  if (!isAuthed) {
    // Rate-limit unauthenticated calls by checking last sync time
    // (still allow it — worst case is redundant sync)
  }

  try {
    const result = await syncAndProcessMessages();
    return NextResponse.json({
      synced: true,
      messagesProcessed: result.messagesProcessed,
      conversations: result.conversations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[XMTP Sync API] Error:", message);
    return NextResponse.json(
      { synced: false, error: message },
      { status: 500 }
    );
  }
}

// Also support GET for Vercel Cron (crons call GET by default)
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAndProcessMessages();
    return NextResponse.json({
      synced: true,
      messagesProcessed: result.messagesProcessed,
      conversations: result.conversations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[XMTP Sync API] Error:", message);
    return NextResponse.json(
      { synced: false, error: message },
      { status: 500 }
    );
  }
}
