"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FavourPageHero } from "@/components/FavourPageHero";
import type { Contribution } from "@/lib/completions";

// HISTORY (Oscar, 10 Oct 2026: "History is great"; 19 Oct: every page in one
// system). What I did and what I earned, newest first, plus the platform's
// three numbers. Reads the same routes as before; nothing else changes.
type Stats = { users?: { reached?: number; verified?: number }; volume?: { paidOutUsdc?: number; pointsDistributed?: number } };
type Latest = { id: string; description: string; proofImageUrl: string | null; category?: string };

export function HistoryView({ mine, stats, signedIn, error, latest }: { mine: Contribution[] | null; stats: Stats; signedIn: boolean; error: string | null; latest: Latest[] }) {
  const points = (mine ?? []).reduce((n, c) => n + (c.points || 0), 0);
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 h-14 flex items-center justify-between">
        <h1 className="fv-h">History</h1>
        <p className="fv-h fv-num"><span className="fv-blue">{points}</span> pts</p>
      </header>
      <div className="px-6 py-5 pb-28 flex flex-col gap-5"><FavourPageHero title="Your work. Your progress." description="Return to the favours you completed and the people you helped." image="/hero/coffee.jpg" />
        <section aria-label="FAVOUR so far" className="fv-box grid grid-cols-3">
          <div className="p-3 fv-rule-b" style={{ borderRight: "1px solid var(--favour-border)" }}><p className="fv-title fv-num">{Math.round(stats.volume?.paidOutUsdc ?? 0)}</p><p className="fv-label">USDC paid</p></div>
          <div className="p-3 fv-rule-b" style={{ borderRight: "1px solid var(--favour-border)" }}><p className="fv-title fv-num">{Math.round(stats.volume?.pointsDistributed ?? 0)}</p><p className="fv-label">points</p></div>
          <div className="p-3 fv-rule-b"><p className="fv-title fv-num">{stats.users?.reached ?? stats.users?.verified ?? 0}</p><p className="fv-label">wallets</p></div>
          <p className="col-span-3 p-3 fv-body text-[12px]">Platform totals, cached. Your own work is below.</p>
        </section>

        {error && <p role="alert" className="fv-body">{error}</p>}
        {!signedIn && <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Sign in to see your work</p><p className="fv-body">Your reviews and points are kept with your wallet.</p><Link href="/" className="fv-btn fv-btn-ink">Explore campaigns</Link></div>}
        {signedIn && mine === null && <p className="fv-body">Reading your work…</p>}
        {signedIn && mine?.length === 0 && <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Nothing yet</p><p className="fv-body">Choose a campaign, read the request, and send your own proof. Accepted work appears here.</p><Link href="/" className="fv-btn fv-btn-ink">Explore campaigns</Link></div>}
        {mine?.map((c) => (
          <article key={`${c.taskId}-${c.at}`} className="fv-box flex flex-col">
            {c.proofImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.proofImageUrl} alt="" className="fv-pic" loading="lazy" />
            )}
            <div className="p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="fv-h break-words line-clamp-2 flex-1 min-w-0">{c.campaignLabel || c.description}</p>
                <p className="fv-h fv-num shrink-0">+{(c.points || 0)}</p>
              </div>
              {c.proofNote && <p className="fv-body break-words line-clamp-3">{c.proofNote}</p>}
              <p className="fv-body text-[12px] fv-num">{new Date(c.at).toLocaleDateString()}{c.campaignId ? <> · <Link href={`/?campaign=${encodeURIComponent(c.campaignId === "first-favour" ? "welcome" : c.campaignId)}`} className="underline underline-offset-2">View campaign</Link></> : null}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function HistoryScreen() {
  const [mine, setMine] = useState<Contribution[] | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Latest[]>([]);
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
    fetch("/api/session", { cache: "no-store", signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok) throw new Error("session");
        const session = await r.json();
        if (!session.authenticated) return;
        setSignedIn(true);
        const response = await fetch("/api/me/contributions", { cache: "no-store" });
        if (!response.ok) throw new Error("history");
        const data = await response.json();
        setMine(Array.isArray(data.contributions) ? data.contributions : []);
      }).catch(() => setError("Your work could not be read. Try again."));
  }, []);
  return <HistoryView mine={mine} stats={stats} signedIn={signedIn} error={error} latest={latest} />;
}
