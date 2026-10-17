import { NextRequest, NextResponse } from "next/server";
import { publishDraft } from "@/lib/campaign-drafts";
import { createTask } from "@/lib/store";
import { publishDue } from "@/lib/posted-apps";

// The hourly pass for posted apps that reached 10 YES but could not be published
// that moment (publishDraft allows one publish a day per maker). Each due app is
// published once, at the first pass that is allowed. Idempotent: a published
// app leaves the due set, and the SET NX marker stops a double publish.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await publishDue({ publish: (owner, id, now) => publishDraft(owner, id, now, (t) => createTask(t)) }).catch((e) => {
    console.error("[Cron] publish-due failed:", e);
    return { error: String(e) };
  });
  return NextResponse.json({ ok: true, ...result });
}
