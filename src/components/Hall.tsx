"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import type { FirstPage } from "@/lib/first-page";
import { hallApps, hallOf, PODIUM, votesLabel, type Hall as HallLists, type HallApp, type RankedApp } from "@/lib/hall";
import type { VoteRow } from "@/lib/product-votes";
import { TalkPicture } from "@/components/TalkPicture";
import talk from "./Talk.module.css";
import styles from "./Hall.module.css";

// THE HALL: the History tab as a leaderboard of apps (Oscar, 9 Oct 2026: "get
// like a new product hunt early tools vibe", "i like the hall, but to keep the
// banner from Days with usdc, pts and reached out, only black though").
// DESIGN-SYSTEM.md, "History". Drawn with World's kit on a white page like Talk.
//
// The banner: three cells from /api/stats, drawn only when the server gave all
// three, every number and label in ink and gray. A switch, "Top" and "New".
// Top: the first three as a podium of pictures, the rest as rows, ranked by
// lib/hall.ts. An app whose count the server did not give has no rank and sits
// under the ranked ones with no number. No count anywhere: the apps are a
// shelf of pictures and the screen says so. New: newest first. A tap opens the
// project page /p/<id>, which serves all three kinds of app. The apps come
// from /api/top and /api/votes, the same two reads as the first tab. Nothing
// is made up. No "this week" and no "maker of the week": votes carry no date
// and no maker read exists.

type Stats = { users?: { reached?: number; verified?: number }; volume?: { paidOutUsdc?: number; pointsDistributed?: number } };
type Totals = { paid: number; points: number; people: number };
type Apps = { kind: "loading" } | { kind: "error" } | { kind: "ready"; hall: HallLists; count: number };
type View = "top" | "new";

const json = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

/** The three totals, or null when the server did not give all three. */
export function totalsOf(stats: unknown): Totals | null {
  const s = stats as Stats | null;
  const paid = s?.volume?.paidOutUsdc, points = s?.volume?.pointsDistributed, people = s?.users?.reached ?? s?.users?.verified;
  if (typeof paid !== "number" || typeof points !== "number" || typeof people !== "number") return null;
  return { paid, points: Math.round(points), people };
}

/** The line under a name on the New list. A product says when it was posted, a launch where it is from. */
export function newLine(a: HallApp, now: number = Date.now()): string | null {
  if (a.postedAt) {
    const days = Math.floor((now - (Date.parse(a.postedAt) || now)) / 86_400_000);
    return days < 1 ? "Posted today" : days === 1 ? "Posted yesterday" : `Posted ${days} days ago`;
  }
  if (a.source) return `From ${a.source}`;
  if (typeof a.votes === "number") return votesLabel(a.votes);
  return "Up for a vote";
}

async function readApps(): Promise<Apps> {
  const page = await fetch("/api/top", { cache: "no-store" }).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.top) throw new Error("unreadable");
    return data as FirstPage;
  });
  const votes = await json<{ rows: VoteRow[] }>("/api/votes");
  const apps = hallApps(page, votes && Array.isArray(votes.rows) ? votes.rows : []);
  return { kind: "ready", hall: hallOf(apps), count: apps.length };
}

function Rank({ n }: { n: number }) {
  return <span className={styles.rank} aria-hidden="true">{n}</span>;
}

export function Hall() {
  const router = useRouter();
  const [apps, setApps] = useState<Apps>({ kind: "loading" });
  // undefined until /api/stats answered; null when it gave no usable totals.
  const [totals, setTotals] = useState<Totals | null | undefined>(undefined);
  const [view, setView] = useState<View>("top");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    readApps().then((next) => { if (live) setApps(next); }).catch(() => { if (live) setApps({ kind: "error" }); });
    json<unknown>("/api/stats").then((s) => { if (live) setTotals(totalsOf(s)); });
    return () => { live = false; };
  }, [attempt]);

  const open = (id: string) => router.push(`/p/${encodeURIComponent(id)}`);
  const retry = () => { setApps({ kind: "loading" }); setTotals(undefined); setAttempt((n) => n + 1); };
  const hall = apps.kind === "ready" ? apps.hall : null;
  const count = apps.kind === "ready" ? apps.count : 0;

  const tile = (a: RankedApp, side: boolean) => (
    <button key={a.id} type="button" className={`min-h-[44px] ${styles.tile} ${side ? styles.side : ""}`} onClick={() => open(a.id)} aria-label={`${a.name}, rank ${a.rank}, ${votesLabel(a.votes as number)}`}>
      <span className={styles.picWrap}>
        <TalkPicture name={a.name} url={a.picture} icon={a.icon} colour={null} shape="tile" />
        <Rank n={a.rank} />
      </span>
      <span className={styles.tileName}>{a.name}</span>
      <span className={styles.count}>{votesLabel(a.votes as number)}</span>
    </button>
  );
  const slot = (rank: number, side: boolean) => (
    <span key={`slot-${rank}`} className={`${styles.tile} ${side ? styles.side : ""}`} aria-label={`Rank ${rank}, open`}>
      <span className={styles.slot}><Rank n={rank} /></span>
      <span className={styles.slotWord}>Open</span>
      <span className={styles.slotSpace} aria-hidden="true" />
    </span>
  );
  const place = (rank: number) => {
    const a = hall?.ranked[rank - 1];
    return a ? tile(a, rank !== 1) : slot(rank, rank !== 1);
  };

  const row = (a: HallApp, rank: number | null, line: string | null) => (
    <button key={a.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => open(a.id)} aria-label={rank ? `${a.name}, rank ${rank}` : a.name}>
      {rank !== null && <span className={styles.rowRank}>{rank}</span>}
      <TalkPicture name={a.name} url={a.picture} icon={a.icon} colour={null} shape="square" />
      <span className={styles.rowText}>
        <span className={styles.rowName}>{a.name}</span>
        {line && <span className={styles.rowLine}>{line}</span>}
      </span>
    </button>
  );

  const toHunt = (
    <div className={styles.action}>
      <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push("/")}>Today&apos;s hunt</Button>
    </div>
  );

  return (
    <div className={talk.screen} aria-label="History">
      <TopBar title="History" endAdornment={apps.kind === "ready" && apps.count > 0 ? <Chip label={`${apps.count} ${apps.count === 1 ? "app" : "apps"}`} /> : undefined} />
      <div className={styles.body}>
        {totals ? (
          <div className={styles.totals} aria-label="FAVOUR totals">
            <div className={styles.cell}><b>{totals.paid.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b><small>USDC paid</small></div>
            <div className={styles.cell}><b>{totals.points.toLocaleString("en-US")}</b><small>pts</small></div>
            <div className={styles.cell}><b>{totals.people.toLocaleString("en-US")}</b><small>people reached</small></div>
          </div>
        ) : totals === null ? (
          <p className={styles.cap} style={{ marginTop: 8 }}>FAVOUR&apos;s totals could not be read.</p>
        ) : null}

        <div className={styles.seg} role="tablist" aria-label="Top or new">
          <button type="button" role="tab" className="min-h-[44px]" aria-selected={view === "top"} onClick={() => setView("top")}>Top</button>
          <button type="button" role="tab" className="min-h-[44px]" aria-selected={view === "new"} onClick={() => setView("new")}>New</button>
        </div>

        {apps.kind === "loading" && <p className={styles.line}>Reading…</p>}

        {apps.kind === "error" && (
          <>
            <p className={styles.line}>The apps could not be read.</p>
            <div className={styles.action}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={retry}>Try again</Button>
            </div>
          </>
        )}

        {hall && count === 0 && (
          <>
            <p className={styles.line}>No app yet.</p>
            {toHunt}
          </>
        )}

        {hall && count > 0 && view === "top" && hall.hasRanks && (
          <>
            <div className={styles.podium} role="list" aria-label="The podium">
              {[2, 1, 3].map(place)}
            </div>
            {hall.ranked.length > PODIUM && (
              <div className={styles.rows}>{hall.ranked.slice(PODIUM).map((a) => row(a, a.rank, votesLabel(a.votes as number)))}</div>
            )}
            {hall.unranked.length > 0 && (
              <>
                <p className={styles.cap}>No vote counted yet</p>
                <div className={styles.rows}>{hall.unranked.map((a) => row(a, null, newLine(a)))}</div>
              </>
            )}
          </>
        )}

        {hall && count > 0 && view === "top" && !hall.hasRanks && (
          <>
            <p className={styles.line}>No vote counted yet. Every app is in.</p>
            <div className={styles.shelf} aria-label="The apps">
              {hall.unranked.map((a) => (
                <button key={a.id} type="button" className={`min-h-[44px] ${styles.tile}`} onClick={() => open(a.id)} aria-label={a.name}>
                  <TalkPicture name={a.name} url={a.picture} icon={a.icon} colour={null} shape="tile" />
                  <span className={styles.tileName}>{a.name}</span>
                </button>
              ))}
            </div>
            {toHunt}
          </>
        )}

        {hall && count > 0 && view === "new" && (
          <div className={styles.rows}>{hall.newest.map((a) => row(a, null, newLine(a)))}</div>
        )}

        {/* Polls left the nav on 9 Oct 2026. The prediction archive holds existing
            stakes, so the old page stays reachable from this one quiet row. */}
        <div className={styles.end}>
          <Button variant="tertiary" size="sm" fullWidth className="min-h-[44px]" onClick={() => router.push("/polls")}>Old polls and predictions</Button>
        </div>
      </div>
    </div>
  );
}
