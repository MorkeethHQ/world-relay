"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import type { Task } from "@/lib/types";
import type { Contribution } from "@/lib/completions";
import type { PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import { isWelcomeSourceRow, type WelcomeView } from "@/lib/welcome-shape";
import { curateBoard, isBoardVisible, isStale, leadWithDoable, pickDailyMission, rankBoard } from "@/lib/board-rank";
import { pickCampaignToDo, rankCampaignCards } from "@/lib/company-door";
import { pickCampaignStage } from "@/lib/campaign-stage";
import { reviewEntryFor } from "@/lib/review-entry";
import { JUDGE_MIN_GRADED } from "@/lib/jury-appeal-rules";
import { isFunded, isPointsReward, isRealMoney, rewardAmountLabel } from "@/lib/reward";
import { authorLabel } from "@/lib/authorship";
import { useWorldUsers } from "@/hooks/useWorldUser";
import { hapticTap } from "@/lib/minikit-helpers";
import { JuryMode, type JuryCard } from "@/components/JuryMode";
import { FeedComposer, QuickPost, SubmitProof } from "@/components/Feed";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Bar, Loader } from "@/components/Fill";
import talk from "./Talk.module.css";
import styles from "./FavoursBoard.module.css";

// THE FAVOURS BOARD, the Favours tab (Oscar, 10 Oct 2026: "favour page is
// completly undesigned not good"; "we should have like a loading state a fill
// up, we can gamify favour SO MUCH! it's the new product hunt, i love it").
// DESIGN-SYSTEM.md, "Favours tab". Drawn with World's kit on a white page like
// Talk and the Hall. A skin on the old board (`Feed.tsx`): the same reads, the
// same ranking calls in the same order, nothing sorted or filtered here, and the
// same three steps Feed opens: `SubmitProof` to do a favour, `QuickPost` and
// `FeedComposer` to ask one. They are exported from Feed.tsx and not rewritten.
//
// Every bar on this screen is a real fraction: Welcome steps done of total, a
// favour's accepted replies of its target, graded calls of the ten that qualify
// a reviewer. A zero is drawn as a zero. The one bar with no number is the
// loader, and it fills while the board is read.

type Props = { userId: string | null; verificationLevel?: string | null; onLogout?: () => void; onReauth?: () => void };
type Read = { kind: "loading" } | { kind: "error" } | { kind: "ready"; tasks: Task[] };
type JudgeRecord = { judged: number; correct: number } | null;
type View = "board" | "jury" | "proof" | "post";

const WALLET = /^0x[0-9a-fA-F]{40}$/;

const json = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

// The same location read as the old board (`Feed.tsx`, useUserLocation), so
// proximity ranks the same way: a fix cached for a day under the same key.
function useUserLocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) return;
    const CACHE_KEY = "favour_geo";
    const MAX_AGE_MS = 24 * 3600_000;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c.lat === "number" && typeof c.lng === "number" && Date.now() - c.ts < MAX_AGE_MS) {
          setCoords({ lat: c.lat, lng: c.lng });
          return;
        }
      }
    } catch {}
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...c, ts: Date.now() })); } catch {}
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);
  return coords;
}

/** Who asked, never a wallet address: an agent's label, a username, or "A person". */
export function whoAsked(task: Pick<Task, "poster" | "agent">, name: (address: string) => string): string {
  const agent = authorLabel(task);
  if (agent) return agent;
  const n = name(task.poster);
  return n.startsWith("@") ? `${n} asked` : "A person asked";
}

/** "N of M done" for a favour that takes many replies; null for a single reply. */
export function targetLine(task: Pick<Task, "maxCompletions" | "completionCount">): { done: number; of: number } | null {
  const of = task.maxCompletions ?? 1;
  if (of <= 1) return null;
  return { done: Math.min(task.completionCount ?? 0, of), of };
}

/** This person's own contributions that landed today, UTC: how many, and the points the server paid for them. */
export function todayOf(contributions: readonly Contribution[], now: number = Date.now()): { done: number; points: number } {
  const day = new Date(now).toISOString().slice(0, 10);
  const mine = contributions.filter((c) => typeof c.at === "string" && c.at.slice(0, 10) === day);
  return { done: mine.length, points: Math.round(mine.reduce((s, c) => s + (Number.isFinite(c.points) ? c.points : 0), 0)) };
}
export const doneToday = (contributions: readonly Contribution[], now?: number) => todayOf(contributions, now).done;

// The bar and the loader are the shared fill-up in Fill.tsx (lifted 10 Oct
// 2026 so Profile and the project page fill the same way). A bar mounts empty
// and fills to its value once; the loader's track fills while the board is read.

function Reward({ task }: { task: Task }) {
  // reward.ts writes the amount. Ink for points. Green for funded USDC only;
  // a USDC favour with no deposit is gray and says so.
  const points = isPointsReward(task);
  const funded = !points && isRealMoney(task);
  const unfunded = !points && !isFunded(task);
  return (
    <span className={`${styles.reward} ${funded ? styles.money : ""} ${unfunded ? styles.unfunded : ""}`} data-funded={points ? "points" : funded ? "yes" : "no"}>
      <b>{rewardAmountLabel(task)}</b>
      {unfunded && <small>{task.rewardType === "usdc-v2" ? "Funds on accept" : "Not funded"}</small>}
    </span>
  );
}

export function FavoursBoard({ userId, onReauth }: Props) {
  const router = useRouter();
  const walletUser = !!userId && WALLET.test(userId);
  const userLocation = useUserLocation();

  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [welcome, setWelcome] = useState<WelcomeView | null>(null);
  const [welcomeBusy, setWelcomeBusy] = useState<string | null>(null);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const [companyCampaigns, setCompanyCampaigns] = useState<PublicCompanyCampaign[]>([]);
  const [reviewDeck, setReviewDeck] = useState<JuryCard[]>([]);
  const [reviewWaiting, setReviewWaiting] = useState(0);
  const [reviewFlagged, setReviewFlagged] = useState(0);
  const [reviewRecord, setReviewRecord] = useState<JudgeRecord>(null);
  const [reviewKey, setReviewKey] = useState(0);
  const [view, setView] = useState<View>("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Where the proof step returns to: the Welcome card when it was opened there.
  const [proofFrom, setProofFrom] = useState<"board" | "welcome">("board");
  const [askOpen, setAskOpen] = useState(false);

  // The board itself. The one read whose failure is the error state.
  const readTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.tasks)) throw new Error("unreadable");
      setRead({ kind: "ready", tasks: data.tasks as Task[] });
    } catch {
      // A failed re-read on return keeps the board that was read; only a board
      // never read becomes the error state (the old board did the same).
      setRead((r) => (r.kind === "ready" ? r : { kind: "error" }));
    }
  }, []);

  useEffect(() => {
    readTasks();
    // World App keeps the webview alive in the background: read again on return.
    const onVisible = () => { if (document.visibilityState === "visible") readTasks(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [readTasks, attempt]);

  // The person's own completions (session only), the Welcome journey, the
  // published company campaigns, and the review counts: the same reads as the
  // old board. Each fails to nothing, never to an error screen.
  useEffect(() => {
    let live = true;
    if (walletUser) {
      json<{ contributions?: Contribution[] }>("/api/me/contributions").then((d) => { if (live) setContributions(Array.isArray(d?.contributions) ? d!.contributions! : []); });
    } else {
      setContributions([]);
    }
    json<{ welcome?: WelcomeView | null }>("/api/welcome").then((d) => { if (live) setWelcome(d?.welcome ?? null); });
    json<{ campaigns?: PublicCompanyCampaign[] }>("/api/campaigns/company").then((d) => { if (live) setCompanyCampaigns(Array.isArray(d?.campaigns) ? d!.campaigns! : []); });
    return () => { live = false; };
  }, [userId, walletUser, attempt]);

  useEffect(() => {
    if (!walletUser) { setReviewDeck([]); return; }
    let live = true;
    json<{ flaggedWaiting?: number; record?: JudgeRecord }>("/api/jury/record").then((d) => {
      if (!live || !d) return;
      setReviewFlagged(typeof d.flaggedWaiting === "number" ? d.flaggedWaiting : 0);
      setReviewRecord(d.record && typeof d.record.judged === "number" ? d.record : null);
    });
    // GET /api/jury issues a deck and stores its answers, so it is read once per
    // visit and handed to the deck as is. A practice deck earns nothing and is not
    // offered here.
    json<{ cards?: JuryCard[]; practice?: boolean; waiting?: number }>(`/api/jury?address=${encodeURIComponent(userId!)}`).then((d) => {
      if (!live) return;
      setReviewDeck(!d?.practice && Array.isArray(d?.cards) ? d!.cards! : []);
      setReviewWaiting(!d?.practice && typeof d?.waiting === "number" ? d!.waiting! : 0);
    });
    return () => { live = false; };
  }, [userId, walletUser, reviewKey]);

  const tasks = useMemo(() => (read.kind === "ready" ? read.tasks : []), [read]);
  const addresses = useMemo(() => [...new Set(tasks.flatMap((t) => [t.poster, t.claimant].filter(Boolean) as string[]))], [tasks]);
  const { displayName } = useWorldUsers(addresses);
  const completedIds = useMemo(() => new Set(contributions.map((c) => c.taskId)), [contributions]);

  // BOARD-RULES.md owns this. The calls below are the old board's, in its order:
  // visibility, rank, curation, then the lead rule, with the mission and the
  // person's own completions taken off the list.
  const curated = useMemo(() => {
    const now = Date.now();
    const visible = tasks.filter((t) => isBoardVisible(t, userId, now));
    return curateBoard(rankBoard(visible, { userId, userLocation, now }), userId, now);
  }, [tasks, userId, userLocation]);
  const mission = useMemo(() => pickDailyMission(tasks, new Date().toISOString().slice(0, 10), userId), [tasks, userId]);
  const missionDone = useMemo(() => (mission && completedIds.has(mission.id) ? contributions.find((c) => c.taskId === mission.id) ?? null : null), [mission, completedIds, contributions]);
  const rows = useMemo(
    () => leadWithDoable(curated.filter((t) => !completedIds.has(t.id) && (!mission || t.id !== mission.id)), userId, completedIds),
    [curated, completedIds, mission, userId],
  );
  const openCount = useMemo(() => tasks.filter((t) => t.status === "open").length, [tasks]);

  const pieceToDo = useMemo(() => pickCampaignToDo(companyCampaigns, tasks, completedIds), [companyCampaigns, tasks, completedIds]);
  const campaignCards = useMemo(() => rankCampaignCards(companyCampaigns, tasks, completedIds), [companyCampaigns, tasks, completedIds]);
  const stage = useMemo(() => pickCampaignStage({ welcome, company: pieceToDo }), [welcome, pieceToDo]);
  const entry = reviewEntryFor({ waiting: reviewWaiting, flaggedWaiting: reviewFlagged, record: reviewRecord, walletUser });
  const today = todayOf(contributions);

  // THE WELCOME JOURNEY (R19), as the old board does it (Feed.tsx,
  // startWelcomeStep): a step is done on a per-person instance. POST
  // /api/welcome/start makes or finds it, and the proof step opens on it.
  const startWelcomeStep = useCallback(async (sourceTaskId: string) => {
    if (!userId) return;
    setWelcomeBusy(sourceTaskId);
    setWelcomeError(null);
    const send = () => fetch("/api/welcome/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: userId, sourceTaskId }),
    });
    try {
      let res = await send();
      if (res.status === 403 && onReauth) {
        const peek = await res.clone().json().catch(() => ({} as Record<string, unknown>));
        if (peek.code === "reauth_required") { await onReauth(); res = await send(); }
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok || !data.task) {
        // The server's own words: it knows whether this is done, or needs World App.
        setWelcomeError(typeof data.error === "string" ? data.error : "This Welcome favour could not be opened. Nothing was changed.");
        setAttempt((n) => n + 1);
        return;
      }
      hapticTap();
      setSelectedTask(data.task as Task);
      setProofFrom("welcome");
      setView("proof");
    } catch {
      setWelcomeError("Network error. Nothing was changed. Try again.");
    } finally {
      setWelcomeBusy(null);
    }
  }, [userId, onReauth]);

  // Do a favour: the same proof step the old board opens (Feed.tsx, openProof).
  const openProof = useCallback((task: Task) => {
    if (task.status === "open" && isWelcomeSourceRow(task)) { startWelcomeStep(task.id); return; }
    hapticTap();
    setSelectedTask(task);
    setProofFrom("board");
    setView("proof");
  }, [startWelcomeStep]);

  const reread = () => setAttempt((n) => n + 1);
  const retry = () => { setRead({ kind: "loading" }); reread(); };

  if (view === "jury") {
    return <JuryMode userId={userId} onClose={() => { setView("board"); setReviewKey((n) => n + 1); }} onReauth={onReauth} initialCards={reviewDeck} />;
  }
  if (view === "proof" && selectedTask) {
    // On the way out everything is read again, so a favour just done lands on the
    // board: the done count, the mission bar and the Welcome bar fill.
    const leaveProof = () => { setView("board"); setSelectedTask(null); reread(); };
    return (
      <SubmitProof
        task={selectedTask}
        userId={userId}
        onDone={leaveProof}
        onCancel={leaveProof}
        onWelcome={proofFrom === "welcome" ? leaveProof : undefined}
        onCreateTask={() => setView("post")}
        onJudge={() => setView("jury")}
        onReauth={onReauth}
      />
    );
  }
  if (view === "post") {
    const leave = (refresh: boolean) => { setView("board"); if (refresh) reread(); };
    // The paid wizard (`PostTask`) stays inside Feed.tsx, so "Set up a paid favour"
    // is not offered from here: onPaid returns to the board.
    return <QuickPost userId={userId} onReauth={onReauth} onDone={() => leave(true)} onCancel={() => leave(false)} onPaid={() => leave(false)} />;
  }

  // The company campaign on the stage is not drawn a second time in the lead list.
  const leadCampaigns = campaignCards.lead.filter((c) => c.id !== stage.company?.campaign.id);
  const firstOpenPiece = (c: PublicCompanyCampaign): Task | null =>
    tasks.find((t) => t.companyCampaignId === c.id && t.status === "open" && !completedIds.has(t.id)) ?? null;
  const campaignRow = (c: PublicCompanyCampaign, open: number | null) => {
    const piece = firstOpenPiece(c);
    const line = [open !== null ? `${open} ${open === 1 ? "piece" : "pieces"} open` : null, typeof c.rewardPerPiecePoints === "number" ? `${c.rewardPerPiecePoints} pts a piece` : null, c.companyChecked ? "Checked" : "Not checked"].filter(Boolean).join(" · ");
    return (
      <button key={c.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => piece && openProof(piece)} disabled={!piece} aria-label={`${c.company} campaign`}>
        <span className={styles.mark}><CategoryIcon category="review" size={18} /></span>
        <span className={styles.rowText}>
          <span className={styles.rowName}>{c.company}</span>
          {line && <span className={styles.rowLine}>{line}</span>}
        </span>
      </button>
    );
  };

  const ready = read.kind === "ready";
  const welcomeCard = !!(stage.welcome && welcome);
  const nothing = ready && rows.length === 0 && !mission && !stage.company && !welcomeCard && leadCampaigns.length === 0;
  // One primary per screen: the mission's "Start", else the Welcome step, else
  // the empty state's door. Everything else is a quiet pill.
  const primary: "mission" | "welcome" | "empty" | null = !ready ? null : mission && !missionDone ? "mission" : welcomeCard && stage.welcome?.next ? "welcome" : nothing ? "empty" : null;

  return (
    <div className={talk.screen} aria-label="Favours">
      <TopBar title="Favours" />
      <div className={styles.body}>
        {read.kind === "loading" && <Loader label="Reading favours" />}

        {read.kind === "error" && (
          <>
            <p className={styles.line}>The favours could not be read.</p>
            <div className={styles.action}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={retry}>Try again</Button>
            </div>
          </>
        )}

        {ready && (
          <div className={styles.totals} aria-label="Today on FAVOUR">
            <div className={styles.cell}><b>{openCount}</b><small>open</small></div>
            {walletUser && <div className={styles.cell}><b>{today.done}</b><small>done today</small></div>}
            {walletUser && <div className={styles.cell}><b>{today.points}</b><small>pts today</small></div>}
          </div>
        )}

        {ready && mission && (
          <section className={`${styles.card} ${styles.hero}`} aria-label="Today's mission">
            <p className={styles.eyebrow}>{missionDone ? "Today's mission · done" : "Today's mission"}</p>
            <p className={styles.heroAsk}>{mission.description}</p>
            <p className={styles.heroLine}><span>{whoAsked(mission, displayName)}</span><Reward task={mission} /></p>
            {missionDone ? (
              <Bar done={1} of={1} label={`You earned ${Math.round(missionDone.points)} pts`} />
            ) : (
              <div className={styles.primary}>
                <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => openProof(mission)} aria-label="Start today's mission">Start</Button>
              </div>
            )}
          </section>
        )}

        {ready && welcomeCard && stage.welcome && (
          <section className={styles.card} aria-label="Welcome favours">
            <p className={styles.eyebrow}>Welcome favours</p>
            <p className={styles.cardName}>{stage.welcome.next ? stage.welcome.next.description : stage.welcome.finished ? "All done" : "Waiting for a check"}</p>
            <Bar done={stage.welcome.done} of={stage.welcome.total} label={`${stage.welcome.done} of ${stage.welcome.total} done`} />
            {stage.welcome.next && (
              primary === "welcome" ? (
                <div className={styles.primary}>
                  <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" disabled={!!welcomeBusy} onClick={() => startWelcomeStep(stage.welcome!.next!.sourceTaskId)} aria-label="Open the next Welcome favour">{welcomeBusy ? "Opening…" : `Open · ${stage.welcome.next.points} pts`}</Button>
                </div>
              ) : (
                <div className={styles.act}>
                  <span className={styles.cap}>{stage.welcome.next.points} pts</span>
                  <Button variant="tertiary" size="sm" className="min-h-[44px]" disabled={!!welcomeBusy} onClick={() => startWelcomeStep(stage.welcome!.next!.sourceTaskId)} aria-label="Open the next Welcome favour">{welcomeBusy ? "Opening…" : "Open"}</Button>
                </div>
              )
            )}
            {welcomeError && <p role="alert" className={styles.problem}>{welcomeError}</p>}
          </section>
        )}

        {ready && stage.company && (
          <section className={styles.group} aria-label="Company campaign">
            <p className={styles.eyebrow}>Company campaign</p>
            {campaignRow(stage.company.campaign, stage.company.openPieces)}
          </section>
        )}

        {ready && userId && (
          <section className={styles.card} aria-label="Review favours">
            <p className={styles.eyebrow}>{entry.title}</p>
            <p className={styles.cardLine}>{entry.line}</p>
            {reviewRecord && <Bar done={Math.min(reviewRecord.judged, JUDGE_MIN_GRADED)} of={JUDGE_MIN_GRADED} label={`${Math.min(reviewRecord.judged, JUDGE_MIN_GRADED)} of ${JUDGE_MIN_GRADED} graded calls`} />}
            <div className={styles.act}>
              <span className={styles.cap}>{entry.flagged ?? ""}</span>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => { hapticTap(); setView("jury"); }}>{entry.cta}</Button>
            </div>
          </section>
        )}

        {ready && leadCampaigns.length > 0 && (
          <section className={styles.group} aria-label="Campaigns">
            <p className={styles.eyebrow}>Campaigns</p>
            {leadCampaigns.map((c) => campaignRow(c, null))}
          </section>
        )}

        {ready && rows.length > 0 && (
          <section className={styles.group} aria-label="Open favours">
            <h2 className={styles.heading}>Open favours <small>{rows.length}</small></h2>
            {rows.map((t) => {
              const target = targetLine(t);
              const stale = isStale(t, Date.now());
              const mine = !!userId && t.poster === userId;
              // A person's own open favour cannot be done by them: it opens its page.
              const go = () => (mine && t.status === "open" ? router.push(`/task/${encodeURIComponent(t.id)}`) : openProof(t));
              return (
                <button key={t.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={go} aria-label={`Open favour: ${t.description}`}>
                  <span className={styles.mark}><CategoryIcon category={t.category} size={18} /></span>
                  <span className={styles.rowText}>
                    <span className={styles.rowAsk}>{t.description}</span>
                    <span className={styles.rowLine}>{mine ? "You asked" : t.status === "claimed" ? "Yours, in progress" : whoAsked(t, displayName)}{stale ? " · Open a while" : ""}</span>
                    {target && <Bar done={target.done} of={target.of} label={`${target.done} of ${target.of} done`} className={styles.rowBar} />}
                  </span>
                  <Reward task={t} />
                </button>
              );
            })}
          </section>
        )}

        {nothing && (
          <section className={styles.card} aria-label="No open favour">
            <h2 className={styles.cardHeading}>No open favour today</h2>
            <p className={styles.cardLine}>Post your app and ask people for reviews.</p>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push("/post")}>Post your own app</Button>
            </div>
          </section>
        )}

        {ready && campaignCards.rest.length > 0 && (
          <section className={styles.group} aria-label="More company campaigns">
            <p className={styles.eyebrow}>More company campaigns</p>
            {campaignCards.rest.map((c) => campaignRow(c, null))}
          </section>
        )}

        {/* A one-off favour is asked here, under the list, with the old board's own
            composer. "At a specific place, or for USDC" opens its QuickPost step. */}
        {ready && userId && (
          <div className={styles.door}>
            {!askOpen ? (
              <Button variant="tertiary" size="sm" fullWidth className="min-h-[44px]" onClick={() => { hapticTap(); setAskOpen(true); }}>Ask a one-off favour</Button>
            ) : (
              <div className={styles.composer}>
                <FeedComposer userId={userId} onReauth={onReauth} onPosted={reread} onMore={() => { hapticTap(); setView("post"); }} />
              </div>
            )}
          </div>
        )}

        {ready && !nothing && (
          <div className={styles.door}>
            <Button variant="tertiary" size="sm" fullWidth className="min-h-[44px]" onClick={() => router.push("/post")}>Post your own app</Button>
          </div>
        )}
        {ready && <p className={styles.foot}>FAVOUR · World Chain</p>}
      </div>
    </div>
  );
}
