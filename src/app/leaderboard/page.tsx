"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { VerificationBadge } from "@/components/VerificationBadge";

type LeaderboardEntry = {
  address: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalEarnedUsdc: number;
  avgConfidence: number;
  verificationLevel: string;
  lastActiveAt: string;
  successRate: number;
  trustScore: number;
  multipliedTrustScore: number;
  multiplierLabel: string | null;
  multiplier: number;
  currentStreak: number;
  longestStreak: number;
};

function shortAddress(addr: string): string {
  if (addr.startsWith("0x")) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  return addr.slice(0, 12);
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const MEDAL = ["gold", "silver", "bronze"] as const;

const MEDAL_STYLES = {
  gold: {
    emoji: "\u{1F947}",
    ring: "ring-yellow-400/40",
    bg: "bg-gradient-to-br from-yellow-500/10 to-amber-500/5",
    border: "border-yellow-500/20",
    text: "text-yellow-400",
    glow: "shadow-[0_0_24px_rgba(250,204,21,0.08)]",
  },
  silver: {
    emoji: "\u{1F948}",
    ring: "ring-gray-300/30",
    bg: "bg-gradient-to-br from-gray-300/8 to-gray-400/4",
    border: "border-gray-400/15",
    text: "text-gray-300",
    glow: "shadow-[0_0_16px_rgba(209,213,219,0.05)]",
  },
  bronze: {
    emoji: "\u{1F949}",
    ring: "ring-amber-600/30",
    bg: "bg-gradient-to-br from-amber-700/10 to-orange-600/5",
    border: "border-amber-600/15",
    text: "text-amber-500",
    glow: "shadow-[0_0_16px_rgba(217,119,6,0.06)]",
  },
};

function TrustBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100);
  const color =
    pct >= 80
      ? "from-green-500 to-emerald-400"
      : pct >= 50
        ? "from-blue-500 to-cyan-400"
        : "from-orange-500 to-amber-400";
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden w-full">
      <div
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reputation?leaderboard=true")
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.leaderboard || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalRunners = entries.length;
  const totalEarned = entries.reduce((sum, e) => sum + e.totalEarnedUsdc, 0);
  const totalCompleted = entries.reduce((sum, e) => sum + e.tasksCompleted, 0);
  const avgTrust =
    entries.length > 0
      ? entries.reduce(
          (sum, e) =>
            sum + Math.round((e.multipliedTrustScore ?? e.trustScore) * 100),
          0,
        ) / entries.length
      : 0;

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </Link>
          <h1 className="text-sm font-bold tracking-tight">Leaderboard</h1>
          <div className="w-12" />
        </div>
      </div>

      {/* Live stats header */}
      <div className="px-4 pt-4 pb-2">
        <div className="bg-gradient-to-r from-green-500/8 to-blue-500/8 border border-white/[0.06] rounded-2xl p-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="animate-[fadeIn_0.4s_ease-out_both]">
              <p className="text-xl font-bold text-white tabular-nums">
                {totalRunners}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Runners</p>
            </div>
            <div
              className="animate-[fadeIn_0.4s_ease-out_both]"
              style={{ animationDelay: "80ms" }}
            >
              <p className="text-xl font-bold text-green-400 tabular-nums">
                {totalCompleted}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Tasks Done</p>
            </div>
            <div
              className="animate-[fadeIn_0.4s_ease-out_both]"
              style={{ animationDelay: "160ms" }}
            >
              <p className="text-xl font-bold text-blue-400 tabular-nums">
                ${totalEarned.toFixed(0)}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">USDC Earned</p>
            </div>
            <div
              className="animate-[fadeIn_0.4s_ease-out_both]"
              style={{ animationDelay: "240ms" }}
            >
              <p className="text-xl font-bold text-purple-400 tabular-nums animate-[pulse-dot_2s_ease-in-out_infinite]">
                {Math.round(avgTrust)}
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">Avg Trust</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex flex-col gap-3 mt-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-2xl p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5" />
                  <div className="flex-1">
                    <div className="h-3 bg-white/5 rounded w-24 mb-2" />
                    <div className="h-2 bg-white/5 rounded w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20 animate-[fadeIn_0.5s_ease-out]">
            <div className="w-16 h-16 rounded-full bg-gray-900/80 flex items-center justify-center mx-auto mb-4">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#444"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 font-medium">
              No runners on the board yet
            </p>
            <p className="text-xs text-gray-600 mt-1.5 max-w-[240px] mx-auto leading-relaxed">
              Complete a task to join the leaderboard and start earning trust
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 mt-5 px-5 py-2.5 rounded-xl text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 active:scale-[0.97] transition-all"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 16 16 12 12 8" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              Browse the feed
            </Link>
          </div>
        ) : (
          <>
            {/* Top 3 Podium */}
            {top3.length > 0 && (
              <div className="mt-4 mb-6">
                <div className="flex flex-col gap-3">
                  {top3.map((entry, i) => {
                    const medal = MEDAL_STYLES[MEDAL[i]];
                    const score = Math.round(
                      (entry.multipliedTrustScore ?? entry.trustScore) * 100,
                    );

                    return (
                      <div
                        key={entry.address}
                        style={{ animationDelay: `${i * 100}ms` }}
                        className={`animate-[slideUp_0.4s_ease-out_both] rounded-2xl p-4 border ring-1 ${medal.bg} ${medal.border} ${medal.ring} ${medal.glow} transition-all`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Medal + Rank */}
                          <div className="flex flex-col items-center shrink-0">
                            <span className="text-2xl leading-none">
                              {medal.emoji}
                            </span>
                            <span
                              className={`text-[10px] font-bold mt-1 ${medal.text}`}
                            >
                              #{i + 1}
                            </span>
                          </div>

                          {/* Main info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold">
                                {shortAddress(entry.address)}
                              </span>
                              <VerificationBadge
                                level={entry.verificationLevel}
                                size="sm"
                              />
                              {entry.currentStreak > 0 && (
                                <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                                  <svg
                                    width="8"
                                    height="8"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                  </svg>
                                  {entry.currentStreak}
                                </span>
                              )}
                            </div>

                            {/* Trust score - prominent */}
                            <div className="flex items-center gap-2 mt-2">
                              <div className="flex items-center gap-1">
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#4ade80"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                </svg>
                                <span className="text-lg font-bold text-green-400 tabular-nums animate-[pulse-dot_3s_ease-in-out_infinite]">
                                  {score}
                                </span>
                              </div>
                              {entry.multiplierLabel && (
                                <span
                                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                                    entry.verificationLevel === "orb"
                                      ? "text-[#22c55e] bg-green-500/10"
                                      : "text-blue-400 bg-blue-500/10"
                                  }`}
                                >
                                  {entry.multiplierLabel}
                                </span>
                              )}
                            </div>

                            {/* Trust bar */}
                            <div className="mt-2">
                              <TrustBar score={score} />
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-[10px] text-gray-500">
                                {entry.tasksCompleted} completed
                              </span>
                              <span className="text-[10px] text-gray-700">
                                ·
                              </span>
                              <span className="text-[10px] text-gray-500">
                                {Math.round(entry.successRate * 100)}% success
                              </span>
                              <span className="text-[10px] text-gray-700">
                                ·
                              </span>
                              <span className="text-[10px] text-green-500/80 font-medium">
                                ${entry.totalEarnedUsdc.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Remaining runners */}
            {rest.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium px-1 mb-1">
                  All Runners
                </p>
                {rest.map((entry, i) => {
                  const rank = i + 4;
                  const score = Math.round(
                    (entry.multipliedTrustScore ?? entry.trustScore) * 100,
                  );

                  return (
                    <div
                      key={entry.address}
                      style={{ animationDelay: `${(i + 3) * 60}ms` }}
                      className="animate-[slideUp_0.3s_ease-out_both] bg-[#111] rounded-2xl p-3.5 border border-white/[0.06] hover:border-white/[0.1] transition-all"
                    >
                      <div className="flex items-center gap-3">
                        {/* Rank */}
                        <div className="w-8 h-8 rounded-full bg-white/[0.03] flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-gray-600 tabular-nums">
                            {rank}
                          </span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold">
                              {shortAddress(entry.address)}
                            </span>
                            <VerificationBadge
                              level={entry.verificationLevel}
                              size="sm"
                            />
                            {entry.currentStreak > 0 && (
                              <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1 py-0.5 flex items-center gap-0.5">
                                <svg
                                  width="7"
                                  height="7"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                </svg>
                                {entry.currentStreak}
                              </span>
                            )}
                          </div>

                          {/* Trust bar inline */}
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1">
                              <TrustBar score={score} />
                            </div>
                            <span className="text-[10px] text-gray-500 tabular-nums shrink-0">
                              {score}
                            </span>
                          </div>
                        </div>

                        {/* Right: completion + earnings */}
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-gray-300 tabular-nums">
                            {entry.tasksCompleted}{" "}
                            <span className="text-gray-600 font-normal">
                              done
                            </span>
                          </p>
                          <p className="text-[10px] text-green-500/70 font-medium mt-0.5 tabular-nums">
                            ${entry.totalEarnedUsdc.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
