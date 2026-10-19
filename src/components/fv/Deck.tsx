"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeckCard, Reaction, Streak } from "@/lib/deck-view";
import { REACTIONS, bumpStreak, dayKey, readStreak, rightLabel } from "@/lib/deck-view";
import { hueOf } from "@/lib/campaign-picture";
import { DeckCardView } from "@/components/fv/DeckCardView";
import { Loud } from "@/components/fv/Loud";
import { SignInSheet } from "@/components/fv/SignInSheet";
import { displayName } from "@/hooks/useWorldUser";

// THE DECK SCREEN (Oscar, 19 Oct 2026: "fun app, slide through showing product
// images, and hacker news"). One big card. Drag it right to try and review,
// left to skip, or tap the buttons. Fire and Meh are quick reactions. The
// streak and today's count are the viewer's own, kept in localStorage; points
// stay the server's number. The first visit shows one role card, not a wall.

export type DeckAuth = { userId: string | null; isInWorldApp: boolean; isVerifying: boolean; authError: string | null; onVerify: () => void };

const COMMIT_PX = 96;
const K_STREAK = "favour_streak";
const K_SEEN = "favour_seen";
const K_ROLE = "favour_role";
const K_REACT = "favour_reactions";

function readJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

export function DeckView({ cards, index, streak, dx, leaving, settling, role, onPointerDown, onPointerMove, onPointerUp, onSwipe, onReact, onRole, signedInAs, onSignIn, error }: {
  cards: DeckCard[] | null; index: number; streak: Streak | null; dx: number; leaving: "left" | "right" | null; settling: boolean; role: string | null;
  onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: (e: React.PointerEvent) => void;
  onSwipe: (dir: "left" | "right") => void; onReact: (r: Reaction) => void; onRole: (r: "build" | "try") => void;
  signedInAs: string | null; onSignIn: () => void; error: string | null;
}) {
  const top = cards?.[index] ?? null;
  const stack = cards ? cards.slice(index, index + 3) : [];
  const rot = Math.max(-10, Math.min(10, dx / 12));
  return (
    <div className="fv min-h-screen max-w-lg mx-auto flex flex-col">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 h-14 flex items-center justify-between gap-3">
        <h1 className="fv-h">FAVOUR</h1>
        <div className="flex items-center gap-4">
          <p className="fv-body fv-num text-[12px]" aria-label="Streak">
            <span className="fv-h fv-blue fv-tick" data-bump={streak && streak.today > 0 ? "true" : "false"}>{streak?.days ?? 0}</span> day{(streak?.days ?? 0) === 1 ? "" : "s"} · {streak?.today ?? 0} today
          </p>
          {signedInAs ? (
            <Link href="/dashboard" className="fv-body underline underline-offset-2 truncate max-w-[96px]">{signedInAs}</Link>
          ) : (
            <button type="button" onClick={onSignIn} className="fv-body underline underline-offset-2 min-h-[44px]">Sign in</button>
          )}
        </div>
      </header>

      <div className="px-4 pt-4 flex-1 flex flex-col gap-3">
        {role === null && (
          <section className="fv-box p-5 flex flex-col gap-3" aria-label="Pick your role">
            <p className="fv-label">People are shipping more than ever</p>
            <p className="fv-title">Real humans try what you vibe coded.</p>
            <p className="fv-body">Swipe through products. Right to try one and get paid for an honest review. Left to skip. Builders post their app and fund the reviews.</p>
            <div className="flex gap-2">
              <button type="button" className="fv-btn fv-btn-sm flex-1" onClick={() => onRole("build")}>I build</button>
              <button type="button" className="fv-btn fv-btn-sm fv-btn-ink flex-1" onClick={() => onRole("try")}>I try things</button>
            </div>
          </section>
        )}

        {error && <p role="alert" className="fv-body">{error}</p>}
        {!error && cards === null && <div className="fv-deck"><div className="fv-deck-card p-5"><p className="fv-body">Shuffling the deck…</p></div></div>}
        {cards && cards.length === 0 && (
          <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">The deck is empty</p><p className="fv-body">Post your app and it is the first card.</p><Link href="/post" className="fv-btn fv-btn-ink">Post your app</Link></div>
        )}
        {cards && top && (
          <div className="fv-deck" aria-live="polite">
            {[...stack].reverse().map((c, i) => {
              const depth = stack.length - 1 - i;
              const isTop = depth === 0;
              return (
                <article
                  key={c.id}
                  data-project={c.id}
                  data-depth={depth}
                  data-leaving={isTop && leaving ? leaving : undefined}
                  data-settling={isTop && settling ? "true" : undefined}
                  className="fv-deck-card"
                  style={isTop && !leaving ? { transform: `translateX(${dx}px) rotate(${rot}deg)` } : undefined}
                  onPointerDown={isTop ? onPointerDown : undefined}
                  onPointerMove={isTop ? onPointerMove : undefined}
                  onPointerUp={isTop ? onPointerUp : undefined}
                  onPointerCancel={isTop ? onPointerUp : undefined}
                >
                  <DeckCardView c={c} />
                  {isTop && (
                    <>
                      <span className="fv-deck-stamp" data-side="right" data-show={dx > 40 ? "true" : "false"}>{rightLabel(c)}</span>
                      <span className="fv-deck-stamp" data-side="left" data-show={dx < -40 ? "true" : "false"}>Skip</span>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {cards && top && (
          <div className="fv-deck-controls pb-4">
            <button type="button" className="fv-btn fv-btn-sm" onClick={() => onSwipe("left")} aria-label="Skip">Skip</button>
            {REACTIONS.map((r) => (
              <button key={r.key} type="button" className="fv-chip" onClick={() => onReact(r.key)} aria-label={`React ${r.label}`}>{r.label}</button>
            ))}
            <button type="button" className="fv-btn fv-btn-sm fv-btn-ink" onClick={() => onSwipe("right")} aria-label={rightLabel(top)}>{top.source === "hn" ? "Looks good" : top.live ? "Review" : top.projectId ? "Try it" : "Try it"}</button>
          </div>
        )}
        {cards && top && (
          <p className="fv-body text-[12px] fv-num pb-4">{index + 1} of {cards.length} · <Link href="/apps" className="underline underline-offset-2">See the list</Link> · <Link href="/board" className="underline underline-offset-2">Old board</Link></p>
        )}
      </div>
    </div>
  );
}

export function Deck({ auth }: { auth: DeckAuth }) {
  const router = useRouter();
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [role, setRole] = useState<string | null>("try");
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [settling, setSettling] = useState(false);
  const [loud, setLoud] = useState<{ num: string; line: string; hue: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const drag = useRef<{ x: number; id: number } | null>(null);

  useEffect(() => {
    setStreak(readStreak(readJson<unknown>(K_STREAK, null)));
    setRole(readJson<string | null>(K_ROLE, null));
    fetch("/api/deck", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body?.cards)) throw new Error(body?.error ?? "The deck could not be read. Try again.");
        const seen = new Set<string>(readJson<string[]>(K_SEEN, []));
        const list = body.cards as DeckCard[];
        // Cards seen today go to the back on the client too, so a reload keeps the place.
        const fresh = list.filter((c) => !seen.has(c.id));
        setCards([...fresh, ...list.filter((c) => seen.has(c.id))]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const markSeen = useCallback((id: string) => {
    const seen = readJson<{ day: string; ids: string[] }>(K_SEEN + "_v2", { day: dayKey(), ids: [] });
    const today = dayKey();
    const ids = seen.day === today ? seen.ids : [];
    if (!ids.includes(id)) ids.push(id);
    writeJson(K_SEEN + "_v2", { day: today, ids });
    writeJson(K_SEEN, ids);
  }, []);

  const advance = useCallback((dir: "left" | "right") => {
    const c = cards?.[index];
    if (!c) return;
    setLeaving(dir);
    markSeen(c.id);
    const next = bumpStreak(streak);
    const firstToday = !streak || streak.last !== next.last;
    setStreak(next);
    writeJson(K_STREAK, next);
    setTimeout(() => {
      setLeaving(null);
      setDx(0);
      setIndex((i) => i + 1);
      if (firstToday && next.days > 1) setLoud({ num: `${next.days}`, line: `days in a row. Keep going.`, hue: hueOf(c.name) });
      if (dir === "right") {
        if (c.source === "hn") {
          const r = readJson<Record<string, Reaction>>(K_REACT, {}); r[c.id] = "try"; writeJson(K_REACT, r);
        } else if (c.projectId) {
          router.push(`/project/${encodeURIComponent(c.projectId)}`);
        } else {
          window.open(c.url, "_blank", "noopener,noreferrer");
        }
      }
    }, 250);
  }, [cards, index, streak, markSeen, router]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (leaving) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    setSettling(false);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDx(e.clientX - drag.current.x);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const d = e.clientX - drag.current.x;
    drag.current = null;
    if (d > COMMIT_PX) advance("right");
    else if (d < -COMMIT_PX) advance("left");
    else { setSettling(true); setDx(0); }
  };

  const onReact = (r: Reaction) => {
    const c = cards?.[index];
    if (!c) return;
    const all = readJson<Record<string, Reaction>>(K_REACT, {}); all[c.id] = r; writeJson(K_REACT, all);
    advance("left");
  };

  const onRole = (r: "build" | "try") => {
    writeJson(K_ROLE, r); setRole(r);
    if (r === "build") router.push("/post");
  };

  return (
    <>
      <DeckView
        cards={cards} index={index} streak={streak} dx={dx} leaving={leaving} settling={settling} role={role}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onSwipe={advance} onReact={onReact} onRole={onRole}
        signedInAs={auth.userId ? displayName(auth.userId) : null} onSignIn={() => setSheet(true)} error={error}
      />
      {loud && <Loud num={loud.num} line={loud.line} hue={loud.hue} onDone={() => setLoud(null)} />}
      {sheet && !auth.userId && (
        <div className="fv"><SignInSheet why="Sign in to take part." isInWorldApp={auth.isInWorldApp} busy={auth.isVerifying} error={auth.authError} onSignIn={auth.onVerify} onClose={() => setSheet(false)} /></div>
      )}
    </>
  );
}
