"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FirstPage } from "@/lib/first-page";
import type { Launch } from "@/lib/launch-feed";
import type { VoteRow } from "@/lib/product-votes";
import { Note } from "./Kit";
import { TopProducts } from "./TopProducts";

// `TopProducts` WITH ITS DATA. DESIGN-SYSTEM.md, Flow 1, step 1. This is the one
// line a first page needs: <TopProductsLive />. It reads /api/top and /api/votes
// and shows the four states: loading, error, empty and filled (`TopProducts`
// owns the last two). The list of products to vote for may fail alone: then the
// vote group is not drawn.
//
// A tap on a product on FAVOUR opens its product screen, /p/<id>. A tap on a
// product to vote for is one vote from the signed-in person, and the count shown
// after it is the server's. "Post your own app" opens /post. A tap on an outside
// launch opens the product's own page in a new tab: the maker asked FAVOUR for
// nothing, so FAVOUR has no screen for it.
//
// Mounted at the top of the Campaigns tab in Feed.tsx.

type Votes = { from: string; rows: VoteRow[]; signedIn: boolean };
type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; page: FirstPage; votes: Votes | null };

async function read(): Promise<State> {
  const [page, votes] = await Promise.all([
    fetch("/api/top").then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data?.top) throw new Error("unreadable");
      return data as FirstPage;
    }),
    fetch("/api/votes", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Votes) : null))
      .then((v) => (v && Array.isArray(v.rows) ? v : null))
      .catch(() => null),
  ]);
  return { kind: "ready", page, votes };
}

export function TopProductsLive({
  onOpen, onPost, onOpenLaunch,
}: {
  onOpen?: (id: string) => void;
  onPost?: () => void;
  onOpenLaunch?: (launch: Launch) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [voteProblem, setVoteProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    read().then((next) => { if (live) setState(next); }).catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  async function vote(row: VoteRow) {
    if (state.kind !== "ready" || !state.votes || row.mine || votingId) return;
    if (!state.votes.signedIn) { setVoteProblem("Open FAVOUR in World App and sign in to vote."); return; }
    setVotingId(row.id); setVoteProblem(null);
    try {
      const res = await fetch("/api/votes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.votes !== "number") { setVoteProblem(typeof data.error === "string" ? data.error : "Your vote was not saved. Try again."); return; }
      // The server's own count, not this screen's guess.
      const rows = state.votes.rows.map((r) => (r.id === row.id ? { ...r, votes: data.votes, mine: true } : r));
      setState({ ...state, votes: { ...state.votes, rows } });
    } catch {
      setVoteProblem("FAVOUR could not be reached. Your vote was not saved.");
    } finally {
      setVotingId(null);
    }
  }

  if (state.kind === "loading") {
    return <div className="px-4 pb-4"><Note kind="loading" quiet>Reading today&apos;s products…</Note></div>;
  }
  if (state.kind === "error") {
    return (
      <div className="px-4 pb-4">
        <Note kind="error" action="Try again" onAction={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}>
          Today&apos;s products could not be read.
        </Note>
      </div>
    );
  }
  const { top, launches, pictures } = state.page;
  return (
    <TopProducts
      top={top}
      launches={launches}
      pictures={pictures}
      votes={state.votes?.rows ?? []}
      votesFrom={state.votes?.from}
      votingId={votingId}
      voteProblem={voteProblem}
      onVote={vote}
      onOpen={onOpen ?? ((id) => router.push(`/p/${encodeURIComponent(id)}`))}
      onPost={onPost ?? (() => router.push("/post"))}
      onOpenLaunch={onOpenLaunch ?? ((l) => { window.open(l.url, "_blank", "noopener,noreferrer"); })}
    />
  );
}
