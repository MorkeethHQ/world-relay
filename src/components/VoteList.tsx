"use client";

import { useEffect, useState } from "react";
import type { VoteRow } from "@/lib/product-votes";
import styles from "./VoteList.module.css";

// VOTE FOR A PRODUCT (Oscar, 8 Oct 2026: "prefill it with products for people to
// vote and have favours for"). A short list of real products. One tap on a row is
// one vote from the signed-in person. The row then says "Voted".
//
// What a vote is: "I want to review this on FAVOUR". It pays nothing. The count is
// a count of World wallets, shown as it is; a zero is a zero. A count that could
// not be read shows a dash, never a zero. The list says whose products these are.
//
// It reads /api/votes itself. Four states: reading, could not read, empty (it
// shows nothing, because the first page already says what to do), and the list.

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; from: string; rows: VoteRow[]; signedIn: boolean };

export function VoteList() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/votes", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data?.rows)) throw new Error("unreadable");
        return data as { from: string; rows: VoteRow[]; signedIn: boolean };
      })
      .then((d) => { if (live) setState({ kind: "ready", ...d }); })
      .catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  async function vote(row: VoteRow) {
    if (state.kind !== "ready" || row.mine || busy) return;
    if (!state.signedIn) { setProblem("Open FAVOUR in World App and sign in to vote."); return; }
    setBusy(row.id); setProblem(null);
    try {
      const res = await fetch("/api/votes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.votes !== "number") { setProblem(typeof data.error === "string" ? data.error : "Your vote was not saved. Try again."); return; }
      // The server's own count, not this screen's guess.
      setState({ ...state, rows: state.rows.map((r) => (r.id === row.id ? { ...r, votes: data.votes, mine: true } : r)) });
    } catch {
      setProblem("FAVOUR could not be reached. Your vote was not saved.");
    } finally {
      setBusy(null);
    }
  }

  if (state.kind === "loading") return <p role="status" className="px-4 py-4 text-sm text-gray-600">Reading the products to vote on…</p>;
  if (state.kind === "error") {
    return (
      <div role="alert" className="px-4 py-4">
        <p className="text-sm text-gray-600">The products to vote on could not be read.</p>
        <button
          type="button"
          className="mt-3 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 active:scale-[0.98]"
          onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (state.rows.length === 0) return null;

  return (
    <section aria-label="Vote for a product">
      <h2 className={`${styles.heading} px-4 text-gray-900`}>Vote for what you want to review</h2>
      <p className="px-4 text-xs text-gray-400">{state.from}. A vote pays nothing.</p>
      <ul className="mt-1">
        {state.rows.map((row) => (
          <li key={row.id} className="border-b border-gray-200 last:border-b-0">
            <button
              type="button"
              className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50 disabled:opacity-100"
              onClick={() => vote(row)}
              disabled={row.mine || busy === row.id}
              aria-label={row.mine ? `You voted for ${row.name}` : `Vote for ${row.name}`}
            >
              {row.image || row.icon ? (
                // The product's own picture, from its own server. No referrer is sent.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(row.image || row.icon)!} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.thumb} />
              ) : (
                <span className={`${styles.thumb} ${styles.initial}`} aria-hidden="true">{Array.from(row.name)[0]?.toUpperCase() ?? "?"}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-gray-900">{row.name}</span>
                <span className="block truncate text-xs text-gray-400">{row.line ?? row.host}</span>
              </span>
              <span className="shrink-0 text-right leading-tight">
                <span className="block text-[17px] font-bold tabular-nums text-gray-900">{row.votes ?? "-"}</span>
                <span className="block text-xs text-gray-400">{row.votes === 1 ? "vote" : "votes"}</span>
              </span>
              <span className={`w-14 shrink-0 rounded-full border px-2 py-2 text-center text-xs font-semibold ${row.mine ? "border-gray-200 bg-gray-50 text-gray-400" : "border-gray-900 bg-gray-900 text-white"}`}>
                {row.mine ? "Voted" : busy === row.id ? "…" : "Vote"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {problem && <p role="alert" className={`${styles.note} px-4 text-sm text-red-600`}>{problem}</p>}
    </section>
  );
}
