"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

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
      };
    })
    .sort((a, b) => b.totalPosted - a.totalPosted);
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
  const agentTasks = tasks.filter(t => t.agent);
  const totalBounty = agentTasks.reduce((s, t) => s + t.bountyUsdc, 0);
  const totalCompleted = agentTasks.filter(t => t.status === "completed").length;
  const recurringCount = agentTasks.filter(t => t.recurring).length;

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

      {/* Network overview */}
      <div className="px-4 py-4">
        <div className="bg-gradient-to-r from-blue-500/8 to-purple-500/8 border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">Agent Network Overview</p>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-white">{agentStats.length}</p>
              <p className="text-[9px] text-gray-500 mt-0.5">Agents</p>
            </div>
            <div>
              <p className="text-xl font-bold text-blue-400">{agentTasks.length}</p>
              <p className="text-[9px] text-gray-500 mt-0.5">Tasks</p>
            </div>
            <div>
              <p className="text-xl font-bold text-green-400">{totalCompleted}</p>
              <p className="text-[9px] text-gray-500 mt-0.5">Verified</p>
            </div>
            <div>
              <p className="text-xl font-bold text-orange-400">{recurringCount}</p>
              <p className="text-[9px] text-gray-500 mt-0.5">Recurring</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.06] text-center">
            <p className="text-[10px] text-gray-600">Total bounties: <span className="text-green-400 font-semibold">${totalBounty.toFixed(0)} USDC</span></p>
          </div>
        </div>
      </div>

      {/* Per-agent cards */}
      <div className="px-4 pb-8 flex flex-col gap-3">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="bg-[#111] rounded-2xl p-4 animate-pulse h-32" />
          ))
        ) : agentStats.length === 0 ? (
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
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                  style={{ backgroundColor: `${agent.color}15` }}
                >
                  {agent.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: agent.color }}>{agent.name}</span>
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
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="bg-black/20 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-blue-400">{agent.open}</p>
                  <p className="text-[8px] text-gray-600">Open</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-yellow-400">{agent.claimed}</p>
                  <p className="text-[8px] text-gray-600">Claimed</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-green-400">{agent.completed}</p>
                  <p className="text-[8px] text-gray-600">Done</p>
                </div>
                <div className="bg-black/20 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-white">{Math.round(agent.completionRate * 100)}%</p>
                  <p className="text-[8px] text-gray-600">Rate</p>
                </div>
              </div>

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
    </div>
  );
}
