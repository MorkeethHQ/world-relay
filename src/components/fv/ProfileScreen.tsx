"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contribution } from "@/lib/completions";
import { builderBadge, feedbackerBadge, reviewerBadge, type Badge } from "@/lib/badges";
import { readStreak, type Streak } from "@/lib/deck-view";
import { displayName, profilePicture, useWorldUsers } from "@/hooks/useWorldUser";
import { funkyArt } from "@/lib/funky-art";

// PROFILE (Oscar, 13 Oct 2026: "Revamp the profile toward an early Product Hunt
// feel"; 11 Oct: badges and levels). Who you are on FAVOUR: name, picture,
// badges with the next step, your streak, your numbers. No admin numbers here
// (Oscar, 5 Jul: the profile felt like an admin dashboard).

function BadgeRow({ b }: { b: Badge }) {
  return (
    <div className="fv-box p-4 flex items-center gap-4">
      <div className="fv-ten" style={{ gridTemplateColumns: "repeat(4, 16px)", gap: 3 }} role="img" aria-label={`${b.name} level ${b.level}`}>
        {[0, 1, 2, 3].map((i) => <span key={i} data-on={i < b.level ? "true" : "false"} />)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="fv-h">{b.name}{b.level > 0 ? ` ${b.level}` : ""}</p>
        <p className="fv-body text-[12px]">{b.line}</p>
      </div>
    </div>
  );
}

export function ProfileView({ address, name, picture, mine, streak, posted, onSignOut, failed, onRetry }: {
  address: string | null; name: string; picture: string | null; mine: Contribution[] | null; streak: Streak | null; posted: boolean; onSignOut: () => void; failed?: boolean; onRetry?: () => void;
}) {
  const reviews = mine?.length ?? 0;
  const withFix = (mine ?? []).filter((c) => (c.proofNote ?? "").toLowerCase().includes("fix")).length;
  const points = (mine ?? []).reduce((n, c) => n + (c.points || 0), 0);
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 h-14 flex items-center justify-between">
        <h1 className="fv-h">Profile</h1>
        {address && <button type="button" onClick={onSignOut} className="fv-body underline underline-offset-2 min-h-[44px]">Sign out</button>}
      </header>
      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        {!address ? (
          <>
            <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Not signed in</p><p className="fv-body">Sign in to keep your campaign work with your wallet.</p><Link href="/" className="fv-btn fv-btn-ink">Explore campaigns</Link></div>
            <p className="fv-body text-[12px]">Rewards are shown by each campaign. Points are not cash. Cash is paid only after a confirmed release.</p>
          </>
        ) : (
          <>
            <section className="fv-box flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture ?? funkyArt(name)} alt="" className="w-28 h-28 object-cover" style={{ borderRight: "2px solid #000" }} />
              <div className="p-4 flex flex-col justify-center gap-1 min-w-0">
                <p className="fv-title break-words">{name}</p>
                <p className="fv-body text-[12px]">Signed in with World wallet</p>
              </div>
            </section>
            <section className="fv-box grid grid-cols-2">
              <div className="p-3" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num fv-blue">{points}</p><p className="fv-label">points</p></div>
              <div className="p-3" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num">{reviews}</p><p className="fv-label">accepted favours</p></div>

            </section>
            {failed && (
              <div role="alert" className="fv-box p-4 flex flex-col gap-2">
                <p className="fv-body">Could not load your accepted work.</p>
                <button type="button" className="fv-btn fv-btn-sm" onClick={onRetry}>Try again</button>
              </div>
            )}
            <p className="fv-body text-[12px]">Rewards are shown by each campaign. Points are not cash. Cash is paid only after a confirmed release. <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link></p>
          </>
        )}
      </div>
    </div>
  );
}

export function ProfileScreen() {
  const [address, setAddress] = useState<string | null>(null);
  const [mine, setMine] = useState<Contribution[] | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [posted, setPosted] = useState(false);
  const [failed, setFailed] = useState(false);
  useWorldUsers(address ? [address] : []);
  const readMine = () => {
    setFailed(false);
    fetch("/api/me/contributions", { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error("read failed"); return d; })
      .then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : []))
      .catch(() => { setFailed(true); setMine([]); });
  };
  useEffect(() => {
    fetch("/api/session", { cache: "no-store", signal: AbortSignal.timeout(8000) })
      .then(async (r) => {
        if (!r.ok) throw new Error("session");
        const session = await r.json();
        if (!session.authenticated) return;
        setAddress(session.address);
        readMine();
      }).catch(() => setFailed(true));
    // readMine reads nothing that changes; the effect runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onSignOut = async () => {
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("sign out");
      localStorage.removeItem("relay_user_id"); localStorage.removeItem("relay_verification_level");
      setAddress(null); setMine(null);
    } catch { setFailed(true); }
  };
  return <ProfileView address={address} name={address ? displayName(address) : ""} picture={address ? profilePicture(address) : null} mine={mine} streak={streak} posted={posted} onSignOut={onSignOut} failed={failed} onRetry={readMine} />;
}
