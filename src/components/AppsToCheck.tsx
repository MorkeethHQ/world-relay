"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { hostOf, pipsFor, progressLabel, voteNote, type VoteReply } from "@/lib/apps-view";

// /apps: THE APPS WAITING FOR YES (pivot "Product Hunt for World", 17 Oct 2026).
// Each card is one posted app. One YES per signed-in wallet, counted by the
// server (api/apps/vote). The pips are the jury card's pips: one per YES, ten to
// go live. The count on screen is the server's count, never a guess.

export type ListedApp = {
  id: string; productName: string; productUrl: string; ask: string;
  image: string | null; yes: number; of: number; status: "pending" | "published";
};

export function AppsToCheckView({ apps, notes, busy, error, onYes }: {
  apps: ListedApp[] | null;
  notes: Record<string, string>;
  busy: string | null;
  error: string | null;
  onYes: (id: string) => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-3">
        <Link href="/" aria-label="Back" className="min-h-[44px] min-w-[44px] -ml-3 flex items-center justify-center text-gray-900">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 className="flex-1 text-[18px] font-bold tracking-tight text-gray-900">Apps to check</h1>
        <Link href="/post" className="text-[14px] font-semibold text-gray-900 underline underline-offset-2">Post your app</Link>
      </div>

      <div className="px-6 py-4 pb-28 flex flex-col gap-4">
        <p className="text-[14px] text-gray-600">Open an app and try it. If it works, say YES. Ten YES from real people put it live on FAVOUR.</p>

        {error && <p className="rounded-2xl border border-gray-200 bg-white p-4 text-[14px] text-red-600">{error}</p>}

        {!error && apps === null && <p className="text-[12px] text-gray-400">Reading the list…</p>}

        {!error && apps?.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center">
            <p className="text-[15px] font-semibold text-gray-900">No apps are waiting</p>
            <p className="mt-1 text-[14px] text-gray-600">Built something? Post it and ask ten people to try it.</p>
            <Link href="/post" className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-gray-900 px-5 text-[15px] font-semibold text-white active:scale-[0.98] transition-transform">Post your app</Link>
          </div>
        )}

        {apps?.map((app) => <AppCard key={app.id} app={app} note={notes[app.id]} busy={busy === app.id} onYes={() => onYes(app.id)} />)}

        <Link href="/" className="w-full min-h-[48px] flex items-center justify-center rounded-2xl border border-gray-200 bg-white text-[15px] font-semibold text-gray-900">Back to favours</Link>
      </div>
    </div>
  );
}

function AppCard({ app, note, busy, onYes }: { app: ListedApp; note?: string; busy: boolean; onYes: () => void }) {
  const live = app.status === "published";
  return (
    <article data-app={app.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      {app.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.image} alt="" className="block w-full aspect-[1.91/1] object-cover bg-gray-100" />
      )}
      <div className="p-5 flex flex-col gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">{app.productName}</h2>
          <p className="text-[12px] text-gray-400">{hostOf(app.productUrl)}</p>
        </div>
        <p className="text-[14px] text-gray-700">{app.ask}</p>

        <div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${app.of}, minmax(0, 1fr))` }} aria-hidden>
            {pipsFor(app.yes, app.of).map((on, i) => (
              <span key={i} data-pip={on ? "on" : "off"} className={`h-2.5 rounded-full ${on ? "bg-gray-900" : "bg-gray-200"}`} />
            ))}
          </div>
          <p className="mt-2 text-[13px] font-semibold text-gray-900 tabular-nums">{live ? "Live on FAVOUR" : progressLabel(app.yes, app.of)}</p>
        </div>

        <div className="flex gap-2">
          <a href={app.productUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-h-[44px] flex items-center justify-center rounded-full border border-gray-200 bg-white text-[15px] font-semibold text-gray-900 active:scale-[0.98] transition-transform">Open app</a>
          {!live && (
            <button type="button" disabled={busy} aria-label={`Say YES to ${app.productName}`} onClick={onYes} className="flex-1 min-h-[44px] rounded-full bg-gray-900 text-[15px] font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-transform">YES</button>
          )}
        </div>
        {note && <p role="status" className="text-[13px] text-gray-600">{note}</p>}
      </div>
    </article>
  );
}

export function AppsToCheck() {
  const [apps, setApps] = useState<ListedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/apps", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body?.apps)) throw new Error(body?.error ?? "The list could not be read. Try again.");
        setApps(body.apps);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const onYes = useCallback(async (id: string) => {
    setBusy(id);
    let reply: VoteReply = null;
    try {
      const r = await fetch("/api/apps/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      reply = await r.json().catch(() => null);
    } catch {
      reply = null;
    }
    if (reply && "ok" in reply && reply.ok) {
      const { yes, status } = reply;
      setApps((list) => list?.map((a) => (a.id === id ? { ...a, yes, status } : a)) ?? list);
    }
    setNotes((n) => ({ ...n, [id]: voteNote(reply) }));
    setBusy(null);
  }, []);

  return <AppsToCheckView apps={apps} notes={notes} busy={busy} error={error} onYes={onYes} />;
}

// The home board's door to /apps (Feed.tsx). Quiet: one line and a link.
export function AppsToCheckDoor() {
  return (
    <Link href="/apps" className="mx-6 mt-4 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 active:scale-[0.98] transition-transform">
      <span className="flex-1">
        <span className="block text-[15px] font-semibold text-gray-900">Apps to check</span>
        <span className="block text-[13px] text-gray-600">Try new apps. Ten YES puts one live.</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400" aria-hidden><polyline points="9 18 15 12 9 6" /></svg>
    </Link>
  );
}
