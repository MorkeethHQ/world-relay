import { NextResponse } from "next/server";
import { roomSummaries } from "@/lib/talk";
import { listRooms } from "@/lib/talk-rooms";

// GET /api/talk -> the rooms. DESIGN-SYSTEM.md, "Talk": one room per app in the
// rail, so the list is never empty while the rail has an app. The last message
// the counts and the faces of the last people who wrote come from the store; when
// the store did not say, they are null and the screen draws none of them. Public: nothing here names the caller.
export async function GET() {
  try {
    const rooms = await listRooms();
    const summary = await roomSummaries(rooms.map((r) => r.id));
    const rows = rooms.map((r) => {
      const x = summary[r.id] ?? { last: null, count: null, people: null, faces: [] };
      return { ...r, last: x.last, count: x.count, people: x.people, faces: x.faces };
    });
    return NextResponse.json({ rooms: rows }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "The rooms could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
