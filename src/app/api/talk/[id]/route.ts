import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { postMessage, readRoom, TEXT_MAX } from "@/lib/talk";
import { identityOf } from "@/lib/talk-identity";
import { roomOf } from "@/lib/talk-rooms";

// GET  /api/talk/<id>          -> one room: the app, its messages newest first,
//                                 the pinned ask, and whether the caller is signed in.
// POST /api/talk/<id> { text, ask? } -> one message from the session's wallet, or
//                                 from an agent by its bearer key. The body never
//                                 names the author (SECURITY-INVARIANTS.md, Inv 4).
//
// A hidden message is absent from the GET. A store that cannot answer is 503,
// never an empty room. Private: the GET names "signedIn".

const priv = { "Cache-Control": "private, no-store" };
const unavailable = () => NextResponse.json({ error: "This room could not be read. Try again." }, { status: 503, headers: priv });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = Date.now();
  let room;
  try { room = await roomOf(id, now); } catch { return unavailable(); }
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404, headers: priv });
  const read = await readRoom(id);
  if (!read.ok) return unavailable();
  const me = await identityOf(req, now).catch(() => null);
  return NextResponse.json({
    room, messages: read.messages, pinned: read.pinned, count: read.count,
    signedIn: !!me && me.via === "session", you: me && me.via === "session" ? me.author.name : null,
  }, { headers: priv });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = Date.now();
  const me = await identityOf(req, now).catch(() => null);
  if (!me) return NextResponse.json({ error: "Open FAVOUR in World App to write here.", code: "reauth_required" }, { status: 403, headers: priv });
  if (!(await rateLimit(`talk-ip:${getClientIp(req)}`, 60, 60_000)).ok) {
    return NextResponse.json({ error: "Too many messages. Try again in a minute." }, { status: 429, headers: priv });
  }
  let room;
  try { room = await roomOf(id, now); } catch { return unavailable(); }
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404, headers: priv });
  const body = (await req.json().catch(() => null)) as { text?: unknown; ask?: unknown } | null;
  const result = await postMessage({ room: id, author: me.author, text: body?.text, ask: body?.ask === true }, now);
  if (result.ok) return NextResponse.json({ message: result.message }, { status: 201, headers: priv });
  if (result.reason === "empty") return NextResponse.json({ error: "Write something first." }, { status: 400, headers: priv });
  if (result.reason === "too_long") return NextResponse.json({ error: `Keep it under ${TEXT_MAX} characters.` }, { status: 400, headers: priv });
  if (result.reason === "rate_limited") return NextResponse.json({ error: "Too many messages. Try again later." }, { status: 429, headers: priv });
  if (result.reason === "bad_room") return NextResponse.json({ error: "Not found" }, { status: 404, headers: priv });
  return NextResponse.json({ error: "Your message was not saved. Try again." }, { status: 503, headers: priv });
}
