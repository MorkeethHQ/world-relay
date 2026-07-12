"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { hapticTap, hapticSuccess, hapticError } from "@/lib/minikit-helpers";
import { CategoryIcon } from "@/components/CategoryIcon";

type JuryCard = {
  cardId: string;
  proofImageUrl: string;
  proofNote: string | null;
  description: string;
  category: string;
  location: string;
};

type Flash = { correct: boolean; isMatch: boolean; points: number } | null;

// REAL OR NOT — swipe right if the photo proves THIS favour, left if it
// doesn't. Full-screen immersive deck; verdicts are final; correct calls pay
// 1 pt (daily cap server-side). The jury never moves money.
export function JuryMode({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [cards, setCards] = useState<JuryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [session, setSession] = useState({ judged: 0, correct: 0, points: 0 });
  const [dx, setDx] = useState(0);
  // One-time explainer before the first swipe (Oscar: walk through the concept
  // first). Shown until dismissed, then never again for this device.
  const [showIntro, setShowIntro] = useState(false);
  const startX = useRef(0);
  const dragging = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    const url = `/api/jury${userId ? `?address=${encodeURIComponent(userId)}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    try {
      if (!localStorage.getItem("favour_jury_intro_seen")) setShowIntro(true);
    } catch {}
  }, []);

  const dismissIntro = () => {
    try { localStorage.setItem("favour_jury_intro_seen", "1"); } catch {}
    hapticTap();
    setShowIntro(false);
  };

  // Warm the NEXT proof image while the current card is on top, so advancing
  // never waits on a network fetch (the main source of the swipe lag).
  useEffect(() => {
    const next = cards[1]?.proofImageUrl;
    if (next && typeof window !== "undefined") {
      const img = new window.Image();
      img.src = next;
    }
  }, [cards]);

  const card = cards[0];

  const vote = useCallback((saidMatch: boolean) => {
    if (!card || busy.current) return;
    busy.current = true;
    hapticTap();
    setDx(saidMatch ? 500 : -500);
    const cardId = card.cardId;

    // Advance IMMEDIATELY — the deck must never wait on the network (the
    // v1 await here made every verdict lag and the card feel stuck).
    setTimeout(() => {
      setCards((c) => c.slice(1));
      setDx(0);
      busy.current = false;
    }, 110);

    // Resolve the verdict in the background; flash lands on the next card.
    if (userId) {
      fetch("/api/jury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userId, cardId, verdict: saidMatch ? "match" : "not" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((result: { correct: boolean; isMatch: boolean; pointsAwarded: number } | null) => {
          if (!result) return;
          if (result.correct) hapticSuccess(); else hapticError();
          setFlash({ correct: result.correct, isMatch: result.isMatch, points: result.pointsAwarded });
          setSession((s) => ({
            judged: s.judged + 1,
            correct: s.correct + (result.correct ? 1 : 0),
            points: s.points + result.pointsAwarded,
          }));
          setTimeout(() => setFlash(null), 800);
        })
        .catch(() => {});
    }
  }, [card, userId]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (busy.current) return;
    dragging.current = true;
    startX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current || busy.current) return;
    setDx(e.touches[0].clientX - startX.current);
  };
  const onTouchEnd = () => {
    if (!dragging.current || busy.current) return;
    dragging.current = false;
    if (dx > 90) vote(true);
    else if (dx < -90) vote(false);
    else setDx(0);
  };

  const tilt = Math.max(-14, Math.min(14, dx / 12));
  const leanReal = dx > 40;
  const leanNot = dx < -40;

  return (
    // z-[60] so the immersive deck covers the app's fixed bottom nav (z-50) —
    // the nav was overlaying and cropping the verdict buttons.
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <button onClick={() => { hapticTap(); onClose(); }} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:scale-95 transition-transform" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <p className="text-[13px] font-bold text-gray-900 tracking-widest">REAL OR NOT</p>
        <div className="text-right min-w-[36px]">
          {session.judged > 0 && (
            <p className="text-[11px] text-gray-400">{session.correct}/{session.judged}{session.points > 0 ? ` · +${session.points}` : ""}</p>
          )}
        </div>
      </div>

      {/* Card stage */}
      <div className="flex-1 relative px-5 pb-2 overflow-hidden">
        {showIntro ? (
          <div className="absolute inset-0 flex flex-col px-1">
            <style>{`
              @keyframes juryDemoTilt {0%,12%{transform:translateX(0) rotate(0)}28%,40%{transform:translateX(34px) rotate(9deg)}56%,60%{transform:translateX(0) rotate(0)}76%,88%{transform:translateX(-34px) rotate(-9deg)}100%{transform:translateX(0) rotate(0)}}
              @keyframes juryStampReal {0%,16%{opacity:0}28%,44%{opacity:1}58%,100%{opacity:0}}
              @keyframes juryStampNot {0%,60%{opacity:0}76%,90%{opacity:1}96%,100%{opacity:0}}
              @keyframes juryStepIn {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
              .jury-demo{animation:juryDemoTilt 4.2s ease-in-out infinite}
              .jury-stamp-real{opacity:0;animation:juryStampReal 4.2s ease-in-out infinite}
              .jury-stamp-not{opacity:0;animation:juryStampNot 4.2s ease-in-out infinite}
              .jury-step{opacity:0;animation:juryStepIn .32s ease-out forwards}
              @media (prefers-reduced-motion: reduce){.jury-demo,.jury-stamp-real,.jury-stamp-not,.jury-step{animation:none}.jury-step{opacity:1}}
            `}</style>
            <div className="flex-1 flex items-center justify-center">
              <div className="jury-demo relative w-[188px] h-[236px] rounded-3xl bg-white border border-gray-200 shadow-lg overflow-hidden">
                <div className="px-4 pt-4">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">the favour</span>
                  <p className="text-[13px] font-semibold text-gray-900 leading-snug mt-1">Water the neighbour&rsquo;s plants</p>
                </div>
                <div className="absolute bottom-0 inset-x-0 h-28 bg-gray-100" />
                <div className="jury-stamp-real absolute bottom-8 left-3 rotate-[-12deg] border-4 border-green-500 text-green-500 font-black text-xl px-2.5 py-0.5 rounded-lg bg-white/70">REAL</div>
                <div className="jury-stamp-not absolute bottom-8 right-3 rotate-[12deg] border-4 border-red-500 text-red-500 font-black text-xl px-2.5 py-0.5 rounded-lg bg-white/70">NOT</div>
              </div>
            </div>
            <div className="space-y-3 pb-1">
              {[
                "Every photo is a real proof — but it may be pinned to the wrong favour.",
                "Swipe right if the photo proves THIS favour. Left if it doesn't match.",
                "Call it right and you earn a point. Up to 20 a day.",
              ].map((t, i) => (
                <div key={i} className="jury-step flex items-start gap-3" style={{ animationDelay: `${0.1 + i * 0.09}s` }}>
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <p className="text-[13px] text-gray-600 leading-snug">{t}</p>
                </div>
              ))}
            </div>
            <button onClick={dismissIntro} className="mb-6 mt-4 w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-semibold active:scale-[0.98] transition-transform" style={{ marginBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
              Start judging
            </button>
          </div>
        ) : loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : !card ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {session.judged > 0 ? (
              <>
                {/* Celebratory finish: the deck's done, thank the human. Staggered
                    entrance so it lands as a moment, not just an empty state. */}
                <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center animate-[countUp_0.5s_ease-out]">
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div className="animate-[fadeSlideIn_0.4s_ease-out_0.1s_both]">
                  <p className="text-2xl font-bold text-gray-900">Thanks for keeping FAVOUR human</p>
                  <p className="text-sm text-gray-400 mt-1">You judged every proof in the deck.</p>
                </div>
                <div className="flex items-center gap-2 animate-[fadeSlideIn_0.4s_ease-out_0.2s_both]">
                  <div className="px-4 py-2 rounded-xl bg-gray-100">
                    <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{session.correct}/{session.judged}</p>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">called right</p>
                  </div>
                  {session.points > 0 && (
                    <div className="px-4 py-2 rounded-xl bg-amber-50">
                      <p className="text-lg font-bold text-amber-600 tabular-nums leading-none">+{session.points}</p>
                      <p className="text-[10px] text-amber-500 uppercase tracking-wide mt-1">points</p>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 animate-[fadeSlideIn_0.4s_ease-out_0.3s_both]">New proofs land as favours get completed.</p>
                <button onClick={onClose} className="mt-1 px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold active:scale-95 transition-transform animate-[fadeSlideIn_0.4s_ease-out_0.35s_both]">
                  Back to favours
                </button>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900">All judged</p>
                <p className="text-sm text-gray-400">No proofs to judge right now. Complete some favours and come back.</p>
                <button onClick={onClose} className="mt-3 px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold active:scale-95 transition-transform">
                  Back to favours
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Next card peeking behind */}
            {cards[1] && <div className="absolute inset-x-8 top-3 bottom-6 rounded-3xl bg-white border border-gray-200" />}

            <div
              className="absolute inset-x-5 top-1 bottom-4 rounded-3xl bg-white border border-gray-200 shadow-lg overflow-hidden flex flex-col select-none touch-pan-y"
              style={{ transform: `translateX(${dx}px) rotate(${tilt}deg)`, transition: dragging.current ? "none" : "transform 130ms ease-out" }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              {/* The claimed favour */}
              <div className="px-5 pt-5 pb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <CategoryIcon category={card.category} size={14} />
                  <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">the favour</span>
                </div>
                <p className="text-[15px] font-semibold text-gray-900 leading-snug line-clamp-3">{card.description}</p>
              </div>
              {/* The proof */}
              <div className="flex-1 relative bg-gray-100 min-h-0">
                <img src={card.proofImageUrl} alt="Proof" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
                {card.proofNote && (
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 pb-3">
                    <p className="text-[12px] text-white/90 line-clamp-2">&ldquo;{card.proofNote}&rdquo;</p>
                  </div>
                )}
                {/* Swipe lean stamps */}
                {leanReal && (
                  <div className="absolute top-4 left-4 rotate-[-12deg] border-4 border-green-500 text-green-500 font-black text-2xl px-3 py-1 rounded-xl bg-black/30">REAL</div>
                )}
                {leanNot && (
                  <div className="absolute top-4 right-4 rotate-[12deg] border-4 border-red-500 text-red-500 font-black text-2xl px-3 py-1 rounded-xl bg-black/30">NOT</div>
                )}
              </div>
            </div>

            {/* Verdict flash */}
            {flash && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`px-6 py-4 rounded-2xl text-center ${flash.correct ? "bg-green-500" : "bg-red-500"}`}>
                  <p className="text-white font-black text-xl">{flash.correct ? "Called it" : flash.isMatch ? "It matched" : "Wrong favour"}</p>
                  {flash.points > 0 && <p className="text-white/90 text-sm font-semibold">+{flash.points} pt</p>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Verdict buttons */}
      {card && !loading && !showIntro && (
        <div className="flex items-center justify-center gap-10 pb-8 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}>
          <button onClick={() => vote(false)} aria-label="Doesn't match" className="w-16 h-16 rounded-full bg-white border-2 border-red-200 shadow-sm flex items-center justify-center active:scale-90 transition-transform">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <p className="text-[11px] text-gray-400 max-w-[90px] text-center leading-tight">Does the photo prove this favour?</p>
          <button onClick={() => vote(true)} aria-label="Matches" className="w-16 h-16 rounded-full bg-white border-2 border-green-200 shadow-sm flex items-center justify-center active:scale-90 transition-transform">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
