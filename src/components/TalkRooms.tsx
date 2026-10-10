"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { clamp, textOrNull } from "@/lib/content-rules";
import { TalkFace } from "@/components/TalkFace";
import { TalkPicture } from "@/components/TalkPicture";
import { shownName, timeShort } from "@/components/TalkRoom";
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

// A shortened wallet address is never printed as a name: "Someone 00d1".
// The rule is shownName in TalkRoom.tsx; this is its name on this screen.
export const personName = shownName;

function lastLine(r: RoomRow): string | null {
  // A reply in a shape this screen does not know prints nothing, never the word "undefined".
  const name = textOrNull(r.last?.name), text = textOrNull(r.last?.text);
  if (name && text) return clamp(`${personName(name)}: ${text}`, 120);
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
  // The lead is a conversation card: the room's mark, its last message in full
  // view, who wrote it and when. It is drawn only for a room with a message, and
  // it has no cover picture (11 Oct 2026: a pale share picture read as an empty box).
  const big = !!lead && !!textOrNull(lead.last?.text);
  const others = lead ? rooms.filter((r) => r.id !== lead.id || !big) : [];
  // A room with a message is a row. A room with none is a tile that asks for the first one.
  const rest = others.filter((r) => r.count !== 0);
  const quiet = others.filter((r) => r.count === 0);
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
          {big && lead.last && (
            <button type="button" className={`min-h-[44px] ${styles.lead}`} onClick={() => open(lead.id)} aria-label={`${lead.name} room`}>
              <span className={styles.leadHead}>
                <TalkPicture name={lead.name} url={lead.picture.url} icon={lead.picture.icon} colour={lead.colour} shape="squareSmall" art={lead.id} />
                <span className={styles.name}>{lead.name}</span>
                <People n={lead.people} />
              </span>
              <span className={styles.leadSays}>{clamp(lead.last.text, 180)}</span>
              <span className={styles.leadBy}>{personName(textOrNull(lead.last.name) ?? "Someone")}{timeShort(lead.last.at) ? ` · ${timeShort(lead.last.at)}` : ""}</span>
              <span className={styles.leadGo}>Open conversation</span>
            </button>
          )}

          {rest.map((r) => (
            <button key={r.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => open(r.id)} aria-label={`${r.name} room`}>
              <TalkPicture name={r.name} url={r.picture.url} icon={r.picture.icon} colour={r.colour} shape="thumb72" art={r.id} />
              <span className={styles.rowText}>
                <span className={styles.name}>{r.name}</span>
                {r.faces.length > 0 ? (
                  <span className={styles.faces}>{r.faces.map((f, i) => <TalkFace key={`${f.name}-${i}`} who={{ kind: "person", ...f, name: personName(f.name) }} />)}</span>
                ) : lastLine(r) ? (
                  <span className={`${styles.last} ${styles.last2}`}>{lastLine(r)}</span>
                ) : null}
              </span>
              <People n={r.people} />
            </button>
          ))}

          {quiet.length > 0 && (
            <>
              <h2 className={styles.quietHead}>Start a conversation<small>No one has written in {quiet.length === 1 ? "this room" : "these rooms"} yet.</small></h2>
              <div className={styles.quiet}>
                {quiet.map((r) => (
                  <button key={r.id} type="button" className={`min-h-[44px] ${styles.quietTile}`} onClick={() => open(r.id)} aria-label={`${r.name} room`}>
                    <TalkPicture name={r.name} url={r.picture.url} icon={r.picture.icon} colour={r.colour} shape="banner" art={r.id} />
                    <span className={styles.name}>{r.name}</span>
                    <span className={styles.invite}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      Ask about {clamp(r.name, 24)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
