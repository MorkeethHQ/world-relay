"use client";

import { useState, useEffect } from "react";
import type { CompanyAppealHistory } from "@/lib/company-appeal-shape";
import type { Task } from "@/lib/types";
import { rewardAmountLabel } from "@/lib/reward";
import type { Contribution } from "@/lib/completions";
import { getCampaign } from "@/lib/campaigns";

// History as a first-class page: proof the platform is alive. Platform totals
// live here now, NOT on the profile (Oscar Jul 5: profile felt like an admin
// dashboard; "history can have total paid out, total points, these things").
type Stats = {
  users?: { total?: number; verified?: number; reached?: number };
  volume?: { paidOutUsdc?: number; pointsDistributed?: number };
};

const PAGE = 12;

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ONE CARD for every result on this page, added 2026-09-21. Measured at 390 px
// before this: the page was 15,976 px tall, because one completed favour's
// description was a whole pasted markdown specification rendered in full, photo
// cards and text cards had different shapes, and the points badge sat on the image
// corner on one and in the right-hand column on the other. Now: the badge is always
// top-right of the header, text is clamped, and an image is always the same height.
// Nothing is removed from the store; this is display only.
function ResultCard({
  description,
  badge,
  imageUrl,
  note,
  meta,
  mine,
}: {
  description: string;
  badge: string;
  imageUrl: string | null;
  note?: string | null;
  meta: string;
  mine?: boolean;
}) {
  return (
    <div className={`rounded-2xl overflow-hidden bg-white border ${mine ? "border-gray-900" : "border-gray-200"}`}>
      <div className="p-4 pb-3 flex items-start gap-3">
        <p className="flex-1 min-w-0 text-[14px] font-medium leading-snug text-gray-900 line-clamp-3 break-words">{description}</p>
        <span className="shrink-0 text-[12px] font-bold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1">{badge}</span>
      </div>
      {imageUrl && (
        <img src={imageUrl} alt="Proof" className="w-full h-40 object-cover bg-gray-100" loading="lazy" />
      )}
      {note && (
        <p className="px-4 pt-3 text-[13px] leading-snug text-gray-600 line-clamp-3 break-words">{note}</p>
      )}
      <p className="px-4 pt-2 pb-4 text-[12px] text-gray-400 truncate">{meta}</p>
    </div>
  );
}

export default function HistoryPage() {
  const [responseCampaigns,setResponseCampaigns]=useState<Array<{id:string;company:string;role:string;pieces:number;waiting:number}>>([]);
  const [responseError,setResponseError]=useState('');
  useEffect(()=>{let live=true;fetch('/api/me/company-responses',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(d=>{if(live)setResponseCampaigns(d.campaigns||[]);}).catch(e=>{if(live)setResponseError(e.message);});return()=>{live=false;};},[]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  // The signed-in person's own results, from the session. Empty when signed out.
  // This is where "See your proof" on a done mission lands.
  const [reviews, setReviews] = useState<CompanyAppealHistory[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [mine, setMine] = useState<Contribution[]>([]);
  // The page shows a first screenful and grows on request. At 390 px the full
  // 60-result list measured 10,819 px even after clamping, which is a wall to scroll
  // rather than a record to read.
  const [shown, setShown] = useState(PAGE);
  const otherResults = mine.filter(c => !reviews.some(r => r.taskId === c.taskId && r.role === "contributor" && r.outcome === "cleared"));

  useEffect(() => {
    Promise.all([
      fetch("/api/me/company-reviews", { cache: "no-store" }).then(async r => {
        const d = await r.json(); if (!r.ok) throw new Error(d.error); setReviews(d.reviews || []);
      }).catch(e => setReviewError(e.message || "Review history unavailable")),
      fetch("/api/history").then((r) => r.json()).then((d) => setTasks(d.tasks || [])),
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {}),
      fetch("/api/me/contributions", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3">
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">History</h1>
        <p className="text-[11px] text-gray-400 mt-0.5">Your work and completed favours</p>
      </div>

      <div className="px-6 py-4 pb-28 flex flex-col gap-4">
        {/* Platform totals — the proof-of-life numbers */}
        <div className="bg-gray-950 rounded-2xl p-5 text-white flex items-center justify-between">
          <div>
            <p className="text-[22px] font-bold leading-none">${(stats.volume?.paidOutUsdc ?? 0).toFixed(0)}</p>
            <p className="text-[11px] text-white/50 mt-1">paid out</p>
          </div>
          <div>
            <p className="text-[22px] font-bold leading-none">{Math.round(stats.volume?.pointsDistributed ?? 0)}</p>
            <p className="text-[11px] text-white/50 mt-1">points · closed favours</p>
          </div>
          <div>
            <p className="text-[22px] font-bold leading-none">{stats.users?.reached ?? stats.users?.verified ?? 0}</p>
            <p className="text-[11px] text-white/50 mt-1">people reached</p>
          </div>
        </div>

        <p className="text-xs text-gray-500">Platform totals are cached. The points total covers closed favours only; contributions to ongoing campaigns appear below.</p>

        {reviewError && <p role="alert" className="text-sm text-red-700">{reviewError}</p>}
        {reviews.length > 0 && <section aria-label="Your company reviews" className="space-y-3">
          <h2 className="font-semibold">Company work</h2>
          {reviews.map(review => <article key={review.id} className="rounded-2xl border bg-white p-4 space-y-3">
            <p className="text-xs text-gray-500">{review.company} · {review.role === "company" ? "Your campaign" : "Your contribution"}</p>
            <h3 className="font-medium text-sm line-clamp-3">{review.description}</h3>
            <p className="font-semibold text-sm">{review.outcome === "pending" ? `Awaiting human review · ${review.votes.length}/3 judges · no reward yet` : review.outcome === "superseded" ? "Proof replaced or withdrawn · no points from this review" : review.outcome === "cleared" ? `Accepted by human jury · ${review.points} points` : "Not accepted by human jury · no points"}</p>
            <p className="text-sm whitespace-pre-wrap break-words">{review.note}</p>
            <details className="text-sm"><summary className="cursor-pointer">AI flag and review reasons</summary>
              <p className="pt-2 text-gray-500">AI: {review.aiReason}</p>
              <ol className="list-decimal pl-5 space-y-2 mt-2">{review.votes.map((vote, i) => <li key={i}>{vote.real ? "Accept" : "Decline"}: {vote.reason}</li>)}</ol>
            </details>
            {review.role === "company" && <a className="block text-sm underline" href={`/companies/${review.campaignId}/review`}>Review evidence and decide</a>}
          </article>)}
        </section>}

        {responseError && <p role="alert" className="text-sm text-red-700">{responseError}</p>}
        {!!responseCampaigns.length && <section className="space-y-3" aria-label="Your company responses"><h2 className="font-semibold">Your company responses</h2>{responseCampaigns.map(c=><a key={c.id} href={`/companies/${encodeURIComponent(c.id)}/${c.role==='company'?'review':'contributions'}`} className="block rounded-2xl border border-gray-200 bg-white p-4"><strong className="block text-sm">{c.company}</strong><span className="mt-2 block text-sm text-gray-600">{c.pieces} contributions · {c.waiting} awaiting a response →</span></a>)}</section>}
        {otherResults.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="Your results">
            <h2 className="text-[13px] font-semibold text-gray-900">Yours</h2>
            {otherResults.map((c) => (
              <div key={`${c.taskId}-${c.at}`}><ResultCard
                key={`${c.taskId}-${c.at}`}
                description={c.description}
                badge={`+${c.points} pts`}
                imageUrl={c.proofImageUrl}
                note={c.proofNote}
                // Step 6 of the company journey: the campaign a piece belongs to
                // shows with its reward, so a person can see what they did it for.
                meta={`${c.campaignLabel ? `${c.campaignLabel} · ` : c.campaignId && getCampaign(c.campaignId) ? `${getCampaign(c.campaignId)!.name} · ` : ""}Passed ${timeAgo(c.at)}${c.recovered ? " · from the completion log" : ""}`}
                mine
              />
              {c.campaignId?.startsWith("draft_") && <a href={`/companies/${encodeURIComponent(c.campaignId)}/contributions`} className="flex min-h-11 items-center px-4 text-sm underline">See the company response →</a>}
              </div>
            ))}

          </section>
        )}

        <h2 className="text-[13px] font-semibold text-gray-900">Fully completed favours across FAVOUR</h2>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">No fully completed favours yet. Accepted pieces from ongoing campaigns are shown separately above.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tasks.slice(0, shown).map((task) => (
              <ResultCard
                key={task.id}
                description={task.description}
                badge={rewardAmountLabel(task)}
                imageUrl={task.proofImageUrl}
                note={task.proofImageUrl ? null : task.proofNote}
                meta={`${task.location} · ${timeAgo(task.createdAt)}`}
              />
            ))}
            {shown < tasks.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="min-h-[44px] rounded-2xl border border-gray-200 bg-white text-[14px] font-semibold text-gray-900 active:scale-[0.99]"
              >
                Show more ({tasks.length - shown})
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
