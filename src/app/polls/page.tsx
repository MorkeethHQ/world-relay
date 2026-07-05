"use client";

import { useState, useEffect } from "react";
import { PollsFeed } from "@/components/Polls";

// Polls as a first-class bottom-nav page (Oscar Jul 5: one navigation, not
// two). The Feed keeps its inline poll cards; this is the full surface.
export default function PollsPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(localStorage.getItem("relay_user_id"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-3">
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">Polls</h1>
      </div>
      <div className="px-6 py-4 pb-28">
        <PollsFeed userId={userId} />
      </div>
    </div>
  );
}
