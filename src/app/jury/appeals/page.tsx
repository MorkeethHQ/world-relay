"use client";
import Link from "next/link";
import { useEffect, useReducer, useState } from "react";
import { START, clampIndex, navReduce, orderReviewCards, positionLabel } from "@/lib/review-nav";

// DECIDE FLAGGED PROOFS (2026-10-05). The human review, reached from inside the
// one Review feature. It lists every flagged proof a person may decide today:
//   - house favours: Welcome (a person's own instance or an original held
//     claim) and written answers on plain favours (GET /api/review/flagged)
//   - company pieces and plain points favours with a photo (GET /api/jury/appeal)
// Three qualified reviewers decide and two must accept. Points only.
// A house proof is sent to a QUALIFIED reviewer only. Someone not yet qualified
// sees how many wait and how to qualify, and no proof.
type Card = {
  source: "house" | "jury";
  scope?: string;
  id: string;
  // House cards only: binds the decision to the exact proof shown here.
  proofToken?: string;
  label: string;
  description: string;
  proofNote: string | null;
  images: string[];
  aiReason: string | null;
  points: number | null;
  tally: { real: number; not: number };
};
type HouseCard = { caseId: string; proofToken: string; scope: "welcome_instance" | "welcome_source" | "house_text"; description: string; proofNote: string | null; images: string[]; aiReason: string; points: number; tally: { real: number; not: number } };
type JuryCard = { cardId: string; proofImageUrl: string; proofNote: string | null; description: string; tally: { real: number; not: number } };
type Loaded = { signedIn: boolean; cards: Card[]; qualified: boolean; record: { judged: number; correct: number }; waiting: number; error: string | null };

async function loadDeck(): Promise<Loaded> {
  const [h, j] = await Promise.all([
    fetch("/api/review/flagged", { cache: "no-store" }),
    fetch("/api/jury/appeal", { cache: "no-store" }),
  ]);
  const none = { cards: [], qualified: false, record: { judged: 0, correct: 0 }, waiting: 0 };
  if (h.status === 403 && j.status === 403) return { ...none, signedIn: false, error: null };
  const hd = h.ok ? await h.json() : null;
  const jd = j.ok ? await j.json() : null;
  if (!hd && !jd) return { ...none, signedIn: true, error: "Reviews are unavailable right now. Nothing was changed." };
  const qualified = !!(hd ?? jd).yourCallCounts;
  const cards: Card[] = [
    ...((hd?.cards ?? []) as HouseCard[]).map((c) => ({ source: "house" as const, scope: c.scope, id: c.caseId, proofToken: c.proofToken, label: c.scope === "house_text" ? "Written answer" : "Welcome favour", description: c.description, proofNote: c.proofNote, images: c.images, aiReason: c.aiReason, points: c.points, tally: c.tally })),
    // The photo appeal deals its cards to anyone signed in (it always has). They
    // are shown here to a qualified reviewer only, the same rule as above.
    ...(qualified ? ((jd?.cards ?? []) as JuryCard[]) : []).map((c) => ({ source: "jury" as const, id: c.cardId, label: "Photo", description: c.description, proofNote: c.proofNote, images: c.proofImageUrl ? [c.proofImageUrl] : [], aiReason: null, points: null, tally: c.tally })),
  ];
  return {
    signedIn: true, cards: orderReviewCards(cards), qualified, error: null,
    record: (hd ?? jd).yourRecord ?? { judged: 0, correct: 0 },
    waiting: (hd?.waiting ?? 0) + (jd?.cards?.length ?? 0),
  };
}

export default function FlaggedProofReviewPage() {
  const [deck, setDeck] = useState<Loaded | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Which proof is on screen, and the reason being written for it. Changed only
  // through navReduce (src/lib/review-nav.ts): moving to another proof is local,
  // sends nothing and clears the reason.
  const [nav, dispatch] = useReducer(navReduce, START);
  const reason = nav.reason;
  const setReason = (value: string) => dispatch({ type: "reason", value });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadDeck()
      .then((d) => { if (live) { setDeck(d); dispatch({ type: "deck", count: d.cards.length }); } })
      .catch(() => { if (live) setDeck({ signedIn: true, cards: [], qualified: false, record: { judged: 0, correct: 0 }, waiting: 0, error: "Reviews are unavailable right now. Nothing was changed." }); });
    return () => { live = false; };
  }, [reloadKey]);

  const count = deck?.cards.length ?? 0;
  const index = clampIndex(nav.index, count);
  const card = deck?.cards[index];
  // NEXT and PREVIOUS only move. No vote, no dismissal, no request: the proof
  // stays in the queue for this reviewer and for everyone else.
  const step = (type: "next" | "previous") => { setMessage(""); dispatch({ type, count }); };
  async function decide(verdict: "real" | "not") {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      const address = localStorage.getItem("relay_user_id");
      const response = card.source === "house"
        ? await fetch("/api/review/flagged", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, caseId: card.id, proofToken: card.proofToken, verdict, reason }) })
        : await fetch("/api/jury/appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, cardId: card.id, verdict, reason }) });
      const result = await response.json();
      // The sender replaced the proof while this card was open: show the new one.
      if (result.code === "stale") { setMessage(result.error); setReason(""); setReloadKey((k) => k + 1); return; }
      if (!response.ok || result.error) throw new Error(result.error || result.reason || "Your review was not counted.");
      if (result.counted === false && result.outcome === "pending") throw new Error(result.reason || "Your review was not counted.");
      const n = result.tally.real + result.tally.not;
      setMessage(result.outcome === "pending"
        ? `Review saved. ${n} of 3 reviewers have decided this proof. No reward yet.`
        : result.outcome === "cleared"
          ? `Accepted by the reviewers. ${result.pointsAwardedToClaimant ?? 0} points added for the person who sent it.`
          : "The reviewers did not accept this proof. No points were added. The person can send a new proof.");
      setReason("");
      setReloadKey((k) => k + 1);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Your review could not be saved."); }
    finally { setBusy(false); }
  }

  const canDecide = !!deck?.qualified && reason.trim().length >= 20 && !busy;
  return <main className="max-w-lg mx-auto px-5 pt-6 pb-28 flex flex-col gap-5">
    <Link href="/" className="min-h-[44px] inline-flex items-center text-[14px] text-gray-500">Back to favours</Link>
    <div>
      <h1 className="text-[24px] font-bold tracking-tight text-gray-900">Decide flagged proofs</h1>
      <p className="mt-2 text-[14px] leading-snug text-gray-600">The automatic check was not sure about these proofs. Read what was asked, look at what was sent, and decide. Three qualified reviewers decide each proof and two must accept it. A decision here can add points only. It never moves USDC.</p>
    </div>
    {deck?.error && <p role="alert" className="rounded-2xl bg-gray-100 p-4 text-[14px] text-gray-900">{deck.error}</p>}
    {deck && !deck.signedIn && <p className="rounded-2xl bg-gray-100 p-4 text-[14px] text-gray-700">Sign in with your World wallet to review. Open FAVOUR in World App.</p>}
    {deck?.signedIn && !deck.qualified && !deck.error && (
      <div className="rounded-2xl bg-amber-50 p-4 text-[14px] leading-snug text-gray-900">
        <p className="font-semibold">You are not a qualified reviewer yet, so no flagged proof is shown to you.</p>
        <p className="mt-1">{deck.waiting > 0 ? `${deck.waiting} flagged ${deck.waiting === 1 ? "proof waits" : "proofs wait"} for a decision. ` : ""}Your record: {deck.record.correct} of {deck.record.judged} graded cards right. To qualify, judge at least 10 graded cards in Review favours and get 60% right.</p>
        <Link href="/" className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2">Go to Review favours</Link>
      </div>
    )}
    {message && <p role="status" className="rounded-2xl bg-gray-100 p-4 text-[14px] text-gray-900">{message}</p>}
    {card && count > 1 && (
      <nav aria-label="Flagged proofs" className="rounded-2xl border border-gray-200 bg-white p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step("previous")} disabled={busy} className="min-h-[48px] flex-1 rounded-full border border-gray-300 bg-white text-[15px] font-semibold text-gray-900 disabled:opacity-40">Previous</button>
          <p aria-live="polite" className="min-w-[96px] text-center text-[13px] font-semibold text-gray-900 tabular-nums">{positionLabel(index, count)}</p>
          <button type="button" onClick={() => step("next")} disabled={busy} className="min-h-[48px] flex-1 rounded-full border border-gray-300 bg-white text-[15px] font-semibold text-gray-900 disabled:opacity-40">Next proof</button>
        </div>
        <p className="text-[12px] leading-snug text-gray-500">Moving on does not vote. A proof you pass stays in the queue until three reviewers have decided it.</p>
      </nav>
    )}
    {card ? <section key={`${card.source}:${card.id}:${card.proofToken ?? ""}`} className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">{card.label}{card.points ? ` · ${card.points} pts if accepted` : ""}</p>
        <p className="mt-1 text-[12px] font-semibold text-gray-500">What was asked</p>
        <h2 className="text-[16px] font-semibold leading-snug text-gray-900 whitespace-pre-wrap break-words">{card.description}</h2>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-gray-500">What was sent</p>
        {card.images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt={`Submitted proof ${i + 1}`} className="mt-2 w-full max-h-80 object-contain rounded-xl bg-gray-100" />
        ))}
        {card.proofNote
          ? <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-[15px] leading-snug text-gray-900 whitespace-pre-wrap break-words">{card.proofNote}</p>
          : card.images.length === 0 && <p className="mt-2 text-[14px] text-gray-500">Nothing readable was sent.</p>}
      </div>
      {card.aiReason && <p className="text-[13px] leading-snug text-gray-600"><span className="font-semibold text-gray-900">Why the automatic check was not sure: </span>{card.aiReason}</p>}
      <p className="text-[12px] text-gray-500">{card.tally.real + card.tally.not} of 3 reviews saved</p>
      <label className="block text-[14px] font-semibold text-gray-900">Reason for your decision
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={4} className="block w-full mt-2 rounded-xl border border-gray-200 p-3 text-[16px] font-normal" placeholder="What in this proof does or does not meet what was asked?" />
      </label>
      <p className="text-[12px] text-gray-500">At least 20 characters. Your reason is saved, and the person who sent the proof sees it if the proof is not accepted.</p>
      <div className="flex flex-col gap-2">
        <button disabled={!canDecide} onClick={() => decide("real")} className="w-full min-h-[48px] rounded-full bg-gray-900 text-white text-[15px] font-semibold disabled:opacity-40">It meets what was asked</button>
        <button disabled={!canDecide} onClick={() => decide("not")} className="w-full min-h-[48px] rounded-full border border-gray-300 bg-white text-gray-900 text-[15px] font-semibold disabled:opacity-40">It does not meet it</button>
      </div>
    </section> : deck?.signedIn && deck.qualified && !deck.error && <p className="rounded-2xl border border-gray-200 bg-white p-5 text-[14px] text-gray-600">No flagged proof is waiting for your decision.</p>}
    <Link href="/history" className="min-h-[44px] inline-flex items-center text-[14px] font-semibold text-gray-900 underline underline-offset-2">Your History</Link>
  </main>;
}
