"use client";
import { useEffect, useState } from "react";

type Card = { cardId: string; proofImageUrl: string; proofNote: string | null; description: string; tally: { real: number; not: number } };
export default function AppealReviewPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [qualified, setQualified] = useState(false);
  const [record, setRecord] = useState({ judged: 0, correct: 0 });
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch("/api/jury/appeal?company=1", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Reviews unavailable");
    setCards(data.cards); setQualified(data.yourCallCounts); setRecord(data.yourRecord);
  };
  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);
  const card = cards[0];
  async function decide(verdict: "real" | "not") {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/jury/appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: localStorage.getItem("relay_user_id"), cardId: card.cardId, verdict, reason }) });
      const result = await response.json();
      if (!response.ok || !result.counted) throw new Error(result.error || result.reason || "Review was not counted");
      setMessage(result.outcome === "pending" ? `Review saved. ${result.tally.real + result.tally.not}/3 judges have reviewed this proof. No reward yet.` : result.outcome === "cleared" ? `Accepted by the jury. ${result.pointsAwardedToClaimant} points awarded to its contributor.` : "The jury did not accept this proof. No points awarded.");
      setReason(""); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Review could not be saved"); }
    finally { setBusy(false); }
  }
  return <main className="max-w-lg mx-auto px-5 pt-6 pb-28 space-y-5">
    <a href="/" className="text-sm underline">Back to FAVOUR</a>
    <h1 className="text-2xl font-bold">Review flagged photos</h1>
    <p className="text-sm text-gray-600">The AI could not accept these company photos. Check the actual request and proof. Three distinct qualified judges decide; two must accept. This review can award points only.</p>
    {!qualified && <p className="rounded-xl bg-amber-50 p-4 text-sm">Your record: {record.correct}/{record.judged} graded cards correct. Complete at least 10 at 60% accuracy in Real or not before your review can count.</p>}
    {message && <p role="status" className="rounded-xl bg-gray-100 p-4 text-sm">{message}</p>}
    {card ? <section className="border rounded-2xl p-4 space-y-4">
      <h2 className="text-base font-semibold whitespace-pre-wrap break-words">{card.description}</h2>
      <img src={card.proofImageUrl} alt="Submitted proof for this review" className="w-full max-h-80 object-contain rounded-xl bg-gray-100" />
      <p className="text-sm whitespace-pre-wrap break-words">{card.proofNote}</p>
      <p className="text-xs text-gray-500">{card.tally.real + card.tally.not}/3 reviews saved</p>
      <label className="block text-sm font-semibold">Reason for your decision<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={4} className="block w-full mt-2 rounded-xl border p-3 font-normal" placeholder="What in this proof does or does not meet the request?" /></label>
      <p className="text-xs text-gray-500">At least 20 characters. Your reason is saved for the contributor and company.</p>
      <div className="flex gap-3">
        <button disabled={!qualified || reason.trim().length < 20 || busy} onClick={() => decide("not")} className="flex-1 min-h-12 border rounded-full disabled:opacity-40">Does not meet it</button>
        <button disabled={!qualified || reason.trim().length < 20 || busy} onClick={() => decide("real")} className="flex-1 min-h-12 bg-gray-900 text-white rounded-full disabled:opacity-40">Meets the request</button>
      </div>
    </section> : <p className="py-6 text-gray-500">No further flagged photos for you to review.</p>}
    <a href="/history" className="block text-sm underline">Your History</a>
  </main>;
}
