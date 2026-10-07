"use client";

import { useState, useEffect } from "react";
import { PollsFeed } from "@/components/Polls";
import { PredictionsSection } from "@/components/Predictions";

// Polls as a first-class bottom-nav page (Oscar Jul 5: one navigation, not
// two). The Feed keeps its inline poll cards; this is the full surface.
export default function PollsPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(localStorage.getItem("relay_user_id"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3">
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">Polls</h1>
      </div>
      <div className="px-6 py-4 pb-28 flex flex-col gap-4">
        {/* Open questions first. Closed polls and resolved predictions are
            history, each behind its own control (2026-10-05). */}
        <PollsFeed userId={userId} />
        <details className="rounded-2xl border border-gray-200 p-4">
          <summary className="cursor-pointer text-[13px] text-gray-500">Prediction archive & existing stakes</summary>
          <p className="mt-3 mb-4 text-[13px] text-gray-600">Predictions have closed. Past results and existing stakes stay available here.</p>
          <PredictionsSection userId={userId} />
        </details>
      </div>
    </div>
  );
}
