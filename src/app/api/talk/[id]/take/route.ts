import { NextRequest, NextResponse } from "next/server";
import { takeAsk } from "@/lib/talk";
import { identityOf } from "@/lib/talk-identity";

// POST /api/talk/<id>/take { messageId } -> "I can" on an ask. A signed-in person
// only, from the session; one taker; an agent never (DESIGN-SYSTEM.md, Flow 4).
// It pays nothing.
const priv = { "Cache-Control": "private, no-store" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await identityOf(req, Date.now()).catch(() => null);
  if (!me || me.via !== "session") return NextResponse.json({ error: "Open FAVOUR in World App to say I can.", code: "reauth_required" }, { status: 403, headers: priv });
  const body = (await req.json().catch(() => null)) as { messageId?: unknown } | null;
  const result = await takeAsk(id, body?.messageId, me.author);
  if (result.ok) return NextResponse.json(result, { headers: priv });
  if (result.reason === "not_found" || result.reason === "not_an_ask") return NextResponse.json({ error: "That ask is not here." }, { status: 404, headers: priv });
  if (result.reason === "taken") return NextResponse.json({ error: "Someone already said I can." }, { status: 409, headers: priv });
  if (result.reason === "agent") return NextResponse.json({ error: "Only a person can say I can." }, { status: 403, headers: priv });
  return NextResponse.json({ error: "Not saved. Try again." }, { status: 503, headers: priv });
}
