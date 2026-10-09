"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { clamp, textOrNull } from "@/lib/content-rules";
import { TalkFace } from "@/components/TalkFace";
import { TalkPicture } from "@/components/TalkPicture";
import styles from "./Talk.module.css";

// TALK: the list of rooms, one per app. DESIGN-SYSTEM.md, "Talk" and Flow 4.
// Drawn with World's own kit on a white page, to the parts Oscar picked (2C and
// 2B): the first room, the one with the most recent message (the first in rail
// order when no room has one), is the big card with the cover picture on top,
// the name and the last line. Every other room is a row with the wide thumbnail,
// the name, the faces of the last few distinct people who wrote, and "N people"
// only when the store gave the count. A room with no message shows no faces and
// no count. Nothing here says who is present now: nobody measures that.
// The list is read from /api/talk and never made up here.

export type Face = { name: string; picture: string | null };
export type RoomRow = {
  id: string;
  name: string;
  picture: { url: string | null; icon: string | null };
  colour: string | null;
  last: { name: string; text: string; at: string } | null;
  count: number | null;
  people: number | null;
  faces: Face[];
};

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; rooms: RoomRow[] };

function lastLine(r: RoomRow): string | null {
  // A reply in a shape this screen does not know prints nothing, never the word "undefined".
  const name = textOrNull(r.last?.name), text = textOrNull(r.last?.text);
  if (name && text) return clamp(`${name}: ${text}`, 80);
  if (r.count === 0) return "Be the first to write";
  return null; // the store did not say: no line is drawn
}

/** The lead is the room with the most recent message, else the first in rail order. */
export function leadOf(rooms: readonly RoomRow[]): RoomRow | null {
  if (rooms.length === 0) return null;
  let lead: RoomRow | null = null;
  for (const r of rooms) {
    if (!r.last) continue;
    if (!lead || (Date.parse(r.last.at) || 0) > (Date.parse(lead.last!.at) || 0)) lead = r;
  }
  return lead ?? rooms[0];
}

function People({ n }: { n: number | null }) {
  if (typeof n !== "number" || n <= 0) return null;
  return <span className={styles.people}>{n} {n === 1 ? "person" : "people"}</span>;
}

export function TalkRooms() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/talk", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !Array.isArray(data.rooms)) throw new Error("unreadable");
        if (live) setState({ kind: "ready", rooms: data.rooms });
      })
      .catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  const rooms = state.kind === "ready" ? state.rooms : [];
  const lead = leadOf(rooms);
  const rest = lead ? rooms.filter((r) => r.id !== lead.id) : [];
  const open = (id: string) => router.push(`/talk/${encodeURIComponent(id)}`);

  return (
    <div className={styles.screen} aria-label="Talk">
      <TopBar title="Talk" endAdornment={rooms.length > 0 ? <Chip label={`${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`} /> : undefined} />

      {state.kind === "loading" && <p className={styles.note}>Reading…</p>}

      {state.kind === "error" && (
        <>
          <p className={styles.note}>The rooms could not be read.</p>
          <div className={styles.noteAction}>
            <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button>
          </div>
        </>
      )}

      {state.kind === "ready" && rooms.length === 0 && (
        <>
          <p className={styles.note}>No app today, so no room yet.</p>
          <div className={styles.noteAction}>
            <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push("/")}>See today&apos;s apps</Button>
          </div>
        </>
      )}

      {lead && (
        <div className={styles.list}>
          <button type="button" className={`min-h-[44px] ${styles.lead}`} onClick={() => open(lead.id)} aria-label={`${lead.name} room`}>
            <TalkPicture name={lead.name} url={lead.picture.url} icon={lead.picture.icon} colour={lead.colour} shape="cover" />
            <span className={styles.leadRow}>
              <span className={styles.rowText}>
                <span className={styles.name}>{lead.name}</span>
                {lastLine(lead) && <span className={styles.last}>{lastLine(lead)}</span>}
              </span>
              <People n={lead.people} />
            </span>
          </button>

          {rest.map((r) => (
            <button key={r.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => open(r.id)} aria-label={`${r.name} room`}>
              <TalkPicture name={r.name} url={r.picture.url} icon={r.picture.icon} colour={r.colour} shape="wide" />
              <span className={styles.rowText}>
                <span className={styles.name}>{r.name}</span>
                {r.faces.length > 0 ? (
                  <span className={styles.faces}>{r.faces.map((f, i) => <TalkFace key={`${f.name}-${i}`} who={{ kind: "person", ...f }} />)}</span>
                ) : lastLine(r) ? (
                  <span className={styles.last}>{lastLine(r)}</span>
                ) : null}
              </span>
              <People n={r.people} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
