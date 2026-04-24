"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

function shortId(id: string): string {
  if (id.startsWith("0x")) return `${id.slice(0, 6)}...${id.slice(-4)}`;
  if (id.startsWith("agent_")) return id.replace("agent_", "");
  return id.slice(0, 12);
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

export default function GalleryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "photo" | "check-in">("all");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks?.filter((t: Task) => t.status === "completed" && t.verificationResult) || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? tasks : tasks.filter(t => t.category === filter);
  const totalUsdc = tasks.reduce((s, t) => s + t.bountyUsdc, 0);
  const avgConfidence = tasks.length > 0
    ? tasks.reduce((s, t) => s + (t.verificationResult?.confidence || 0), 0) / tasks.length
    : 0;

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
          <h1 className="text-sm font-bold tracking-tight">Proof Gallery</h1>
          <div className="w-12" />
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-4">
        <div className="bg-gradient-to-r from-purple-500/8 to-green-500/8 border border-white/[0.06] rounded-2xl p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{tasks.length}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Verified Proofs</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-400">${totalUsdc.toFixed(0)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">USDC Settled</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-purple-400">{Math.round(avgConfidence * 100)}%</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Avg Confidence</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="px-4 pb-3 flex gap-2">
        {(["all", "photo", "check-in"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filter === f ? "bg-white text-black" : "bg-[#111] text-gray-500 border border-white/[0.06]"
            }`}
          >
            {f === "all" ? "All" : f === "photo" ? "Photos" : "Check-ins"}
          </button>
        ))}
      </div>

      {/* Gallery grid */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-2xl h-48 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">No verified proofs yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((task, i) => (
              <div
                key={task.id}
                style={{ animationDelay: `${i * 60}ms` }}
                className="animate-[slideUp_0.3s_ease-out_both] rounded-2xl overflow-hidden bg-[#111] border border-white/[0.06]"
              >
                {task.proofImageUrl && (
                  <div className="relative">
                    <img src={task.proofImageUrl} alt="Proof" className="w-full h-52 object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent" />

                    {/* Overlays */}
                    <div className="absolute top-3 left-3 flex gap-2">
                      {task.agent && (
                        <div
                          className="flex items-center gap-1 rounded-lg px-2 py-1 backdrop-blur-sm border text-[10px] font-bold"
                          style={{
                            backgroundColor: `${task.agent.color}20`,
                            borderColor: `${task.agent.color}40`,
                            color: task.agent.color,
                          }}
                        >
                          {task.agent.icon} {task.agent.name}
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                      <div className="bg-green-500/20 backdrop-blur-sm border border-green-500/30 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] font-bold text-green-400">
                          {Math.round((task.verificationResult?.confidence || 0) * 100)}%
                        </span>
                      </div>
                      <span className="text-[11px] font-bold text-green-400 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1">
                        ${task.bountyUsdc}
                      </span>
                    </div>
                  </div>
                )}

                <div className="p-4">
                  <p className="text-sm font-medium leading-snug">{task.description}</p>

                  {task.verificationResult && (
                    <p className="text-xs text-gray-500 mt-2 italic leading-relaxed">
                      &ldquo;{task.verificationResult.reasoning}&rdquo;
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.04]">
                    <div className="flex items-center gap-2 text-[10px] text-gray-600">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                      </svg>
                      {task.location}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-700">{timeAgo(task.createdAt)}</span>
                      {task.attestationTxHash && (
                        <a
                          href={`https://worldscan.org/tx/${task.attestationTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-400 font-medium"
                        >
                          on-chain
                        </a>
                      )}
                    </div>
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
