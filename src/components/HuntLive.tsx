"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { huntApps, type HuntApp } from "@/lib/daily-hunt";
import type { FirstPage } from "@/lib/first-page";
import { hunterProfile } from "@/lib/hunter-profile";
import type { VoteRow } from "@/lib/product-votes";
import { Hunt, type HuntState } from "./Hunt";
import { Note } from "./Kit";

// `Hunt` WITH ITS DATA. The one line the first tab mounts: <HuntLive />.
//
// It reads four things. /api/top (the products on FAVOUR and the outside
// launches) must answer, or the tab shows "Try again". The others may fail
// alone: /api/votes (then no vote candidates), /api/hunt (then the card is drawn
// as unknown: three empty slots, no streak), /api/me/contributions (then no
// points in the bar). The points are the same number the profile shows, from
// the person's own contribution record; they are shown only when the person
// is signed in on the server and the number is above zero, because a failed
// read of that record also answers an empty list.
//
// A vote is one POST to /api/votes; the stamp comes back in the same answer.
// A review is on /p/<id>; the product screen stamps it after the check passes.

type Votes = { from: string; rows: VoteRow[]; signedIn: boolean };
type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; page: FirstPage; votes: Votes | null; hunt: HuntState; points: number | null };

const json = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

async function read(): Promise<State> {
  const [page, votes, hunt, me] = await Promise.all([
    fetch("/api/top").then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data?.top) throw new Error("unreadable");
      return data as FirstPage;
    }),
    json<Votes>("/api/votes").then((v) => (v && Array.isArray(v.rows) ? v : null)),
    json<{ signedIn: boolean; stamps?: string[] | null; streak?: number | null }>("/api/hunt"),
    json<{ authenticated: boolean; contributions: unknown[] }>("/api/me/contributions"),
  ]);
  const signedIn = !!hunt?.signedIn;
  const points = signedIn && me?.authenticated && Array.isArray(me.contributions)
    ? hunterProfile(me.contributions as Parameters<typeof hunterProfile>[0]).points
    : 0;
  return {
    kind: "ready", page, votes,
    hunt: signedIn ? { stamps: Array.isArray(hunt?.stamps) ? hunt!.stamps! : null, streak: typeof hunt?.streak === "number" ? hunt.streak : null } : { stamps: null, streak: null },
    points: points > 0 ? points : null,
  };
}

export function HuntLive() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<HuntApp | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteProblem, setVoteProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    read().then((next) => { if (live) setState(next); }).catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  const close = useCallback(() => { setOpen(null); setVoteProblem(null); }, []);

  async function vote(app: HuntApp) {
    if (state.kind !== "ready" || app.kind !== "vote" || app.mine || voting) return;
    if (!state.votes?.signedIn) { setVoteProblem("Open FAVOUR in World App and sign in to vote."); return; }
    setVoting(true); setVoteProblem(null);
    try {
      const res = await fetch("/api/votes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: app.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.votes !== "number") { setVoteProblem(typeof data.error === "string" ? data.error : "Your vote was not saved. Try again."); return; }
      // The server's count and the server's stamps, never this screen's guess.
      const rows = state.votes.rows.map((r) => (r.id === app.id ? { ...r, votes: data.votes, mine: true } : r));
      const stamps = Array.isArray(data.stamps) ? (data.stamps as string[]) : state.hunt.stamps;
      setState({ ...state, votes: { ...state.votes, rows }, hunt: { ...state.hunt, stamps } });
      setOpen({ ...app, votes: data.votes, mine: true });
      if (!Array.isArray(data.stamps)) setVoteProblem("Your vote is saved. The stamp was not.");
    } catch {
      setVoteProblem("FAVOUR could not be reached. Your vote was not saved.");
    } finally {
      setVoting(false);
    }
  }

  if (state.kind === "loading") return <Note kind="loading" quiet>Reading today&apos;s apps…</Note>;
  if (state.kind === "error") {
    return (
      <Note kind="error" action="Try again" onAction={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}>
        Today&apos;s apps could not be read.
      </Note>
    );
  }
  return (
    <Hunt
      apps={huntApps(state.page, state.votes?.rows ?? [])}
      hunt={state.hunt}
      points={state.points}
      open={open}
      voting={voting}
      voteProblem={voteProblem}
      onOpen={(a) => { setVoteProblem(null); setOpen(a); }}
      onClose={close}
      onVote={vote}
      onPost={() => router.push("/post")}
    />
  );
}
