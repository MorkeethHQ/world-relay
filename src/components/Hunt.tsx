"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { HUNT_SIZE, huntLine, type HuntApp } from "@/lib/daily-hunt";
import type { FeedCard } from "@/lib/feed";
import { Button } from "./Kit";
import kit from "./Kit.module.css";
import { ProjectFeed } from "./ProjectFeed";
import styles from "./Hunt.module.css";

// TODAY'S HUNT, THE FIRST TAB (Oscar, 8 Oct 2026: "make it fun, gamified. a
// place you want to check the apps", "the apple and world app feeling"). Idea D
// of the four directions, with the slide-up sheet of idea C.
//
// Four things, top to bottom, and nothing else:
//   the bar      the word FAVOUR, and the person's points when they are known
//   the card     "Today's hunt", three stamp slots, one status line
//   the feed     one project card per app (ProjectFeed, 9 Oct 2026: "Project
//                cards A for sure"), which replaced the sideways rail
//   the door     "Post your own app"
// A card's picture or name opens /p/<id>. "Vote" votes, "Review" goes to the
// product screen, "Talk" to the room. The sheet of idea C is kept below but
// nothing opens it since the cards replaced the rail.
//
// A stamp means one thing: this wallet voted for the app, or sent a review of
// it that passed, today. The slots fill with the app's own picture. Days in a
// row is printed only when the server gave 2 or more. Nothing here is a guess:
// an unknown count draws as an empty card, never as a number.
//
// Colour (Oscar, 9 Oct 2026: "only black though"): ink, white and gray on this
// tab, the points in the bar included. Movement: the sheet slides up once,
// slowly. Nothing else moves.

export type HuntState = {
  stamps: string[] | null; // null: unknown (signed out, or could not be read)
  streak: number | null;
};

const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

function Stamp({ app, n }: { app: HuntApp | "unknown" | null; n: number }) {
  if (!app) return <div className={styles.stamp} aria-label={`Stamp ${n}: empty`}>{n}</div>;
  if (app === "unknown") return <div className={`${styles.stamp} ${styles.stampOn}`} aria-label={`Stamp ${n}: filled`}>✓</div>;
  return (
    <div className={`${styles.stamp} ${styles.stampOn}`} aria-label={`Stamp ${n}: ${app.name}`}>
      {app.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.picture} alt="" referrerPolicy="no-referrer" />
      ) : (
        initialOf(app.name)
      )}
    </div>
  );
}

export function Hunt({
  apps, cards, hunt, points, open, voting = false, voteProblem = null, onClose, onVote, onPost,
}: {
  apps: HuntApp[];
  cards: FeedCard[];
  hunt: HuntState;
  points: number | null; // the signed-in person's points, or null when not known
  open: HuntApp | null; // the app in the sheet
  voting?: boolean;
  voteProblem?: string | null;
  onClose: () => void;
  onVote: (app: HuntApp) => void;
  onPost: () => void;
}) {
  const stamps = hunt.stamps ?? [];
  const stamped = new Set(stamps);
  const byStamp = new Map(apps.filter((a) => a.stamp).map((a) => [a.stamp!, a]));
  const slots: Array<HuntApp | "unknown" | null> = Array.from({ length: HUNT_SIZE }, (_, i) => {
    const id = stamps[i];
    return id ? byStamp.get(id) ?? "unknown" : null;
  });
  const sheetRef = useRef<HTMLDivElement>(null);

  // Escape closes the sheet; the sheet takes focus while it is open.
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const openStamped = !!open?.stamp && stamped.has(open.stamp);
  let next: ReactNode = null;
  if (open?.kind === "favour") {
    next = <Button href={`/p/${encodeURIComponent(open.id)}`} label={`Review ${open.name} for ${open.points} points`}>Review · {open.points} pts</Button>;
  } else if (open) {
    next = <a href={open.url} target="_blank" rel="noopener noreferrer nofollow" className={`${kit.primary} min-h-[44px]`}>Open</a>;
  }

  return (
    <section aria-label="Today's hunt">
      <div className={styles.bar}>
        <span className={styles.word}>FAVOUR</span>
        {points !== null && <span className={styles.pts} aria-label={`${points} points`}>{points} pts</span>}
      </div>

      <div className={styles.hunt}>
        <h2 className={styles.huntTitle}>Today&apos;s hunt</h2>
        <p className={styles.huntLine}>{huntLine(hunt.stamps)}</p>
        <div className={styles.stamps}>
          {slots.map((s, i) => <Stamp key={i} app={s} n={i + 1} />)}
        </div>
        {hunt.streak !== null && hunt.streak >= 2 && <p className={styles.streak}>Day {hunt.streak} in a row</p>}
      </div>

      <ProjectFeed
        cards={cards}
        stamps={stamped}
        voting={voting}
        voteProblem={open ? null : voteProblem}
        onVote={(c) => { const a = apps.find((x) => x.kind === "vote" && x.id === c.id); if (a) onVote(a); }}
      />

      <div className={styles.door}>
        <Button kind="quiet" wide onClick={onPost}>Post your own app</Button>
      </div>

      {/* The sheet (idea C). Kept since 9 Oct 2026 though nothing opens it: the cards replaced the rail. */}
      <button type="button" className={`${styles.scrim} ${open ? styles.scrimOpen : ""} min-h-[44px]`} onClick={onClose} aria-label="Close" tabIndex={open ? 0 : -1} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-label={open?.name ?? "App"}
        aria-hidden={open ? undefined : true}
        tabIndex={-1}
        className={`${styles.sheet} ${open ? styles.sheetOpen : ""}`}
      >
        <button type="button" className={`${styles.grab} min-h-[44px]`} onClick={onClose} aria-label="Close" tabIndex={open ? 0 : -1}><span /></button>
        {open && (
          <>
            {open.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.picture} alt="" referrerPolicy="no-referrer" className={styles.sheetPic} />
            ) : (
              <span className={styles.sheetNone} aria-hidden="true">{initialOf(open.name)}</span>
            )}
            <h3 className={styles.sheetName}>{open.name}</h3>
            {open.line && <p className={styles.sheetLine}>{open.line}</p>}
            {open.kind === "launch" ? (
              <p className={styles.sheetFrom}>From {open.source} · {open.score} points</p>
            ) : (
              <p className={styles.sheetFrom}>{open.host}</p>
            )}
            <div className={styles.acts}>
              {open.kind === "vote" && (
                <Button kind="quiet" onClick={() => onVote(open)} disabled={open.mine || openStamped || voting} label={open.mine ? `You voted for ${open.name}` : `Vote for ${open.name}`}>
                  {voting ? "…" : open.mine || openStamped ? (open.votes === null ? "Voted" : `Voted · ${open.votes}`) : "Vote"}
                </Button>
              )}
              {next}
            </div>
            {voteProblem && <p role="alert" className={styles.problem}>{voteProblem}</p>}
          </>
        )}
      </div>
    </section>
  );
}
