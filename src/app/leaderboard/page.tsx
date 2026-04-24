"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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

const TIER_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  orb: { color: "text-cyan-400", label: "Orb", icon: "◉" },
  device: { color: "text-blue-400", label: "Device", icon: "✓" },
  wallet: { color: "text-green-400", label: "Wallet", icon: "✓" },
};

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reputation")
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.leaderboard || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalEarned = entries.reduce((sum, e) => sum + e.totalEarnedUsdc, 0);
  const totalCompleted = entries.reduce((sum, e) => sum + e.tasksCompleted, 0);

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </Link>
          <h1 className="text-sm font-bold tracking-tight">Leaderboard</h1>
          <div className="w-12" />
        </div>
      </div>

      {/* Stats banner */}
      <div className="px-4 py-4">
        <div className="bg-gradient-to-r from-green-500/8 to-blue-500/8 border border-white/[0.06] rounded-2xl p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{entries.length}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Runners</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-400">{totalCompleted}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Tasks Done</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-400">${totalEarned.toFixed(0)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">USDC Earned</p>
            </div>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex flex-col gap-3">
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
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">No runners yet</p>
            <p className="text-xs text-gray-700 mt-1">Complete tasks to appear here</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {entries.map((entry, i) => {
              const tier = TIER_CONFIG[entry.verificationLevel] || TIER_CONFIG.wallet;
              const isTop3 = i < 3;
              const rankColors = ["text-yellow-400", "text-gray-300", "text-amber-600"];

              return (
                <div
                  key={entry.address}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`animate-[slideUp_0.3s_ease-out_both] rounded-2xl p-4 border transition-all ${
                    isTop3
                      ? "bg-gradient-to-r from-white/[0.03] to-white/[0.06] border-white/[0.08]"
                      : "bg-[#111] border-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Rank */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      isTop3 ? "bg-white/5" : "bg-white/[0.02]"
                    }`}>
                      <span className={`text-lg font-bold ${isTop3 ? rankColors[i] : "text-gray-600"}`}>
                        {i + 1}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{shortAddress(entry.address)}</span>
                        <span className={`text-[9px] font-semibold flex items-center gap-0.5 ${tier.color}`}>
                          {tier.icon} {tier.label}
                        </span>
                        {entry.currentStreak >= 3 && (
                          <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                            </svg>
                            {entry.currentStreak}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px] text-gray-500">
                          {entry.tasksCompleted} completed
                        </span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[11px] text-gray-500">
                          {Math.round(entry.successRate * 100)}% success
                        </span>
                        {entry.lastActiveAt && (
                          <>
                            <span className="text-[10px] text-gray-700">·</span>
                            <span className="text-[11px] text-gray-600">{timeAgo(entry.lastActiveAt)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Score + Earnings */}
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 justify-end">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <span className="text-sm font-bold text-green-400">{entry.trustScore.toFixed(1)}</span>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-0.5">${entry.totalEarnedUsdc.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Confidence bar */}
                  <div className="mt-3 pt-3 border-t border-white/[0.04]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-gray-600">Avg AI confidence</span>
                      <span className="text-[10px] text-gray-500 font-medium">{Math.round(entry.avgConfidence * 100)}%</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round(entry.avgConfidence * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
