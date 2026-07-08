"use client";

import { useEffect, useState } from "react";

type Item = { type: string; label: string; location: string | null; ts: number };

// Honest relative time. "just now" under 45s, then m/h/d.
function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A thin, honest "it's alive" strip for the board. Renders REAL recent activity
// from /api/activity (logged SSE events only) and shows nothing when there is no
// activity — never a fabricated event. One line at a time, rotating, so it stays
// out of the way of the task list. No reward amounts (points/USDC are never
// conflated and the event can't tell them apart) and no identities.
export function LivenessStrip({ refreshKey }: { refreshKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/activity")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (alive) {
          setItems(Array.isArray(d.items) ? d.items : []);
          setIdx(0);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items.length]);

  if (items.length === 0) return null;
  const it = items[Math.min(idx, items.length - 1)];

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-gray-400" aria-live="polite">
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
      </span>
      <span className="truncate">
        <span className="text-gray-600 font-medium">{it.label}</span>
        {it.location ? <span> in {it.location}</span> : null}
        <span className="text-gray-300"> &middot; {relTime(it.ts, Date.now())}</span>
      </span>
    </div>
  );
}
