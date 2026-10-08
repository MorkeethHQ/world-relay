"use client";

import { useState, useEffect } from "react";
import { PollsFeed } from "@/components/Polls";
import { PredictionsSection } from "@/components/Predictions";
import { Heading, Screen } from "@/components/Kit";

// Polls as a first-class bottom-nav page (Oscar Jul 5: one navigation, not
// two). The header is the kit's; the feed itself is untouched (8 Oct 2026).
export default function PollsPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(localStorage.getItem("relay_user_id"));
  }, []);

  return (
    <Screen label="Polls">
      <Heading size="display">Polls</Heading>
      <div className="mt-4 flex flex-col gap-4">
        {/* Open questions first. Closed polls and resolved predictions are
            history, each behind its own control (2026-10-05). */}
        <PollsFeed userId={userId} />
        <details className="rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-[13px] text-gray-500 min-h-[44px] flex items-center">Prediction archive and existing stakes</summary>
          <p className="mt-3 mb-4 text-[13px] text-gray-600">Predictions have closed. Past results and existing stakes stay available here.</p>
          <PredictionsSection userId={userId} />
        </details>
      </div>
    </Screen>
  );
}
