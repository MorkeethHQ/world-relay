"use client";

import { useEffect, useState } from "react";

type Completion = {
  taskId: string;
  claimant: string;
  proofImageUrl: string | null;
  proofNote: string | null;
  reasoning: string;
  confidence: number;
  verifiedAt: string;
  cycle: number;
};

export function RequesterCampaignStatus({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<{ verifiedCompletions: number; completions: Completion[] } | null>(null);

  useEffect(() => {
    fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/status`)
      .then((response) => response.ok ? response.json() : null)
      .then(setData)
      .catch(() => setData(null));
  }, [campaignId]);

  if (!data) return null;
  return (
    <section className="rounded-2xl border-2 border-gray-900 bg-white px-4 py-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Requester results</p>
      <p className="mt-1 text-[20px] font-bold text-gray-950">{data.verifiedCompletions} accepted</p>
      {data.completions.length === 0 ? (
        <p className="mt-2 text-[13px] text-gray-500">No accepted work yet. This panel appears only to the signed-in requester.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {data.completions.map((completion, index) => (
            <article key={`${completion.taskId}-${completion.claimant}-${index}`} className="rounded-xl bg-gray-50 p-3">
              <div className="flex justify-between gap-3 text-[11px] text-gray-400">
                <span>Cycle {completion.cycle} · {completion.claimant.slice(0, 6)}…{completion.claimant.slice(-4)}</span>
                <span>{Math.round(completion.confidence * 100)}%</span>
              </div>
              {completion.proofImageUrl && <img src={completion.proofImageUrl} alt="Accepted proof" className="mt-2 aspect-video w-full rounded-lg object-cover" />}
              {completion.proofNote && <p className="mt-2 text-[13px] leading-relaxed text-gray-800">{completion.proofNote}</p>}
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{completion.reasoning}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
