import { NextRequest, NextResponse } from "next/server";
import { deletePoll, listPolls } from "@/lib/polls-store";
import { runPollRefresh } from "@/lib/poll-refresh";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Admin poll moderation. Two verbs, both behind ADMIN_SECRET:
//   { action: "delete", ids: [...] }  — remove spam / junk polls
//   { action: "refresh" }            — run the supply engine on demand
// Deletion is irreversible and takes votes with it, so it is id-explicit: there
// is deliberately no "delete everything ended" sweep. Ended polls are HONEST
// history and the UI already files them below the active ones.
export async function POST(req: NextRequest) {
  if (!ADMIN_SECRET) return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (body.action === "refresh") {
    return NextResponse.json(await runPollRefresh());
  }

  if (body.action === "delete") {
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: "ids (non-empty array) required" }, { status: 400 });
    }
    const deleted: string[] = [];
    const missing: string[] = [];
    for (const id of body.ids) {
      if (typeof id !== "string" || !id) continue;
      ((await deletePoll(id)) ? deleted : missing).push(id);
    }
    return NextResponse.json({ deleted, missing, remaining: (await listPolls()).length });
  }

  return NextResponse.json({ error: 'action must be "delete" or "refresh"' }, { status: 400 });
}
