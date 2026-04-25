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
  // Take last meaningful segment as city (e.g. "123 Main St, Paris" -> "Paris")
  const parts = location.split(",").map(s => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || location;
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const agentStats = computeAgentStats(tasks);

  // Network-wide stats
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

  // Leaderboard sorted by totalPosted desc
  const leaderboard = [...agentStats].sort((a, b) => {
    if (b.totalPosted !== a.totalPosted) return b.totalPosted - a.totalPosted;
    if (b.verificationPassRate !== a.verificationPassRate) return b.verificationPassRate - a.verificationPassRate;
    return b.totalBounty - a.totalBounty;
  });

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
          <h1 className="text-sm font-bold tracking-tight">Agent Dashboard</h1>
          <div className="w-12" />
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-4 flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-[#111] rounded-2xl p-4 animate-pulse h-32" />
          ))}
        </div>
      ) : (
        <>
          {/* Live Network Stats */}
          <div className="px-4 py-4">
            <div className="bg-gradient-to-r from-blue-500/8 to-purple-500/8 border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">Live Network Stats</p>
              <div className="grid grid-cols-4 gap-1.5 sm:gap-3 text-center">
                <div>
                  <p className="text-lg sm:text-xl font-bold text-white">{totalTasks}</p>
                  <p className="text-[8px] sm:text-[9px] text-gray-500 mt-0.5">Total Tasks</p>
                </div>
                <div>
                  <p className="text-lg sm:text-xl font-bold text-blue-400">{openTasks}</p>
                  <p className="text-[8px] sm:text-[9px] text-gray-500 mt-0.5">Open</p>
                </div>
                <div>
                  <p className="text-lg sm:text-xl font-bold text-green-400">{completedTasks}</p>
                  <p className="text-[8px] sm:text-[9px] text-gray-500 mt-0.5">Completed</p>
                </div>
                <div>
                  <p className="text-lg sm:text-xl font-bold text-purple-400">{uniqueRunners}</p>
                  <p className="text-[8px] sm:text-[9px] text-gray-500 mt-0.5">Runners</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-sm font-bold text-green-400">${totalBounty.toFixed(0)}</p>
                  <p className="text-[8px] text-gray-600">USDC Bounties</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-400">${settledUsdc.toFixed(0)}</p>
                  <p className="text-[8px] text-gray-600">USDC Settled</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-orange-400">{cityCount}</p>
                  <p className="text-[8px] text-gray-600">{cityCount === 1 ? "City" : "Cities"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* On-Chain Stats */}
          <div className="px-4 pb-4">
            <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">On-Chain Stats</p>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Escrow Contract</p>
                    <p className="text-[10px] text-gray-600 font-mono">
                      {ESCROW_ADDRESS.slice(0, 6)}...{ESCROW_ADDRESS.slice(-4)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-blue-400">{onChainCount}</p>
                  <p className="text-[8px] text-gray-600">On-chain Tasks</p>
                </div>
              </div>
              <a
                href={`https://worldscan.org/address/${ESCROW_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-blue-500/8 hover:bg-blue-500/15 border border-blue-500/20 rounded-xl px-4 py-2.5 transition-colors active:scale-[0.98] min-h-[44px]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span className="text-xs font-medium text-blue-400">View contract on World Chain</span>
              </a>
            </div>
          </div>

          {/* Agent Leaderboard */}
          <div className="px-4 pb-4">
            <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">Agent Leaderboard</p>
              {leaderboard.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">No agent tasks yet</p>
                  <Link href="/agents" className="text-xs text-blue-400 mt-2 inline-block">View Agent API</Link>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {leaderboard.map((agent, i) => (
                    <div
                      key={agent.id}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="animate-[slideUp_0.3s_ease-out_both] flex items-center gap-3 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] rounded-xl px-3 py-2.5 transition-colors"
                    >
                      {/* Rank */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20" :
                        i === 1 ? "bg-gray-400/10 text-gray-400 border border-gray-500/20" :
                        i === 2 ? "bg-orange-500/10 text-orange-400 border border-orange-500/20" :
                        "bg-white/[0.04] text-gray-600 border border-white/[0.04]"
                      }`}>
                        {i + 1}
                      </div>

                      {/* Agent icon + name */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                        style={{ backgroundColor: `${agent.color}15` }}
                      >
                        {agent.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: agent.color }}>{agent.name}</p>
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

                      {/* USDC deployed */}
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-green-400">${agent.totalBounty}</p>
                        <p className="text-[8px] text-gray-600">USDC</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-agent detail cards */}
          <div className="px-4 pb-8 flex flex-col gap-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Agent Details</p>
            {agentStats.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-gray-500">No agent tasks yet</p>
                <Link href="/agents" className="text-xs text-blue-400 mt-2 inline-block">View Agent API</Link>
              </div>
            ) : (
              agentStats.map((agent, i) => (
                <div
                  key={agent.id}
                  style={{ animationDelay: `${i * 60}ms`, backgroundColor: `${agent.color}06`, borderColor: `${agent.color}15` }}
                  className="animate-[slideUp_0.3s_ease-out_both] rounded-2xl p-4 border"
                >
                  {/* Agent header */}
                  <div className="flex items-center gap-2.5 sm:gap-3 mb-3">
                    <div
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-lg sm:text-xl shrink-0"
                      style={{ backgroundColor: `${agent.color}15` }}
                    >
                      {agent.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold truncate" style={{ color: agent.color }}>{agent.name}</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={agent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      </div>
                      <p className="text-[10px] text-gray-500">{agent.totalPosted} tasks posted</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-400">${agent.totalBounty}</p>
                      <p className="text-[9px] text-gray-600">USDC total</p>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-3">
                    <div className="bg-black/20 rounded-lg p-1.5 sm:p-2 text-center">
                      <p className="text-xs sm:text-sm font-bold text-blue-400">{agent.open}</p>
                      <p className="text-[7px] sm:text-[8px] text-gray-600">Open</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-1.5 sm:p-2 text-center">
                      <p className="text-xs sm:text-sm font-bold text-yellow-400">{agent.claimed}</p>
                      <p className="text-[7px] sm:text-[8px] text-gray-600">Claimed</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-1.5 sm:p-2 text-center">
                      <p className="text-xs sm:text-sm font-bold text-green-400">{agent.completed}</p>
                      <p className="text-[7px] sm:text-[8px] text-gray-600">Done</p>
                    </div>
                    <div className="bg-black/20 rounded-lg p-1.5 sm:p-2 text-center">
                      <p className="text-xs sm:text-sm font-bold text-white">{Math.round(agent.completionRate * 100)}%</p>
                      <p className="text-[7px] sm:text-[8px] text-gray-600">Rate</p>
                    </div>
                  </div>

                  {/* Verification pass rate bar */}
                  {agent.completed > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-600">Verification pass rate</span>
                        <span className={`text-[10px] font-medium ${
                          agent.verificationPassRate >= 0.8 ? "text-green-400" :
                          agent.verificationPassRate >= 0.5 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {Math.round(agent.verificationPassRate * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.round(agent.verificationPassRate * 100)}%`,
                            backgroundColor: agent.verificationPassRate >= 0.8 ? "#4ade80" :
                              agent.verificationPassRate >= 0.5 ? "#facc15" : "#f87171",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Confidence bar */}
                  {agent.avgConfidence > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-600">AI confidence</span>
                        <span className="text-[10px] font-medium" style={{ color: agent.color }}>
                          {Math.round(agent.avgConfidence * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.round(agent.avgConfidence * 100)}%`,
                            backgroundColor: agent.color,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
