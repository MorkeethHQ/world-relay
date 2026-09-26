"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";
import { rewardAmountLabel } from "@/lib/reward";
import type { Contribution } from "@/lib/completions";
import { getCampaign } from "@/lib/campaigns";
import { PAYOUT_STATUS_LABEL, PAYOUT_REASON_LABEL, type PiecePayout } from "@/lib/campaign-payouts-shape";

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  // The signed-in person's own results, from the session. Empty when signed out.
  // This is where "See your proof" on a done mission lands.
  const [mine, setMine] = useState<Contribution[]>([]);
  // The person's piece payments (2026-09-27): pending, paid or failed, with the
  // reason. Session only, like contributions.
  const [payouts, setPayouts] = useState<PiecePayout[]>([]);
  // The page shows a first screenful and grows on request. At 390 px the full
  // 60-result list measured 10,819 px even after clamping, which is a wall to scroll
  // rather than a record to read.
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    Promise.all([
      fetch("/api/history").then((r) => r.json()).then((d) => setTasks(d.tasks || [])),
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {}),
      fetch("/api/me/contributions", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : []))
        .catch(() => {}),
      fetch("/api/me/payouts", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPayouts(Array.isArray(d?.payouts) ? d.payouts : []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3">
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">History</h1>
        <p className="text-[11px] text-gray-400 mt-0.5">Recently completed across FAVOUR</p>
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
            <p className="text-[11px] text-white/50 mt-1">points earned</p>
          </div>
          <div>
            <p className="text-[22px] font-bold leading-none">{stats.users?.reached ?? stats.users?.verified ?? 0}</p>
            <p className="text-[11px] text-white/50 mt-1">people reached</p>
          </div>
        </div>

        {payouts.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="Your payments">
            <h2 className="text-[13px] font-semibold text-gray-900">Your payments</h2>
            {payouts.map((p) => (
              <div key={p.id} className="rounded-2xl bg-white border border-gray-200 px-4 py-3" data-payout-status={p.status}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[13px] font-bold ${p.status === "paid" ? "text-success-700" : p.status === "failed" ? "text-error-700" : "text-gray-900"}`}>{PAYOUT_STATUS_LABEL[p.status]}</span>
                  <span className="text-[13px] font-semibold text-gray-900">{p.amountUsdc} USDC</span>
                </div>
                <p className="text-[12px] text-gray-500 mt-1 break-words">
                  {p.reason ? PAYOUT_REASON_LABEL[p.reason] : p.paidTxHash ? `Tx ${p.paidTxHash.slice(0, 10)}…${p.paidTxHash.slice(-6)}` : ""}
                  {` · Accepted ${timeAgo(p.acceptedAt)}`}{p.test ? " · test record" : ""}
                </p>
              </div>
            ))}
          </section>
        )}

        {mine.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="Your results">
            <h2 className="text-[13px] font-semibold text-gray-900">Yours</h2>
            {mine.map((c) => (
              <ResultCard
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
            ))}
            <h2 className="text-[13px] font-semibold text-gray-900 mt-3">Across FAVOUR</h2>
          </section>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">No completed favours yet.</p>
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
