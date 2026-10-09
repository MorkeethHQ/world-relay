"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Marble, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import type { Task } from "@/lib/types";
import type { Contribution } from "@/lib/completions";
import type { CampaignDraft } from "@/lib/campaign-draft-shape";
import { HUNT_SIZE } from "@/lib/daily-hunt";
import { hunterProfile } from "@/lib/hunter-profile";
import { ownApps } from "@/lib/project-view";
import { initialOf } from "@/lib/content-rules";
import { rewardAmountLabel } from "@/lib/reward";
import { shareInvite } from "@/lib/minikit-helpers";
import { displayName, profilePicture, useWorldUsers } from "@/hooks/useWorldUser";
import { Bar, Loader } from "@/components/Fill";
import { TalkPicture } from "@/components/TalkPicture";
import talk from "./Talk.module.css";
import styles from "./Profile.module.css";

// THE PROFILE, /dashboard (Oscar, 10 Oct 2026, seen live: "profile not done").
// DESIGN-SYSTEM.md, "Profile". Drawn like the Favours tab: World's kit on a
// white page, one gutter of 16, black, white and gray, the fill-up loader.
//
// Top to bottom: the header "Profile"; one identity block (the World picture
// as the kit's Marble or a round initial, the username, the sign-in level, and
// never a wallet address); the ink banner with the person's own counts from
// their contribution record and their own draft list; today's hunt as a bar;
// "Your apps", the apps this person posted, each a row to /p/<id>; "Your
// company responses" when the server lists any; "Your favours", the favours
// this person posted or did; "Invite a friend" as a row; the footer.
//
// Every number is the server's for this person. A zero is a zero. The one
// read whose failure is the error state is the contribution record; the rest
// fail to nothing. A person the server does not know sees no number at all.
// No level name, no rank, no streak flame (hunter-profile.ts says why).
//
// The old page's parts stay in the code: HunterCard and HunterCardLive are
// not mounted here since 10 Oct 2026 (this screen reads the same two routes).

type Read =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "signed_out" }
  | { kind: "ready"; contributions: Contribution[]; drafts: CampaignDraft[]; stamps: string[] | null };
type Referral = { invited: number; activated: number; cap: number; capReached: boolean };
type CompanyResponse = { id: string; company: string; role: "company" | "contributor"; pieces: number; waiting: number };

const STATUS: Record<string, string> = { completed: "Done", claimed: "In progress", open: "Open" };
const LEVEL: Record<string, string> = { orb: "Orb verified", device: "Device verified", wallet: "Wallet sign-in" };

const json = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

/** The line under an app's name: when it was posted, then its host (the host is what a long line cuts). */
export function postedLine(host: string, publishedAt: string | null, now: number = Date.now()): string {
  if (!publishedAt) return host;
  const days = Math.floor((now - (Date.parse(publishedAt) || now)) / 86_400_000);
  const when = days < 1 ? "Posted today" : days === 1 ? "Posted yesterday" : `Posted ${days} days ago`;
  return `${when} · ${host}`;
}

/** The sign-in level as plain words, never a colour. */
export function levelLine(level: string | null): string {
  return (level && LEVEL[level]) || "Signed in";
}

export function Profile() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [responses, setResponses] = useState<CompanyResponse[]>([]);

  // The identity the app stored at sign-in, as the old page read it.
  useEffect(() => {
    try {
      setUserId(localStorage.getItem("relay_user_id"));
      setLevel(localStorage.getItem("relay_verification_level"));
    } catch {}
  }, []);

  const wallet = !!userId && /^0x[0-9a-fA-F]{40}$/.test(userId);

  // The person's own record (session only): the one read that can be the error
  // state. With it, their own drafts and today's stamps, which fail to nothing.
  const readOwn = useCallback(async () => {
    try {
      const res = await fetch("/api/me/contributions", { cache: "no-store" });
      const me = await res.json().catch(() => null);
      if (!res.ok || !me) throw new Error("unreadable");
      if (!me.authenticated) { setRead({ kind: "signed_out" }); return; }
      const [own, hunt] = await Promise.all([
        json<{ drafts?: CampaignDraft[] }>("/api/campaigns/drafts"),
        json<{ signedIn?: boolean; stamps?: string[] | null }>("/api/hunt"),
      ]);
      setRead({
        kind: "ready",
        contributions: Array.isArray(me.contributions) ? me.contributions : [],
        drafts: Array.isArray(own?.drafts) ? own!.drafts! : [],
        stamps: hunt?.signedIn && Array.isArray(hunt.stamps) ? hunt.stamps : null,
      });
    } catch {
      setRead({ kind: "error" });
    }
  }, []);

  useEffect(() => { readOwn(); }, [readOwn, attempt]);

  // The old page's other reads: every favour (for this person's own rows), the
  // referral count, and the company responses. Each fails to nothing.
  useEffect(() => {
    let live = true;
    json<{ tasks?: Task[] }>("/api/tasks").then((d) => { if (live) setTasks(Array.isArray(d?.tasks) ? d!.tasks! : []); });
    json<{ campaigns?: CompanyResponse[] }>("/api/me/company-responses").then((d) => { if (live) setResponses(Array.isArray(d?.campaigns) ? d!.campaigns! : []); });
    if (wallet) {
      json<Referral & { error?: string }>(`/api/referral/stats?address=${encodeURIComponent(userId!)}`).then((d) => { if (live && d && !d.error && typeof d.cap === "number") setReferral(d); });
    }
    return () => { live = false; };
  }, [userId, wallet, attempt]);

  useWorldUsers(userId ? [userId] : []);
  // The username, or nothing: a shortened address is still an address.
  const shown = userId ? displayName(userId) : "";
  const name = shown.startsWith("@") ? shown : null;
  const picture = userId ? profilePicture(userId) : null;

  const ready = read.kind === "ready";
  const profile = useMemo(() => (read.kind === "ready" ? hunterProfile(read.contributions, read.drafts) : null), [read]);
  // One filter for the count and the rows: published, with a product.
  const apps = useMemo(() => (read.kind === "ready" ? ownApps(read.drafts.filter((d) => d.status === "published")) : []), [read]);
  const myTasks = useMemo(() => (userId ? tasks.filter((t) => t.poster === userId || t.claimant === userId).slice().reverse() : []), [tasks, userId]);
  const stamped = read.kind === "ready" && read.stamps ? Math.min(read.stamps.length, HUNT_SIZE) : null;

  const retry = () => { setRead({ kind: "loading" }); setAttempt((n) => n + 1); };

  return (
    <div className={talk.screen} aria-label="Profile">
      <TopBar title="Profile" />
      <div className={styles.body}>
        <div className={styles.identity}>
          {picture ? (
            <Marble src={picture} alt="" className={styles.marble} />
          ) : (
            <span className={styles.face} aria-hidden="true">{userId ? initialOf((name ?? "You").replace(/^@/, "")) : "?"}</span>
          )}
          <div className={styles.identityText}>
            <h2 className={styles.name}>{!userId ? "Not signed in" : name ?? "You"}</h2>
            {/* the level is the stored one, printed only when the server knows this person now */}
            <p className={styles.level}>{!userId ? "Open FAVOUR in World App" : read.kind === "signed_out" ? "Signed out" : levelLine(level)}</p>
          </div>
        </div>

        {read.kind === "loading" && <Loader label="Reading your profile" />}

        {read.kind === "error" && (
          <>
            <p className={styles.line}>Your profile could not be read.</p>
            <div className={styles.action}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={retry}>Try again</Button>
            </div>
          </>
        )}

        {read.kind === "signed_out" && (
          <>
            <p className={styles.line}>Open FAVOUR in World App and sign in to see your reviews, your apps and your points.</p>
            <div className={styles.action}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push("/")}>Today&apos;s hunt</Button>
            </div>
          </>
        )}

        {ready && profile && (
          <div className={styles.totals} aria-label="Your work on FAVOUR">
            <div className={styles.cell}><b>{profile.points}</b><small>pts</small></div>
            <div className={styles.cell}><b>{profile.reviews}</b><small>reviews accepted</small></div>
            <div className={styles.cell}><b>{profile.products}</b><small>products reviewed</small></div>
            <div className={styles.cell}><b>{apps.length}</b><small>apps launched</small></div>
          </div>
        )}

        {ready && stamped !== null && (
          <section className={styles.card} aria-label="Today's hunt">
            <p className={styles.eyebrow}>Today&apos;s hunt</p>
            <Bar done={stamped} of={HUNT_SIZE} label={`${stamped} of ${HUNT_SIZE} checked today`} />
          </section>
        )}

        {ready && (
          <section className={styles.group} aria-label="Your apps">
            <h2 className={styles.heading}>Your apps {apps.length > 0 && <small>{apps.length}</small>}</h2>
            {apps.length === 0 ? (
              <div className={styles.card}>
                <p className={styles.cardHeading}>You have posted no app yet</p>
                <p className={styles.cardLine}>Post it and ask people for reviews.</p>
                <div className={styles.primary}>
                  <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push("/post")}>Post your project</Button>
                </div>
              </div>
            ) : (
              <>
                {apps.map((a) => (
                  <button key={a.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => router.push(`/p/${encodeURIComponent(a.id)}`)} aria-label={`${a.name}: your app`}>
                    <TalkPicture name={a.name} url={null} icon={null} colour={null} shape="square" />
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{a.name}</span>
                      <span className={styles.rowLine}>{postedLine(a.host, a.publishedAt)}</span>
                    </span>
                    <i className={styles.chev} aria-hidden="true">›</i>
                  </button>
                ))}
                <div className={styles.door}>
                  <Button variant="tertiary" size="sm" fullWidth className="min-h-[44px]" onClick={() => router.push("/post")}>Post another</Button>
                </div>
              </>
            )}
          </section>
        )}

        {ready && responses.length > 0 && (
          <section className={styles.group} aria-label="Your company responses">
            <h2 className={styles.heading}>Your company responses</h2>
            {responses.map((r) => (
              <button key={r.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => router.push(`/companies/${encodeURIComponent(r.id)}/contributions`)} aria-label={`${r.company}: company responses`}>
                <span className={styles.mark}>{initialOf(r.company)}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{r.company}</span>
                  <span className={styles.rowLine}>{r.pieces} {r.pieces === 1 ? "piece" : "pieces"} · {r.waiting} waiting · {r.role === "company" ? "you are the company" : "your work"}</span>
                </span>
                <i className={styles.chev} aria-hidden="true">›</i>
              </button>
            ))}
          </section>
        )}

        {ready && userId && (
          <section className={styles.group} aria-label="Your favours">
            <h2 className={styles.heading}>Your favours {myTasks.length > 0 && <small>{myTasks.length}</small>}</h2>
            {myTasks.length === 0 ? (
              <p className={styles.quiet}>No favour yet. Do one and it shows up here.</p>
            ) : (
              myTasks.map((t) => (
                <button key={t.id} type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => router.push(`/task/${encodeURIComponent(t.id)}`)} aria-label={t.description}>
                  <span className={styles.mark}>{t.poster === userId ? "P" : "D"}</span>
                  <span className={styles.rowText}>
                    <span className={styles.rowAsk}>{t.description}</span>
                    <span className={styles.rowLine}>{t.poster === userId ? "Posted" : "Done"} · {rewardAmountLabel(t)}</span>
                  </span>
                  <span className={styles.status}>{STATUS[t.status] ?? t.status}</span>
                </button>
              ))
            )}
          </section>
        )}

        {/* Invite a friend (referral: both sides earn points, the referrer paid
            when the invitee completes their first clean favour). */}
        {ready && wallet && (
          <section className={styles.group} aria-label="Friends">
            <h2 className={styles.heading}>Friends</h2>
            <button type="button" className={`min-h-[44px] ${styles.row}`} onClick={() => shareInvite(userId!)} aria-label="Invite a friend">
              <span className={styles.mark}>+</span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>Invite a friend</span>
                <span className={styles.rowLine}>
                  {referral && referral.invited > 0
                    ? `${referral.invited} invited · ${referral.activated} active${referral.capReached ? ` · cap of ${referral.cap} reached` : ""}`
                    : "You both earn points on their first favour"}
                </span>
                {referral && referral.invited > 0 && <Bar done={Math.min(referral.activated, referral.cap)} of={referral.cap} label={`${Math.min(referral.activated, referral.cap)} of ${referral.cap} rewarded`} className={styles.rowBar} />}
              </span>
              <span className={styles.status}>Invite</span>
            </button>
          </section>
        )}

        {read.kind !== "loading" && <p className={styles.foot}>FAVOUR · World Chain</p>}
      </div>
    </div>
  );
}
