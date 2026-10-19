"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectCard as Card } from "@/lib/projects-view";
import { DESIGN_MAX, EMPTY_FEEDBACK, FEEL, FIX_MAX, LINE_MAX, WORKED, feedbackNote, feedbackReason, words, type FeedbackAnswers } from "@/lib/feedback-form";
import { sendWithReauth } from "@/lib/reauth";
import { SignInSheet } from "@/components/fv/SignInSheet";

// GIVE FEEDBACK (FAVOUR revamp, 19 Oct 2026). Six answers, mostly taps: did it
// work, how does it feel, design 1 to 5, who it is for, what confused you first,
// one thing to fix. The answers become one proof note for the existing
// /api/verify-proof route, which checks it and pays the points it already pays.
// No money moves here.

export type FeedbackResult = { verdict: string; reasoning: string; pointsAwarded: number | null };

export function FeedbackScreen({ p, a, onChange, onSend, busy, error, result, signedIn }: {
  p: Card; a: FeedbackAnswers; onChange: (patch: Partial<FeedbackAnswers>) => void; onSend: () => void;
  busy: boolean; error: string | null; result: FeedbackResult | null; signedIn: boolean;
}) {
  const reason = feedbackReason(a);
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 py-3 flex items-center gap-3">
        <Link href={`/project/${encodeURIComponent(p.id)}`} aria-label="Back" className="min-h-[44px] min-w-[44px] -ml-3 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <p className="fv-h flex-1 min-w-0 truncate">Feedback · {p.name}</p>
        <p className="fv-h fv-num shrink-0 fv-blue">{p.points} pts</p>
      </header>

      <div className="px-6 py-5 pb-28 flex flex-col gap-6">
        {result ? (
          <div className="fv-box p-5 flex flex-col gap-3">
            <p className="fv-label">{result.verdict === "pass" ? "Accepted" : result.verdict === "flag" ? "Under review" : "Not accepted"}</p>
            <p className="fv-title fv-num">{result.verdict === "pass" ? `+${result.pointsAwarded ?? p.points} points` : result.verdict === "flag" ? "A human will look" : "No points"}</p>
            <p className="fv-body break-words">{result.reasoning}</p>
            <Link href="/" className="fv-btn fv-btn-ink">Back to projects</Link>
          </div>
        ) : (
          <>
            <p className="fv-body">Open <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{p.host || p.url}</a>, do one real thing, then answer. Honest only. The builder reads every line.</p>

            <fieldset className="flex flex-col gap-2">
              <legend className="fv-h mb-2">Did it work?</legend>
              <div className="flex gap-2">{WORKED.map((w) => <button key={w} type="button" className="fv-chip flex-1" aria-pressed={a.worked === w} onClick={() => onChange({ worked: w })}>{w}</button>)}</div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="fv-h mb-2">How does it feel?</legend>
              <div className="flex gap-2">{FEEL.map((f) => <button key={f} type="button" className="fv-chip flex-1" aria-pressed={a.feel === f} onClick={() => onChange({ feel: f })}>{f}</button>)}</div>
              <p className="fv-body text-[12px]">Slop means it looks generated and nobody decided anything.</p>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="fv-h mb-2">Design, 1 to {DESIGN_MAX}</legend>
              <div className="flex gap-2">{Array.from({ length: DESIGN_MAX }, (_, i) => i + 1).map((n) => <button key={n} type="button" className="fv-chip flex-1 fv-num" aria-pressed={a.design === n} aria-label={`Design ${n} of ${DESIGN_MAX}`} onClick={() => onChange({ design: n })}>{n}</button>)}</div>
            </fieldset>

            <label className="flex flex-col gap-2">
              <span className="fv-h">Who is this for?</span>
              <input type="text" className="fv-field" maxLength={LINE_MAX} value={a.forWhom} placeholder="One line. Who would use it, in your words." onChange={(e) => onChange({ forWhom: e.target.value })} />
            </label>

            <label className="flex flex-col gap-2">
              <span className="fv-h">What confused you first?</span>
              <input type="text" className="fv-field" maxLength={LINE_MAX} value={a.confusing} placeholder="The first thing you did not get." onChange={(e) => onChange({ confusing: e.target.value })} />
            </label>

            <label className="flex flex-col gap-2">
              <span className="fv-h">One thing to fix</span>
              <textarea rows={4} className="fv-field" maxLength={FIX_MAX} value={a.fix} placeholder="The one change you would make first, and why." onChange={(e) => onChange({ fix: e.target.value })} />
              <span className="fv-body text-[12px] fv-num">{words(a.fix)} words</span>
            </label>

            {reason && <p className="fv-body">{reason}</p>}
            {error && <p role="alert" className="fv-body">{error}</p>}
            <button type="button" className="fv-btn fv-btn-ink" disabled={busy || !!reason} onClick={onSend}>
              {busy ? "Checking…" : signedIn ? `Send feedback for ${p.points} points` : "Sign in and send"}
            </button>
            <p className="fv-body text-[12px]">An AI check reads it against the ask. Points are paid by FAVOUR, not by the builder.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function FeedbackForm({ id, taskId, userId, isInWorldApp, isVerifying, authError, onVerify }: {
  id: string; taskId: string | null; userId: string | null; isInWorldApp: boolean; isVerifying: boolean; authError: string | null; onVerify: () => void;
}) {
  const router = useRouter();
  const [p, setP] = useState<Card | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [a, setA] = useState<FeedbackAnswers>(EMPTY_FEEDBACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok || !b?.project) throw new Error("This project is not on FAVOUR."); setP(b.project); })
      .catch((e: Error) => setLoadError(e.message));
  }, [id]);

  const send = async () => {
    if (!p || !taskId || !userId) return;
    setBusy(true); setError(null);
    try {
      const res = await sendWithReauth(() => fetch("/api/verify-proof", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, submitter: userId, proofImages: [], proofImageBase64: null, proofNote: feedbackNote(a, p.name) }),
      }), userId);
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.verdict) { setError(typeof b?.error === "string" ? b.error : "Your feedback was not sent. Try again."); }
      else { setResult({ verdict: b.verdict, reasoning: b.reasoning ?? "", pointsAwarded: b.pointsAwarded ?? null }); router.refresh(); }
    } catch { setError("Your feedback was not sent. Try again."); }
    setBusy(false);
  };

  useEffect(() => { if (userId && sheet) { setSheet(false); } }, [userId, sheet]);

  if (loadError) return <div className="fv min-h-screen max-w-lg mx-auto px-6 py-8 flex flex-col gap-4"><p className="fv-body" role="alert">{loadError}</p><Link href="/" className="fv-btn">Back to projects</Link></div>;
  if (!p) return <div className="fv min-h-screen max-w-lg mx-auto px-6 py-8"><p className="fv-body">Reading the project…</p></div>;
  if (!taskId) return <div className="fv min-h-screen max-w-lg mx-auto px-6 py-8 flex flex-col gap-4"><p className="fv-body">This favour is not open.</p><Link href={`/project/${encodeURIComponent(p.id)}`} className="fv-btn">Back to the project</Link></div>;
  return (
    <>
      <FeedbackScreen p={p} a={a} onChange={(patch) => setA((cur) => ({ ...cur, ...patch }))} onSend={() => (userId ? send() : setSheet(true))} busy={busy} error={error} result={result} signedIn={!!userId} />
      {sheet && !userId && (
        <div className="fv"><SignInSheet why="Sign in to send feedback." isInWorldApp={isInWorldApp} busy={isVerifying} error={authError} onSignIn={onVerify} onClose={() => setSheet(false)} /></div>
      )}
    </>
  );
}
