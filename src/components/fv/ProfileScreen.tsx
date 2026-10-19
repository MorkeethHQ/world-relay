"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Contribution } from "@/lib/completions";
import { ensureSession } from "@/lib/reauth";
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

export function ProfileView({ address, name, picture, mine, streak, posted, onSignOut }: {
  address: string | null; name: string; picture: string | null; mine: Contribution[] | null; streak: Streak | null; posted: boolean; onSignOut: () => void;
}) {
  const reviews = mine?.length ?? 0;
  const withFix = (mine ?? []).filter((c) => (c.proofNote ?? "").toLowerCase().includes("fix")).length;
  const points = (mine ?? []).reduce((n, c) => n + (c.points || 0) + (c.streakBonus || 0), 0);
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 h-14 flex items-center justify-between">
        <h1 className="fv-h">Profile</h1>
        {address && <button type="button" onClick={onSignOut} className="fv-body underline underline-offset-2 min-h-[44px]">Sign out</button>}
      </header>
      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        {!address ? (
          <>
            <div className="fv-box p-5 flex flex-col gap-3"><p className="fv-h">Not signed in</p><p className="fv-body">Sign in from the deck when you try your first project.</p><Link href="/" className="fv-btn fv-btn-ink">Open the deck</Link></div>
            <section aria-label="Badges you can earn" className="flex flex-col gap-3">
              <h2 className="fv-label">Badges you can earn</h2>
              <BadgeRow b={reviewerBadge(0)} />
              <BadgeRow b={feedbackerBadge(0)} />
              <BadgeRow b={builderBadge(false)} />
            </section>
            <p className="fv-body text-[12px]">Ten reviews is the first real milestone. Builders pay reviewers in USDC through an escrow FAVOUR never holds.</p>
          </>
        ) : (
          <>
            <section className="fv-box flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture ?? funkyArt(name)} alt="" className="w-28 h-28 object-cover" style={{ borderRight: "2px solid #000" }} />
              <div className="p-4 flex flex-col justify-center gap-1 min-w-0">
                <p className="fv-title break-words">{name}</p>
                <p className="fv-body text-[12px]">Verified human on World</p>
              </div>
            </section>
            <section className="fv-box grid grid-cols-3">
              <div className="p-3" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num fv-blue">{points}</p><p className="fv-label">points</p></div>
              <div className="p-3" style={{ borderRight: "2px solid #000" }}><p className="fv-title fv-num">{reviews}</p><p className="fv-label">reviews</p></div>
              <div className="p-3"><p className="fv-title fv-num">{streak?.days ?? 0}</p><p className="fv-label">day streak</p></div>
            </section>
            <section aria-label="Badges" className="flex flex-col gap-3">
              <h2 className="fv-label">Badges</h2>
              <BadgeRow b={reviewerBadge(reviews)} />
              <BadgeRow b={feedbackerBadge(withFix)} />
              <BadgeRow b={builderBadge(posted)} />
            </section>
            <p className="fv-body text-[12px]">Ten reviews is the first real milestone. Builders pay reviewers in USDC through an escrow FAVOUR never holds. <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link></p>
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
  useWorldUsers(address ? [address] : []);
  useEffect(() => {
    try { setStreak(readStreak(localStorage.getItem("favour_streak"))); setPosted(localStorage.getItem("favour_role") === JSON.stringify("build")); } catch {}
    const stored = (() => { try { return localStorage.getItem("relay_user_id"); } catch { return null; } })();
    if (!stored) return;
    setAddress(stored);
    ensureSession(stored.startsWith("0x") ? stored : null).finally(() => {
      fetch("/api/me/contributions", { cache: "no-store" }).then((r) => r.json()).then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : [])).catch(() => setMine([]));
    });
  }, []);
  const onSignOut = () => { try { localStorage.removeItem("relay_user_id"); localStorage.removeItem("relay_verification_level"); } catch {} setAddress(null); };
  return <ProfileView address={address} name={address ? displayName(address) : ""} picture={address ? profilePicture(address) : null} mine={mine} streak={streak} posted={posted} onSignOut={onSignOut} />;
}
