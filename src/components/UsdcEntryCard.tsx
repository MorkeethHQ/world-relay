"use client";

import { useEffect, useState } from "react";

/**
 * "From $0.10" entry for USDC favours (v3 look, KEPT 2 Nov 2026). Shown only when the server says
 * new fundings go to FavourPots (rail 4); while the rail is dark the home page is unchanged.
 */
export function UsdcEntryCard() {
  const [rail, setRail] = useState<{ rail?: number; feeBps?: number; minUsd?: number } | null>(null);
  useEffect(() => {
    fetch("/api/escrow-v2").then((r) => (r.ok ? r.json() : null)).then(setRail).catch(() => setRail(null));
  }, []);
  if (!rail || rail.rail !== 4) return null;
  const fee = ((rail.feeBps ?? 250) / 100).toFixed(1);
  const min = (rail.minUsd ?? 0.1).toFixed(2);
  return (
    <article className="usdc-entry" aria-label="USDC favours">
      <p className="usdc-entry-kicker">New · USDC favours</p>
      <p className="usdc-entry-big">From ${min}</p>
      <p className="usdc-entry-copy">Put real USDC behind a favour. You choose who gets paid when it's done. {fee}% fee at payout, never on deposit.</p>
      <a className="usdc-entry-btn" href="/post">Post a paid favour</a>
    </article>
  );
}
