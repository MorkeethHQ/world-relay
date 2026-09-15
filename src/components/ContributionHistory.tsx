"use client";

import { useEffect, useState } from "react";
import type { ContributionConsequence } from "@/lib/contribution-consequence";

export function ContributionHistory({ address }: { address: string }) {
  const [items, setItems] = useState<ContributionConsequence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contributions?address=${encodeURIComponent(address)}`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((body) => {
        if (!cancelled) setItems(body.contributions || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <section aria-labelledby="your-contributions">
      <h2 id="your-contributions" className="mb-3 px-1 text-[15px] font-semibold text-gray-900">
        Because you helped
      </h2>
      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-400">
          Loading your contributions…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-400">
          Complete a favour and its evidence, verdict, and credit will appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 10).map((item) => (
            <article key={`${item.taskId}-${item.at}`} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-[13px] font-semibold leading-snug text-gray-900">{item.description}</p>
              <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
                Evidence — {item.evidence.note ? `“${item.evidence.note}”` : item.evidence.hasImage ? "photo submitted" : "submitted"}
              </p>
              <p className={`mt-2 text-xs font-semibold ${
                item.verdict === "pass" ? "text-green-600" : item.verdict === "flag" ? "text-yellow-600" : "text-red-600"
              }`}>
                {item.verdict === "pass" ? "Verified" : item.verdict === "flag" ? "Pending review" : "Rejected"}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">{item.reasoning}</p>
              <p className={`mt-2 text-xs font-bold ${item.creditPts > 0 ? "text-amber-600" : "text-gray-500"}`}>
                {item.creditPts > 0 ? `+${item.creditPts} pts credited` : item.creditKind === "pending" ? "Credit pending" : "No credit"}
              </p>
              {item.nextAction?.label && (
                <p className="mt-2 text-xs text-gray-600">
                  Next — {item.nextAction.label}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
