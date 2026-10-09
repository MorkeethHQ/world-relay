import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { reportMessage } from "@/lib/talk";
import { identityOf } from "@/lib/talk-identity";

// POST /api/talk/<id>/report { messageId } -> sends a message to review. A
// signed-in person only, from the session. One report per person per message.
const priv = { "Cache-Control": "private, no-store" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identityOf(req, Date.now()).catch(() => null);
  if (!me || me.via !== "session") return NextResponse.json({ error: "Open FAVOUR in World App to report.", code: "reauth_required" }, { status: 403, headers: priv });
  if (!(await rateLimit(`talk-report:${me.author.ref}`, 20, 60_000)).ok || !(await rateLimit(`talk-report-ip:${getClientIp(req)}`, 40, 60_000)).ok) {
    return NextResponse.json({ error: "Too many reports. Try again in a minute." }, { status: 429, headers: priv });
  }
  const body = (await req.json().catch(() => null)) as { messageId?: unknown } | null;
  const result = await reportMessage(id, body?.messageId, me.author);
  if (result.ok) return NextResponse.json({ ok: true }, { headers: priv });
  if (result.reason === "not_found") return NextResponse.json({ error: "That message is not here." }, { status: 404, headers: priv });
  return NextResponse.json({ error: "Not sent. Try again." }, { status: 503, headers: priv });
}
