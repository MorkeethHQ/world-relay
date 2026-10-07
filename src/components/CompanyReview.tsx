"use client";
import { ContributionResponses } from "./ContributionResponses";
import { useEffect, useState } from "react";
import type { CompanyReview as Review } from "@/lib/company-review-shape";
import { evidenceUrl } from "@/lib/company-review-shape";
import { PIECE_LABEL } from "@/lib/campaign-draft-shape";

const field = "w-full rounded-xl border border-gray-300 bg-white p-3 text-[15px] text-gray-900";

function EvidenceImage({ url, number }: { url: string; number: number }) {
  const [unavailable, setUnavailable] = useState(false);
  return <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 block rounded-xl border border-gray-200 p-3">
    {unavailable ? <p className="text-sm text-gray-600">Photo preview unavailable. You can try opening the original.</p> :
      // Use the existing owner-authorised URL directly; never send private proof
      // through a public image optimiser or a separate thumbnail service.
      <img src={url} alt={`Submitted proof image ${number}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setUnavailable(true)} className="rounded-lg bg-gray-50" style={{ width: "100%", maxHeight: 240, objectFit: "contain" }} />}
    <span className="mt-2 flex min-h-11 items-center text-sm underline">Open proof image {number} ↗</span>
  </a>;
}

export function CompanyReview({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [decision, setDecision] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    fetch(`/api/campaigns/drafts/${encodeURIComponent(id)}/review`, { cache: "no-store" })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || "Could not load this campaign."); return data as Review; })
      .then(data => { if (!live) return; setReview(data); const latest = data.decisions[0]; setQuestion(latest?.question || ""); setDecision(latest?.decision || ""); setSelected(latest?.evidenceIds || []); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id, reload]);
  async function save() {
    setBusy(true); setError(""); setSaved("");
    try {
      const res = await fetch(`/api/campaigns/drafts/${encodeURIComponent(id)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, decision, evidenceIds: selected }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "Could not save.");
      setReview(prev => prev ? { ...prev, decisions: [data.entry, ...prev.decisions] } : prev);
      setSaved(decision.trim() ? "Decision saved with its evidence. It will be here when you return." : "Question saved. Return here when people submit work.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm the save. Reload before trying again."); }
    finally { setBusy(false); }
  }
  const latest = review?.decisions[0];
  return <div className="mx-auto max-w-2xl px-5 py-6 text-gray-900" style={{ fontFamily: '"TWK Lausanne", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <a href="/" className="inline-flex min-h-11 items-center text-sm text-gray-600">← Back to FAVOUR</a>
    <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Company evidence · private</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-tight">{review?.campaign.company || "Your campaign"}</h1>
    <p className="mt-3 text-sm leading-6 text-gray-600">Read the work, then record the decision it informs. Only the campaign owner can see this page. Saving a decision does not change a proof verdict or reward.</p>
    {error && <div role="alert" className="mt-5 rounded-xl border border-error-200 bg-error-100 p-4 text-sm text-error-700">{error}<button type="button" onClick={() => setReload(n => n + 1)} className="mt-2 block min-h-11 underline">Reload campaign</button></div>}
    {!review && !error && <p className="mt-6 text-sm">Loading your evidence…</p>}
    {review && <>
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold">The original request</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{review.campaign.brief}</p>
        <p className="mt-3 text-xs text-gray-500">{review.campaign.status === "draft" ? "Private draft. No pieces have been published." : "Company campaign · points only"}</p>
      </section>
      <div className="mt-8"><ContributionResponses id={id} /></div>
      <form onSubmit={e => { e.preventDefault(); void save(); }} className="mt-6 space-y-6">
        <section>
          <label htmlFor="question" className="block text-base font-semibold">What will this work help you decide?</label>
          <textarea id="question" value={question} onChange={e => { setQuestion(e.target.value); setSaved(""); }} minLength={10} maxLength={500} required rows={3} className={`${field} mt-3`} placeholder="Name one decision you can make from the work." />
        </section>
        <section aria-label="Submitted evidence" className="space-y-3">
          <h2 className="text-base font-semibold">Read the submitted work</h2>
          <p className="text-sm text-gray-600">Select the pieces that inform your decision. A verifier verdict is shown separately from your conclusion.</p>
          {!review.evidence.length && <div className="rounded-xl border border-dashed border-gray-300 p-5 text-sm leading-6 text-gray-600">No evidence has been retained for this campaign yet. New reviewed submissions will appear here. Older public verdicts do not contain the original work.</div>}
          {review.evidence.map(e => <article id={`evidence-${e.id}`} key={e.id} className="rounded-2xl border border-gray-200 bg-white p-4">
            <label className="flex cursor-pointer items-start gap-3 py-2">
              <input type="checkbox" checked={selected.includes(e.id)} onChange={event => { setSelected(old => event.target.checked ? [...old, e.id] : old.filter(x => x !== e.id)); setSaved(""); }} aria-label={`Use ${e.kind ? PIECE_LABEL[e.kind] : "piece"} from ${e.participant}`} className="mt-1 h-5 w-5 shrink-0 accent-gray-900" />
              <span className="min-w-0"><span className="block text-sm font-semibold">{e.kind ? PIECE_LABEL[e.kind] : "Piece"} · {e.participant}</span><span className="mt-1 block text-xs text-gray-500">{e.reviewMethod === "human_jury" ? "Human jury" : "Verifier"}: {e.verdict === "pass" ? "accepted" : e.verdict === "fail" ? "rejected" : "in review"} · {new Date(e.at).toLocaleString()}</span></span>
            </label>
            {e.images.map((url, i) => <EvidenceImage key={url} url={url} number={i + 1} />)}
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{e.note || "No written note accompanied this submission."}</p>
            {evidenceUrl(e.note.trim()) && <a href={evidenceUrl(e.note.trim())!} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline">Open submitted link ↗</a>}
            <p className="mt-3 border-t border-gray-100 pt-3 text-xs leading-5 text-gray-500">Review reason: {e.reason}</p>
            {e.reviewReasons && <ol className="mt-2 list-decimal pl-5 text-xs text-gray-600 space-y-2">{e.reviewReasons.map((reason, i) => <li key={i}>{reason}</li>)}</ol>}
          </article>)}
        </section>
        <section>
          <label htmlFor="decision" className="block text-base font-semibold">What will you do with it?</label>
          <p className="mt-2 text-sm text-gray-600">Explain what changes, or why the evidence supports keeping things as they are. Leave this blank to save the question first.</p>
          <textarea id="decision" value={decision} onChange={e => { setDecision(e.target.value); setSaved(""); }} maxLength={4000} rows={4} className={`${field} mt-3`} />
          <p className="mt-2 text-xs text-gray-500">{selected.length} pieces selected. This is your decision, not independent proof of impact.</p>
        </section>
        {saved && <p role="status" className="rounded-xl border border-gray-300 bg-white p-4 text-sm">{saved}</p>}
        <button disabled={busy} className="min-h-12 w-full rounded-full bg-gray-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : decision.trim() ? "Save decision with evidence" : "Save question"}</button>
      </form>
      {!!review.decisions.length && <section className="mt-8 border-t border-gray-200 pt-6">
        <h2 className="text-base font-semibold">Decision history</h2>
        {review.decisions.map(entry => <article key={entry.id} className="mt-4 rounded-xl bg-white p-4 text-sm">
          <p className="text-xs text-gray-500">{new Date(entry.at).toLocaleString()}{entry.id === latest?.id ? " · latest" : ""}</p>
          <p className="mt-2 font-semibold">{entry.question}</p><p className="mt-2 whitespace-pre-wrap break-words leading-6">{entry.decision || "Question saved; no decision recorded yet."}</p>
          <p className="mt-2 text-xs text-gray-500">{entry.evidenceIds.length} linked pieces · owner statement</p>
          <div className="mt-2 flex flex-wrap gap-x-4">{entry.evidenceIds.map((evidenceId, i) => <a key={evidenceId} href={`#evidence-${evidenceId}`} className="inline-flex min-h-11 items-center text-xs underline">Read evidence {i + 1} ↑</a>)}</div>
        </article>)}
      </section>}
    </>}
  </div>;
}
