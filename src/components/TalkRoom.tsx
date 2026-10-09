"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, TextArea, TopBar, useToast } from "@worldcoin/mini-apps-ui-kit-react";
import { TalkFace } from "@/components/TalkFace";
import { TalkPicture } from "@/components/TalkPicture";
import styles from "./Talk.module.css";

// A ROOM. DESIGN-SYSTEM.md, "A room" and Flow 4. Drawn with World's own kit, to
// the parts Oscar picked (9 Oct 2026): the pinned ask as the dark card (3B),
// messages as flat lines with a hairline between (4C), an agent as an outlined
// square mark with its text in an outlined box (5B), and a composer with a plus
// that opens a sheet (7B). In this phase the sheet holds the one thing that
// works, "Ask a favour".
//
// The pinned card. It appears only when funds exist: for an app posted on
// FAVOUR it is the maker's own ask from /api/project/<id>, with its real points,
// and its button goes to the existing review flow on /p/<id>, which pays through
// /api/verify-proof. A free ask typed in a room is a normal line with "I can",
// which records one taker and pays nothing. No reward is printed that the
// server did not give. No token, no USDC, no new reward path.
//
// Everything shown comes from the server. Sign-in is what /api/talk/<id> said,
// never a value from local storage. A hidden message never arrives here.

const TEXT_MAX = 300;

type Author = { kind: "person" | "agent"; name: string; picture: string | null };
export type RoomMessage = { id: string; author: Author; text: string; ask: boolean; at: string; taken: { name: string } | null };
type Room = { id: string; name: string; picture: { url: string | null; icon: string | null }; colour: string | null; kind: "favour" | "vote" | "launch" };
type Read = { room: Room; messages: RoomMessage[]; pinned: RoomMessage | null; count: number; signedIn: boolean; you: string | null };
type MakerAsk = { company: string; ask: string; points: number; reviewTaskId: string };
type State = { kind: "loading" } | { kind: "error" } | { kind: "missing" } | { kind: "ready"; data: Read; readAt: number };

const SIGN_IN_LINE = "Open FAVOUR in World App to write here.";

export function timeShort(iso: string, now: number = Date.now()): string {
  const ms = now - (Date.parse(iso) || now);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Back() {
  return (
    <Link href="/talk" aria-label="Back to Talk" className={`min-h-[44px] ${styles.frameLink}`}>
      <Button variant="tertiary" size="icon" className="min-h-[44px]" asChild>
        <span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </span>
      </Button>
    </Link>
  );
}

export function TalkRoom({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [maker, setMaker] = useState<MakerAsk | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [ask, setAsk] = useState(false);
  const [sending, setSending] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);
  const [reporting, setReporting] = useState<RoomMessage | null>(null);
  const [plus, setPlus] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (): Promise<State> => {
    const res = await fetch(`/api/talk/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "missing" };
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.room || !Array.isArray(data.messages)) return { kind: "error" };
    return { kind: "ready", data, readAt: Date.now() };
  }, [id]);

  useEffect(() => {
    let live = true;
    load().then((next) => { if (live) setState(next); }).catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [load, attempt]);

  // The maker's own ask, only for an app posted on FAVOUR. Read alone: when it
  // cannot be read the room still works and no card is pinned.
  const roomKind = state.kind === "ready" ? state.data.room.kind : null;
  useEffect(() => {
    if (roomKind !== "favour") return;
    let live = true;
    fetch(`/api/project/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.project;
        // Funds only: a review the app takes now, with points above zero. Else no card.
        if (!live || !p || p.kind !== "favour" || !p.product || typeof p.product.ask !== "string" || typeof p.product.points !== "number") return;
        if (!(p.product.points > 0) || typeof p.product.reviewTaskId !== "string" || !p.product.reviewTaskId) return;
        setMaker({ company: String(p.product.company || ""), ask: p.product.ask, points: p.product.points, reviewTaskId: p.product.reviewTaskId });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [id, roomKind]);

  const refresh = useCallback(() => load().then(setState).catch(() => setState({ kind: "error" })), [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (sending || state.kind !== "ready") return;
    setSending(true);
    try {
      const res = await fetch(`/api/talk/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ask }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error({ title: data?.error || "Your message was not saved. Try again." }); return; }
      setText(""); setAsk(false);
      await refresh();
      endRef.current?.scrollIntoView({ block: "end" });
    } catch {
      toast.error({ title: "Your message was not saved. Try again." });
    } finally {
      setSending(false);
    }
  }

  async function take(messageId: string) {
    if (taking) return;
    setTaking(messageId);
    try {
      const res = await fetch(`/api/talk/${encodeURIComponent(id)}/take`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error({ title: data?.error || "Not saved. Try again." }); return; }
      toast.success({ title: "You said I can." });
      await refresh();
    } catch {
      toast.error({ title: "Not saved. Try again." });
    } finally {
      setTaking(null);
    }
  }

  async function report(m: RoomMessage) {
    try {
      const res = await fetch(`/api/talk/${encodeURIComponent(id)}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: m.id }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error({ title: data?.error || "Not sent. Try again." }); return; }
      toast.success({ title: "Sent to review." });
    } catch {
      toast.error({ title: "Not sent. Try again." });
    } finally {
      setReporting(null);
    }
  }

  if (state.kind !== "ready") {
    return (
      <div className={styles.screen} aria-label="Room">
        <TopBar startAdornment={<Back />} title={state.kind === "missing" ? "Not here" : ""} />
        {state.kind === "loading" && <p className={styles.note}>Reading…</p>}
        {state.kind === "error" && (
          <>
            <p className={styles.note}>This room could not be read.</p>
            <div className={styles.noteAction}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button>
            </div>
          </>
        )}
        {state.kind === "missing" && (
          <>
            <p className={styles.note}>This room is not here.</p>
            <div className={styles.noteAction}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push("/talk")}>Back to Talk</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  const { room, signedIn } = state.data;
  const messages = [...state.data.messages].reverse(); // the server gives newest first; a room reads down to the newest
  const left = TEXT_MAX - Array.from(text).length;
  const now = state.readAt;
  // The dark pinned card appears only when funds exist: the maker's ask of an app
  // posted on FAVOUR, with its real points. A free ask typed in a room is a
  // normal line with "I can" (Oscar, 9 Oct 2026: "pinned ones should have funds for sure").
  const makerAsk = room.kind === "favour" ? maker : null;

  return (
    <div className={`${styles.screen} ${styles.room}`} aria-label={`${room.name} room`}>
      <TopBar
        startAdornment={<Back />}
        title={room.name}
        endAdornment={
          <Link href={`/p/${encodeURIComponent(room.id)}`} aria-label={`Open ${room.name}`} className={`min-h-[44px] ${styles.frameLink}`}>
            <TalkPicture name={room.name} url={room.picture.url} icon={room.picture.icon} colour={room.colour} shape="squareSmall" />
          </Link>
        }
      />

      {makerAsk && (
        <div className={styles.pinned} aria-label="The maker's ask">
          <div className={styles.pinnedWho}><span>{makerAsk.company ? `${makerAsk.company} asks` : "The maker asks"}</span></div>
          <p className={styles.pinnedLine}>{makerAsk.ask}</p>
          <button type="button" className={`min-h-[44px] ${styles.pinnedButton}`} onClick={() => router.push(`/p/${encodeURIComponent(room.id)}`)}>
            Review · <span className="text-amber-600">{makerAsk.points} pts</span>
          </button>
        </div>
      )}

      {messages.length === 0 ? (
        <p className={styles.note}>Nothing here yet. Say hello.</p>
      ) : (
        <div className={styles.messages}>
          {messages.map((m) => (
            <div key={m.id} className={styles.msg}>
              <div className={styles.msgHead}>
                <TalkFace who={m.author} />
                <span className={styles.msgName}>{m.author.name}</span>
                {m.author.kind === "agent" && <span className={styles.msgKind}>· agent</span>}
                {m.ask && <span className={styles.msgKind}>· asks</span>}
                <span className={styles.msgTime}>{timeShort(m.at, now)}</span>
                <button type="button" className={`min-h-[44px] ${styles.report}`} onClick={() => setReporting(m)} aria-label={`Report message by ${m.author.name}`}>Report</button>
              </div>
              <p className={m.author.kind === "agent" ? styles.agentText : styles.text}>{m.text}</p>
              {m.ask && (
                <div className={styles.askRow}>
                  {m.taken ? (
                    <span className={styles.askTaken}>{m.taken.name} can</span>
                  ) : signedIn ? (
                    <Button variant="tertiary" size="sm" className="min-h-[44px]" disabled={taking !== null} onClick={() => take(m.id)}>I can</Button>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div ref={endRef} />

      <form className={styles.composer} onSubmit={send} aria-label="Write a message">
        {signedIn ? (
          <>
            {ask && (
              <div className={styles.asking}>
                <span>Asking a favour. It pays nothing.</span>
                <button type="button" className={`min-h-[44px] ${styles.report}`} onClick={() => setAsk(false)}>Cancel</button>
              </div>
            )}
            <div className={styles.composerRow}>
              <button type="button" className={`min-h-[44px] ${styles.plus}`} onClick={() => setPlus(true)} aria-label="More">+</button>
              <div className={styles.composerField}>
                <TextArea ref={fieldRef} label={ask ? "Can someone…" : "Message"} value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX} rows={1} disabled={sending} />
              </div>
              <Button type="submit" size="sm" className="min-h-[44px]" disabled={sending || !text.trim()}>Send</Button>
            </div>
            {left < 60 && <div className={styles.asking} style={{ margin: "6px 4px 0" }}><span className={styles.counter}>{left}</span></div>}
          </>
        ) : (
          <p className={styles.composerLine}>{SIGN_IN_LINE}</p>
        )}
      </form>

      <Drawer open={plus} onOpenChange={setPlus} height="fit">
        <DrawerContent>
          <div className={styles.sheet}>
            <DrawerHeader><DrawerTitle>Add</DrawerTitle></DrawerHeader>
            <div className={styles.sheetActions}>
              <Button variant="tertiary" fullWidth className="min-h-[44px]" onClick={() => { setAsk(true); setPlus(false); setTimeout(() => fieldRef.current?.focus(), 50); }}>Ask a favour</Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={reporting !== null} onOpenChange={(open) => { if (!open) setReporting(null); }} height="fit">
        <DrawerContent>
          <div className={styles.sheet}>
            <DrawerHeader><DrawerTitle>Report this message?</DrawerTitle></DrawerHeader>
            {reporting && <p className={styles.sheetLine}>{reporting.author.name}: {Array.from(reporting.text).length > 80 ? `${Array.from(reporting.text).slice(0, 80).join("")}…` : reporting.text}</p>}
            <div className={styles.sheetActions}>
              {signedIn ? (
                <Button variant="secondary" fullWidth className={`min-h-[44px] ${styles.danger}`} onClick={() => reporting && report(reporting)}>Report</Button>
              ) : (
                <p className={styles.sheetLine}>Open FAVOUR in World App to report.</p>
              )}
              <DrawerClose asChild><Button variant="tertiary" fullWidth className="min-h-[44px]">Cancel</Button></DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
