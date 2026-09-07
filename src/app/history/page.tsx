"use client";

import { useState, useEffect } from "react";
import type { Task } from "@/lib/types";
import { rewardAmountLabel } from "@/lib/reward";

// History as a first-class page: proof the platform is alive. Platform totals
// live here now, NOT on the profile (Oscar Jul 5: profile felt like an admin
// dashboard; "history can have total paid out, total points, these things").
type Stats = {
  users?: { total?: number; verified?: number; reached?: number };
  volume?: { paidOutUsdc?: number; pointsDistributed?: number };
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function HistoryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/history").then((r) => r.json()).then((d) => setTasks(d.tasks || [])),
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-3">
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">History</h1>
        <p className="text-[11px] text-gray-400 mt-0.5">Recently completed across FAVOUR</p>
      </div>

      <div className="px-6 py-4 pb-28 flex flex-col gap-4">
        {/* Platform totals: real measured numbers from /api/stats. Presentation
            only. When every total is still zero, a wall of three zeros says
            nothing true that a sentence cannot say better, so say the sentence.
            The numbers themselves are never rounded up or invented. */}
        {(stats.volume?.paidOutUsdc ?? 0) === 0 &&
        (stats.volume?.pointsDistributed ?? 0) === 0 &&
        (stats.users?.reached ?? stats.users?.verified ?? 0) === 0 ? (
          <div className="bg-gray-950 rounded-2xl p-5 text-white">
            <p className="text-[14px] font-semibold leading-snug">Nothing has been paid out yet</p>
            <p className="text-[12px] text-white/50 mt-1 leading-relaxed">
              Totals appear here once favours start completing. They are counted,
              never estimated.
            </p>
          </div>
        ) : (
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
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16 px-6">
            <p className="text-sm font-medium text-gray-600">No completed favours yet</p>
            <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed max-w-[34ch] mx-auto">
              This page lists favours after their proof has passed. The first one
              to pass shows up here, with the photo that proved it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-2xl overflow-hidden bg-white border border-gray-200">
                {task.proofImageUrl && (
                  <div className="relative">
                    <img src={task.proofImageUrl} alt="Proof" className="w-full h-40 object-cover" loading="lazy" />
                    <div className="absolute bottom-2 left-2">
                      <span className="text-[11px] font-bold text-white bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1">{rewardAmountLabel(task)}</span>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-[14px] font-medium leading-snug break-words text-gray-900">{task.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-400 truncate max-w-[140px]">{task.location}</span>
                    <span className="text-xs text-gray-300">&middot;</span>
                    <span className="text-xs text-gray-400">{timeAgo(task.createdAt)}</span>
                    {!task.proofImageUrl && <span className="text-xs text-success-600 font-medium ml-auto">{rewardAmountLabel(task)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
