"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { HUNT_SIZE, huntLine, type HuntApp } from "@/lib/daily-hunt";
import { Button } from "./Kit";
import kit from "./Kit.module.css";
import styles from "./Hunt.module.css";

// TODAY'S HUNT, THE FIRST TAB (Oscar, 8 Oct 2026: "make it fun, gamified. a
// place you want to check the apps", "the apple and world app feeling"). Idea D
// of the four directions, with the slide-up sheet of idea C.
//
// Four things, top to bottom, and nothing else:
//   the bar      the word FAVOUR, and the person's points when they are known
//   the card     "Today's hunt", three stamp slots, one status line
//   the rail     the apps, sideways: picture, name, one line, one grey pill
//   the door     "Post your own app"
// One tap on a tile opens the app in a sheet: picture, name, line, and the
// buttons. "Vote" is quiet and is shown only for an app that can take a vote.
// The dark button is the next step: "Review · N pts" on FAVOUR, "Open" elsewhere.
//
// A stamp means one thing: this wallet voted for the app, or sent a review of
// it that passed, today. The slots fill with the app's own picture. Days in a
// row is printed only when the server gave 2 or more. Nothing here is a guess:
// an unknown count draws as an empty card, never as a number.
//
// Movement: the sheet slides up once, slowly. Nothing else moves.

export type HuntState = {
  stamps: string[] | null; // null: unknown (signed out, or could not be read)
  streak: number | null;
};

const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";
const pillWord = (a: HuntApp, stamped: boolean) =>
  stamped ? "Checked" : a.kind === "favour" ? `Review · ${a.points} pts` : a.kind === "vote" ? "Vote" : "Open";

function Tile({ app, stamped, onOpen }: { app: HuntApp; stamped: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={`${styles.tile} min-h-[72px]`} onClick={onOpen} aria-label={`${app.name}: open`}>
        {app.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.picture} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.tilePic} />
        ) : (
          <span className={styles.tileNone} aria-hidden="true">{initialOf(app.name)}</span>
        )}
        <span className={styles.tileText}>
          <span className={styles.tileName}>{app.name}</span>
          <span className={styles.tileLine}>{app.line ?? app.host}</span>
          <span className={`${styles.tilePill} ${stamped ? styles.tilePillOn : ""}`}>{pillWord(app, stamped)}</span>
        </span>
      </button>
    </li>
  );
}

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
  apps, hunt, points, open, voting = false, voteProblem = null, onOpen, onClose, onVote, onPost,
}: {
  apps: HuntApp[];
  hunt: HuntState;
  points: number | null; // the signed-in person's points, or null when not known
  open: HuntApp | null; // the app in the sheet
  voting?: boolean;
  voteProblem?: string | null;
  onOpen: (app: HuntApp) => void;
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
        {points !== null && <span className={`${styles.pts} text-amber-600`} aria-label={`${points} points`}>{points} pts</span>}
      </div>

      <div className={styles.hunt}>
        <h2 className={styles.huntTitle}>Today&apos;s hunt</h2>
        <p className={styles.huntLine}>{huntLine(hunt.stamps)}</p>
        <div className={styles.stamps}>
          {slots.map((s, i) => <Stamp key={i} app={s} n={i + 1} />)}
        </div>
        {hunt.streak !== null && hunt.streak >= 2 && <p className={styles.streak}>Day {hunt.streak} in a row</p>}
      </div>

      <h2 className={styles.label}>Apps to check</h2>
      <ul className={styles.rail} aria-label="Apps to check">
        {apps.map((a) => <Tile key={`${a.kind}:${a.id}`} app={a} stamped={!!a.stamp && stamped.has(a.stamp)} onOpen={() => onOpen(a)} />)}
      </ul>

      <div className={styles.door}>
        <Button kind="quiet" wide onClick={onPost}>Post your own app</Button>
      </div>

      {/* The sheet (idea C). Always mounted so the slide can run; hidden when closed. */}
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
