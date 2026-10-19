"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contribution } from "@/lib/completions";
import { ensureSession } from "@/lib/reauth";
import { funkyArt } from "@/lib/funky-art";

// HISTORY (Oscar, 10 Oct 2026: "History is great"; 19 Oct: every page in one
// system). What I did and what I earned, newest first, plus the platform's
// three numbers. Reads the same routes as before; nothing else changes.
type Stats = { users?: { reached?: number; verified?: number }; volume?: { paidOutUsdc?: number; pointsDistributed?: number } };
type Latest = { id: string; description: string; proofImageUrl: string | null; category?: string };

export function HistoryView({ mine, stats, signedIn, error, latest }: { mine: Contribution[] | null; stats: Stats; signedIn: boolean; error: string | null; latest: Latest[] }) {
  const points = (mine ?? []).reduce((n, c) => n + (c.points || 0) + (c.streakBonus || 0), 0);
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 h-14 flex items-center justify-between">
        <h1 className="fv-h">History</h1>
        <p className="fv-h fv-num"><span className="fv-blue">{points}</span> pts</p>
      </header>
      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        <section aria-label="FAVOUR so far" className="fv-box grid grid-cols-3">
          <div className="p-3 fv-rule-b" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num">{Math.round(stats.volume?.paidOutUsdc ?? 0)}</p><p className="fv-label">USDC paid</p></div>
          <div className="p-3 fv-rule-b" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num">{Math.round(stats.volume?.pointsDistributed ?? 0)}</p><p className="fv-label">points</p></div>
          <div className="p-3 fv-rule-b"><p className="fv-title fv-num">{stats.users?.reached ?? stats.users?.verified ?? 0}</p><p className="fv-label">humans</p></div>
          <p className="col-span-3 p-3 fv-body text-[12px]">Platform totals, cached. Your own work is below.</p>
        </section>

        {error && <p role="alert" className="fv-body">{error}</p>}
        {!signedIn && <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Sign in to see your work</p><p className="fv-body">Your reviews and points are kept with your wallet.</p><Link href="/" className="fv-btn fv-btn-ink">Open the deck</Link></div>}
        {signedIn && mine === null && <p className="fv-body">Reading your work…</p>}
        {signedIn && mine?.length === 0 && <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Nothing yet</p><p className="fv-body">Swipe right on a project, try it, and your first review lands here.</p><Link href="/" className="fv-btn fv-btn-ink">Open the deck</Link></div>}
        {latest.length > 0 && (
          <section aria-label="Latest on FAVOUR" className="flex flex-col gap-3">
            <h2 className="fv-label">Latest on FAVOUR</h2>
            <div className="grid grid-cols-2 gap-3">
              {latest.slice(0, 8).map((t) => (
                <article key={t.id} className="fv-box flex flex-col">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.proofImageUrl ?? funkyArt(t.description)} alt="" className="fv-pic" style={{ aspectRatio: "1 / 1" }} loading="lazy" />
                  <p className="fv-body text-[12px] p-2 line-clamp-2 break-words">{t.description}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {mine?.map((c) => (
          <article key={`${c.taskId}-${c.at}`} className="fv-box flex flex-col">
            {c.proofImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.proofImageUrl} alt="" className="fv-pic" loading="lazy" />
            )}
            <div className="p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <p className="fv-h break-words line-clamp-2 flex-1 min-w-0">{c.campaignLabel || c.description}</p>
                <p className="fv-h fv-num shrink-0">+{(c.points || 0) + (c.streakBonus || 0)}</p>
              </div>
              {c.proofNote && <p className="fv-body break-words line-clamp-3">{c.proofNote}</p>}
              <p className="fv-body text-[12px] fv-num">{new Date(c.at).toLocaleDateString()}{c.campaignId ? <> · <Link href={`/project/${encodeURIComponent(c.campaignId)}`} className="underline underline-offset-2">the project</Link></> : null}</p>
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
    fetch("/api/history").then((r) => r.json()).then((d) => setLatest(Array.isArray(d?.tasks) ? d.tasks.filter((t: Latest & { status?: string }) => t.status === "completed") : [])).catch(() => {});
    const stored = (() => { try { return localStorage.getItem("relay_user_id"); } catch { return null; } })();
    const addr = stored && stored.startsWith("0x") ? stored : stored;
    if (!addr) return;
    setSignedIn(true);
    ensureSession(addr.startsWith("0x") ? addr : null).finally(() => {
      fetch("/api/me/contributions", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : []))
        .catch(() => setError("Your work could not be read. Try again."));
    });
  }, []);
  return <HistoryView mine={mine} stats={stats} signedIn={signedIn} error={error} latest={latest} />;
}
