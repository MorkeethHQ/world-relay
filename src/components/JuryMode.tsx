"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { hapticTap, hapticSuccess, hapticError } from "@/lib/minikit-helpers";
import { CategoryIcon } from "@/components/CategoryIcon";

type JuryCard = {
  key: string;
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

  const card = cards[0];

  const vote = useCallback((saidMatch: boolean) => {
    if (!card || busy.current) return;
    busy.current = true;
    hapticTap();
    setDx(saidMatch ? 500 : -500);
    const key = card.key;

    // Advance IMMEDIATELY — the deck must never wait on the network (the
    // v1 await here made every verdict lag and the card feel stuck).
    setTimeout(() => {
      setCards((c) => c.slice(1));
      setDx(0);
      busy.current = false;
    }, 160);

    // Resolve the verdict in the background; flash lands on the next card.
    if (userId) {
      fetch("/api/jury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userId, key, verdict: saidMatch ? "match" : "not" }),
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
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : !card ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-2xl font-bold text-gray-900">All judged</p>
            <p className="text-sm text-gray-400">
              {session.judged > 0
                ? `${session.correct} of ${session.judged} right${session.points > 0 ? `, +${session.points} pts` : ""}. New proofs land as favours get completed.`
                : "No proofs to judge right now. Complete some favours and come back."}
            </p>
            <button onClick={onClose} className="mt-3 px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold active:scale-95 transition-transform">
              Back to favours
            </button>
          </div>
        ) : (
          <>
            {/* Next card peeking behind */}
            {cards[1] && <div className="absolute inset-x-8 top-3 bottom-6 rounded-3xl bg-white border border-gray-200" />}

            <div
              className="absolute inset-x-5 top-1 bottom-4 rounded-3xl bg-white border border-gray-200 shadow-lg overflow-hidden flex flex-col select-none touch-pan-y"
              style={{ transform: `translateX(${dx}px) rotate(${tilt}deg)`, transition: dragging.current ? "none" : "transform 180ms ease-out" }}
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
                  <p className="text-white font-black text-xl">{flash.correct ? "Called it" : flash.isMatch ? "It was real" : "It was fake"}</p>
                  {flash.points > 0 && <p className="text-white/90 text-sm font-semibold">+{flash.points} pt</p>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Verdict buttons */}
      {card && !loading && (
        <div className="flex items-center justify-center gap-10 pb-8 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}>
          <button onClick={() => vote(false)} aria-label="Not real" className="w-16 h-16 rounded-full bg-white border-2 border-red-200 shadow-sm flex items-center justify-center active:scale-90 transition-transform">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <p className="text-[11px] text-gray-400 max-w-[90px] text-center leading-tight">Does the photo prove this favour?</p>
          <button onClick={() => vote(true)} aria-label="Real" className="w-16 h-16 rounded-full bg-white border-2 border-green-200 shadow-sm flex items-center justify-center active:scale-90 transition-transform">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
