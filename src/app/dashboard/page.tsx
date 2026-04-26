"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0";

type AgentStats = {
  id: string;
  name: string;
  icon: string;
  color: string;
  totalPosted: number;
  completed: number;
  claimed: number;
  open: number;
  totalBounty: number;
  avgConfidence: number;
  completionRate: number;
  verificationPassRate: number;
};

function computeAgentStats(tasks: Task[]): AgentStats[] {
  const map = new Map<string, { tasks: Task[]; info: { id: string; name: string; icon: string; color: string } }>();

  for (const t of tasks) {
    if (!t.agent) continue;
    const existing = map.get(t.agent.id);
    if (existing) {
      existing.tasks.push(t);
    } else {
      map.set(t.agent.id, { tasks: [t], info: t.agent });
    }
  }

  return Array.from(map.values())
    .map(({ tasks: agentTasks, info }) => {
      const completed = agentTasks.filter(t => t.status === "completed");
      const passed = completed.filter(t => t.verificationResult?.verdict === "pass");
      const confidences = completed
        .map(t => t.verificationResult?.confidence || 0)
        .filter(c => c > 0);

      return {
        ...info,
        totalPosted: agentTasks.length,
        completed: completed.length,
        claimed: agentTasks.filter(t => t.status === "claimed").length,
        open: agentTasks.filter(t => t.status === "open").length,
        totalBounty: agentTasks.reduce((s, t) => s + t.bountyUsdc, 0),
        avgConfidence: confidences.length > 0
          ? confidences.reduce((s, c) => s + c, 0) / confidences.length
          : 0,
        completionRate: agentTasks.length > 0 ? completed.length / agentTasks.length : 0,
        verificationPassRate: completed.length > 0 ? passed.length / completed.length : 0,
      };
    })
    .sort((a, b) => b.totalPosted - a.totalPosted);
}

function extractCity(location: string): string {
  const parts = location.split(",").map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || location;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-sm">&#x1F947;</span>;
  if (rank === 2) return <span className="text-sm">&#x1F948;</span>;
  if (rank === 3) return <span className="text-sm">&#x1F949;</span>;
  return (
    <span className="text-[10px] font-bold text-gray-600">#{rank}</span>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightTime, setInsightTime] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const fetchInsight = (refresh = false) => {
    setInsightLoading(true);
    fetch(`/api/ai-insights${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((data) => {
        setInsight(data.insight || null);
        setInsightTime(data.generatedAt || null);
        setInsightLoading(false);
      })
      .catch(() => setInsightLoading(false));
  };

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    fetchInsight();
  }, []);

  const agentStats = computeAgentStats(tasks);

  const totalTasks = tasks.length;
  const openTasks = tasks.filter(t => t.status === "open").length;
  const completedTasks = tasks.filter(t => t.status === "completed").length;
  const totalBounty = tasks.reduce((s, t) => s + t.bountyUsdc, 0);
  const settledUsdc = tasks
    .filter(t => t.status === "completed")
    .reduce((s, t) => s + t.bountyUsdc, 0);
  const uniqueRunners = new Set(tasks.filter(t => t.claimant).map(t => t.claimant)).size;
  const cities = new Set(tasks.map(t => extractCity(t.location)));
  const cityCount = cities.size;
  const onChainCount = tasks.filter(t => t.onChainId !== null && t.onChainId !== undefined).length;

  const claimantVerificationMap = new Map<string, string>();
  for (const t of tasks) {
    if (t.claimant && !claimantVerificationMap.has(t.claimant)) {
      claimantVerificationMap.set(t.claimant, t.claimantVerification || "wallet");
    }
  }
  const orbCount = Array.from(claimantVerificationMap.values()).filter(v => v === "orb").length;
  const deviceCount = Array.from(claimantVerificationMap.values()).filter(v => v === "device").length;
  const walletCount = Array.from(claimantVerificationMap.values()).filter(v => v !== "orb" && v !== "device").length;
  const totalVerified = orbCount + deviceCount + walletCount;

  const cityBreakdown = (() => {
    const cityMap = new Map<string, { total: number; completed: number; bounty: number }>();
    for (const t of tasks) {
      const city = extractCity(t.location);
      const normalized = ["paris", "new york", "nyc", "manhattan", "brooklyn"].includes(city.toLowerCase())
        ? city.toLowerCase().includes("nyc") || city.toLowerCase().includes("new york") || city.toLowerCase().includes("manhattan") || city.toLowerCase().includes("brooklyn")
          ? "NYC"
          : "Paris"
        : city.toLowerCase().includes("seoul") || city.toLowerCase().includes("gangnam") || city.toLowerCase().includes("hongdae")
          ? "Seoul"
          : city;
      const existing = cityMap.get(normalized) || { total: 0, completed: 0, bounty: 0 };
      existing.total += 1;
      if (t.status === "completed") existing.completed += 1;
      existing.bounty += t.bountyUsdc;
      cityMap.set(normalized, existing);
    }
    return Array.from(cityMap.entries())
      .map(([city, data]) => ({ city, ...data, completionRate: data.total > 0 ? data.completed / data.total : 0 }))
      .sort((a, b) => b.total - a.total);
  })();

  const totalPostedUsdc = totalBounty;
  const totalPaidUsdc = settledUsdc;
  const avgBounty = totalTasks > 0 ? totalBounty / totalTasks : 0;
  const completedTasksList = tasks.filter(t => t.status === "completed");
  const avgTimeToCompletion = (() => {
    const timeDiffs = completedTasksList
      .filter(t => t.createdAt)
      .map(t => {
        const created = new Date(t.createdAt).getTime();
        const completed = (t as Record<string, unknown>).completedAt
          ? new Date((t as Record<string, unknown>).completedAt as string).getTime()
          : new Date(t.deadline).getTime() - 3600_000;
        return Math.max(0, completed - created);
      });
    if (timeDiffs.length === 0) return 0;
    return timeDiffs.reduce((s, d) => s + d, 0) / timeDiffs.length;
  })();

  function formatDuration(ms: number): string {
    if (ms === 0) return "N/A";
    const hours = Math.floor(ms / 3600_000);
    const mins = Math.floor((ms % 3600_000) / 60_000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  const escrowLocked = tasks
    .filter(t => t.status === "claimed")
    .reduce((s, t) => s + t.bountyUsdc, 0);

  const leaderboard = [...agentStats].sort((a, b) => {
    if (b.totalPosted !== a.totalPosted) return b.totalPosted - a.totalPosted;
    if (b.verificationPassRate !== a.verificationPassRate) return b.verificationPassRate - a.verificationPassRate;
    return b.totalBounty - a.totalBounty;
  });

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* TopBar */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="text-sm font-bold">Network Stats</span>
          <div className="w-8" />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading network data...</p>
        </div>
      ) : (
        <>
          {/* Live Network Stats */}
          <div className="px-4 pt-4 pb-2">
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.06]">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-emerald-500/8" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.08),transparent_50%)]" />

              <div className="relative p-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
                  <span className="text-gray-400 text-[10px] uppercase tracking-wider">Live Network</span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 sm:gap-3 text-center">
                  <StatBlock value={totalTasks} label="Total Tasks" />
                  <StatBlock value={openTasks} label="Open" color="text-blue-400" />
                  <StatBlock value={completedTasks} label="Completed" color="text-green-400" />
                  <StatBlock value={uniqueRunners} label="Runners" color="text-purple-400" />
                </div>

                <div className="mt-3 pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center">
                  <div>
                    <span className="text-green-400 font-bold">${totalBounty.toFixed(0)}</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">Available</p>
                  </div>
                  <div>
                    <span className="text-emerald-400 font-bold">${settledUsdc.toFixed(0)}</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">Paid Out</p>
                  </div>
                  <div>
                    <span className="text-orange-400 font-bold">{cityCount}</span>
                    <p className="text-[9px] text-gray-600 mt-0.5">{cityCount === 1 ? "City" : "Cities"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Network Insight */}
          <div className="px-4 pb-2">
            <div className="relative overflow-hidden rounded-2xl p-[1px] bg-gradient-to-r from-purple-500/30 via-blue-500/30 to-purple-500/30">
              <div className="relative bg-[#0a0a0a] rounded-[15px] p-4">
                <div className="absolute top-0 left-0 w-40 h-40 bg-purple-500/5 rounded-full blur-3xl -ml-20 -mt-20" />
                <div className="absolute bottom-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-16 -mb-16" />

                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-purple-400">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor" opacity="0.6" />
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                      <span className="text-gray-400 text-[10px] uppercase tracking-wider">Network Insight</span>
                    </div>
                    <button
                      onClick={() => fetchInsight(true)}
                      disabled={insightLoading}
                      className="flex items-center gap-1 text-[10px] text-purple-400/60 hover:text-purple-400 transition-colors disabled:opacity-40"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={insightLoading ? "animate-spin" : ""}
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      Refresh
                    </button>
                  </div>

                  {insightLoading && !insight ? (
                    <div className="flex items-center justify-center py-6 gap-3">
                      <div className="w-4 h-4 border-2 border-purple-400/20 border-t-purple-400 rounded-full animate-spin" />
                      <span className="text-xs text-gray-500">Analyzing network...</span>
                    </div>
                  ) : insight ? (
                    <>
                      <p className="text-[13px] leading-relaxed text-gray-300 italic">
                        &ldquo;{insight}&rdquo;
                      </p>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.04]">
                        <span className="text-[9px] text-purple-400/50 font-medium">Network analysis</span>
                        {insightTime && (
                          <span className="text-[9px] text-gray-600">
                            {new Date(insightTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-500 text-center py-4">Unable to load insight</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* On-Chain Stats */}
          <div className="px-4 pb-2">
            <div className="relative overflow-hidden bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span className="text-gray-400 text-[10px] uppercase tracking-wider">Payment Contract</span>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-white font-semibold text-sm">Payment Contract</span>
                      <p className="text-[10px] text-gray-600 font-mono mt-0.5">
                        {ESCROW_ADDRESS.slice(0, 6)}...{ESCROW_ADDRESS.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold text-blue-400">{onChainCount}</span>
                    <p className="text-[8px] text-gray-600">Tasks funded</p>
                  </div>
                </div>

                <a
                  href={`https://worldscan.org/address/${ESCROW_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/20 rounded-xl px-4 py-2.5 transition-all active:scale-[0.98] min-h-[44px]"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span className="text-xs font-medium text-blue-400">View on World Chain</span>
                </a>
              </div>
            </div>
          </div>

          {/* World ID Verification Breakdown */}
          <div className="px-4 pb-2">
            <div className="relative overflow-hidden bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4">
              <div className="absolute top-0 left-0 w-32 h-32 bg-green-500/5 rounded-full blur-3xl -ml-16 -mt-16" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  <span className="text-gray-400 text-[10px] uppercase tracking-wider">World ID Verification</span>
                </div>

                {totalVerified === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-500">No verified runners yet</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="bg-[#22c55e]/8 border border-[#22c55e]/15 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-[#22c55e]">{orbCount}</p>
                        <p className="text-[9px] text-[#22c55e]/60 mt-0.5 font-medium">Orb Verified</p>
                      </div>
                      <div className="bg-[#3b82f6]/8 border border-[#3b82f6]/15 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-[#3b82f6]">{deviceCount}</p>
                        <p className="text-[9px] text-[#3b82f6]/60 mt-0.5 font-medium">Device Verified</p>
                      </div>
                      <div className="bg-[#9ca3af]/8 border border-[#9ca3af]/15 rounded-xl p-3 text-center">
                        <p className="text-lg font-bold text-[#9ca3af]">{walletCount}</p>
                        <p className="text-[9px] text-[#9ca3af]/60 mt-0.5 font-medium">Wallet</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-500">Verification distribution</span>
                        <span className="text-[10px] text-gray-600 font-medium">{totalVerified} runners</span>
                      </div>
                      <div className="h-3 bg-white/[0.04] rounded-full overflow-hidden flex">
                        {orbCount > 0 && (
                          <div
                            className="h-full bg-[#22c55e] transition-all duration-500"
                            style={{ width: `${(orbCount / totalVerified) * 100}%` }}
                            title={`Orb: ${orbCount}`}
                          />
                        )}
                        {deviceCount > 0 && (
                          <div
                            className="h-full bg-[#3b82f6] transition-all duration-500"
                            style={{ width: `${(deviceCount / totalVerified) * 100}%` }}
                            title={`Device: ${deviceCount}`}
                          />
                        )}
                        {walletCount > 0 && (
                          <div
                            className="h-full bg-[#9ca3af]/50 transition-all duration-500"
                            style={{ width: `${(walletCount / totalVerified) * 100}%` }}
                            title={`Wallet: ${walletCount}`}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
                          <span className="text-[9px] text-gray-500">Orb {orbCount > 0 ? `${Math.round((orbCount / totalVerified) * 100)}%` : "0%"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                          <span className="text-[9px] text-gray-500">Device {deviceCount > 0 ? `${Math.round((deviceCount / totalVerified) * 100)}%` : "0%"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-[#9ca3af]/50" />
                          <span className="text-[9px] text-gray-500">Wallet {walletCount > 0 ? `${Math.round((walletCount / totalVerified) * 100)}%` : "0%"}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* City Breakdown */}
          <div className="px-4 pb-2">
            <div className="relative overflow-hidden bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl -mr-16 -mt-16" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  <span className="text-gray-400 text-[10px] uppercase tracking-wider">City Breakdown</span>
                </div>

                {cityBreakdown.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No tasks yet</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {cityBreakdown.map((city) => (
                      <div key={city.city} className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-xl px-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-sm">
                            {city.city === "Paris" ? "\u{1F1EB}\u{1F1F7}" : city.city === "NYC" ? "\u{1F1FA}\u{1F1F8}" : city.city === "Seoul" ? "\u{1F1F0}\u{1F1F7}" : "\u{1F30D}"}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">{city.city}</p>
                            <p className="text-[9px] text-gray-500">{city.total} tasks</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p className="text-[10px] text-green-400 font-semibold">${city.bounty.toFixed(0)}</p>
                            <p className="text-[8px] text-gray-600">posted</p>
                          </div>
                          <div className="text-right min-w-[40px]">
                            <p className={`text-[10px] font-bold ${city.completionRate >= 0.5 ? "text-green-400" : city.completionRate > 0 ? "text-yellow-400" : "text-gray-600"}`}>
                              {Math.round(city.completionRate * 100)}%
                            </p>
                            <p className="text-[8px] text-gray-600">done</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick economics row */}
          <div className="px-4 pb-2">
            <div className="flex gap-1.5">
              <div className="flex-1 bg-[#0a0a0a] border border-white/[0.06] rounded-xl p-3 text-center">
                <p className="text-sm font-bold text-blue-400">${avgBounty.toFixed(2)}</p>
                <p className="text-[9px] text-gray-600 mt-0.5">Avg Task</p>
              </div>
              <div className="flex-1 bg-[#0a0a0a] border border-white/[0.06] rounded-xl p-3 text-center">
                <p className="text-sm font-bold text-purple-400">{formatDuration(avgTimeToCompletion)}</p>
                <p className="text-[9px] text-gray-600 mt-0.5">Avg Time</p>
              </div>
              <div className="flex-1 bg-[#0a0a0a] border border-white/[0.06] rounded-xl p-3 text-center">
                <p className="text-sm font-bold text-orange-400">${escrowLocked.toFixed(2)}</p>
                <p className="text-[9px] text-gray-600 mt-0.5">In Progress</p>
              </div>
            </div>
          </div>

          {/* Agent Leaderboard */}
          <div className="px-4 pb-2">
            <div className="relative overflow-hidden bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4">
              <div className="absolute top-0 left-0 w-40 h-40 bg-yellow-500/[0.03] rounded-full blur-3xl -ml-20 -mt-20" />
              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                    <span className="text-gray-400 text-[10px] uppercase tracking-wider">Agent Leaderboard</span>
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono">{leaderboard.length} agents</span>
                </div>

                {leaderboard.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500">No agent tasks yet</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {leaderboard.map((agent, i) => (
                      <div
                        key={agent.id}
                        style={{ animationDelay: `${i * 60}ms` }}
                        className={`animate-[slideUp_0.3s_ease-out_both] flex items-center gap-3 rounded-xl px-3 py-3 transition-all ${
                          i === 0
                            ? "bg-gradient-to-r from-yellow-500/[0.06] to-transparent border border-yellow-500/10"
                            : i === 1
                            ? "bg-gradient-to-r from-gray-400/[0.04] to-transparent border border-white/[0.04]"
                            : i === 2
                            ? "bg-gradient-to-r from-orange-500/[0.04] to-transparent border border-orange-500/[0.06]"
                            : "bg-white/[0.02] border border-white/[0.03] hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0">
                          <RankBadge rank={i + 1} />
                        </div>

                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 border"
                          style={{
                            backgroundColor: `${agent.color}12`,
                            borderColor: `${agent.color}25`,
                          }}
                        >
                          {agent.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold truncate" style={{ color: agent.color }}>
                              {agent.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] text-gray-500">{agent.totalPosted} tasks</span>
                            <span className="text-[9px] text-gray-700">|</span>
                            <span className={`text-[9px] font-medium ${
                              agent.verificationPassRate >= 0.8 ? "text-green-400" :
                              agent.verificationPassRate >= 0.5 ? "text-yellow-400" :
                              agent.completed === 0 ? "text-gray-600" : "text-red-400"
                            }`}>
                              {agent.completed === 0 ? "N/A" : `${Math.round(agent.verificationPassRate * 100)}% pass`}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-green-400 font-bold">${agent.totalBounty}</span>
                          <p className="text-[8px] text-gray-600">posted</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Per-agent detail cards */}
          <div className="px-4 pb-8 flex flex-col gap-3">
            <div className="flex items-center gap-2 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="text-gray-400 text-[10px] uppercase tracking-wider">Agent Details</span>
            </div>

            {agentStats.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-gray-500">No agent tasks yet</p>
              </div>
            ) : (
              agentStats.map((agent, i) => (
                <div
                  key={agent.id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="animate-[slideUp_0.3s_ease-out_both] relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0a0a]"
                >
                  <div
                    className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl -mr-20 -mt-20 opacity-[0.07]"
                    style={{ backgroundColor: agent.color }}
                  />

                  <div className="relative p-4">
                    <div className="flex items-center gap-2.5 sm:gap-3 mb-4">
                      <div
                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-lg sm:text-xl shrink-0 border"
                        style={{
                          backgroundColor: `${agent.color}12`,
                          borderColor: `${agent.color}25`,
                        }}
                      >
                        {agent.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold truncate" style={{ color: agent.color }}>
                            {agent.name}
                          </span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={agent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5">{agent.totalPosted} tasks posted</p>
                      </div>
                      <div className="text-right">
                        <span className="text-green-400 font-bold">${agent.totalBounty}</span>
                        <p className="text-[9px] text-gray-600">total posted</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-4">
                      {[
                        { value: agent.open, label: "Open", color: "text-blue-400" },
                        { value: agent.claimed, label: "Claimed", color: "text-yellow-400" },
                        { value: agent.completed, label: "Done", color: "text-green-400" },
                        { value: `${Math.round(agent.completionRate * 100)}%`, label: "Rate", color: "text-white" },
                      ].map(({ value, label, color }) => (
                        <div key={label} className="bg-white/[0.03] border border-white/[0.04] rounded-lg p-2 text-center">
                          <p className={`text-sm font-bold ${color}`}>{value}</p>
                          <p className="text-[9px] text-gray-600 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>

                    {agent.completed > 0 && (
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-gray-500">Verification pass rate</span>
                          <span className={`text-[10px] font-bold ${
                            agent.verificationPassRate >= 0.8 ? "text-green-400" :
                            agent.verificationPassRate >= 0.5 ? "text-yellow-400" : "text-red-400"
                          }`}>
                            {Math.round(agent.verificationPassRate * 100)}%
                          </span>
                        </div>
                        <ProgressBar
                          value={Math.round(agent.verificationPassRate * 100)}
                          color={
                            agent.verificationPassRate >= 0.8 ? "#4ade80" :
                            agent.verificationPassRate >= 0.5 ? "#facc15" : "#f87171"
                          }
                        />
                      </div>
                    )}

                    {agent.avgConfidence > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-gray-500">Confidence</span>
                          <span className="text-[10px] font-bold" style={{ color: agent.color }}>
                            {Math.round(agent.avgConfidence * 100)}%
                          </span>
                        </div>
                        <ProgressBar
                          value={Math.round(agent.avgConfidence * 100)}
                          color={agent.color}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Built with */}
      <div className="mt-10 mb-6 flex items-center justify-center gap-3 text-[10px] text-gray-600">
        <span>Built with</span>
        <span className="font-medium text-gray-500">World ID</span>
        <span className="text-gray-700">&middot;</span>
        <span className="font-medium text-gray-500">World Chain</span>
        <span className="text-gray-700">&middot;</span>
        <span className="font-medium text-gray-500">XMTP</span>
        <span className="text-gray-700">&middot;</span>
        <span className="font-medium text-gray-500">MiniKit</span>
      </div>
    </div>
  );
}

function StatBlock({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div>
      <span className={`text-lg font-bold ${color || "text-white"}`}>{value}</span>
      <p className="text-[8px] sm:text-[9px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
