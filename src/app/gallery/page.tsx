"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  TopBar as WorldTopBar,
  Typography as WorldTypography,
  Spinner as WorldSpinner,
  Progress as WorldProgress,
} from "@worldcoin/mini-apps-ui-kit-react";
import type { Task } from "@/lib/types";

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function VerdictIcon({ verdict, size = 14 }: { verdict: string; size?: number }) {
  const color = verdict === "pass" ? "#22c55e" : verdict === "flag" ? "#eab308" : "#ef4444";
  if (verdict === "pass") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (verdict === "flag") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
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
  const passCount = tasks.filter(t => t.verificationResult?.verdict === "pass").length;
  const passRate = tasks.length > 0 ? passCount / tasks.length : 0;

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* World TopBar */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <WorldTopBar
          title="Proof Gallery"
          startAdornment={
            <Link href="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
          }
          className="!bg-transparent !text-white [&_p]:!text-white"
        />
      </div>

      {/* Stats */}
      <div className="px-4 py-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06]">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/8 via-transparent to-green-500/8" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(168,85,247,0.06),transparent_50%)]" />

          <div className="relative p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <WorldTypography variant="number" level={4} as="span" className="!text-white">
                  {tasks.length}
                </WorldTypography>
                <p className="text-[10px] text-gray-500 mt-0.5">Verified Proofs</p>
              </div>
              <div>
                <WorldTypography variant="number" level={4} as="span" className="!text-green-400">
                  ${totalUsdc.toFixed(0)}
                </WorldTypography>
                <p className="text-[10px] text-gray-500 mt-0.5">USDC Settled</p>
              </div>
              <div>
                <WorldTypography variant="number" level={4} as="span" className="!text-purple-400">
                  {Math.round(avgConfidence * 100)}%
                </WorldTypography>
                <p className="text-[10px] text-gray-500 mt-0.5">Avg Confidence</p>
              </div>
            </div>

            {/* Pass rate bar */}
            {tasks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/[0.04]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-gray-500">Pass rate</span>
                  <span className="text-[10px] font-bold text-green-400">{Math.round(passRate * 100)}%</span>
                </div>
                <WorldProgress
                  value={Math.round(passRate * 100)}
                  className="!bg-white/[0.06] !text-green-400"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="px-4 pb-3 flex gap-2">
        {(["all", "photo", "check-in"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 min-h-[44px] rounded-full text-xs font-semibold transition-all ${
              filter === f
                ? "bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.1)]"
                : "bg-white/[0.04] text-gray-500 border border-white/[0.06] hover:bg-white/[0.06]"
            }`}
          >
            {f === "all" ? "All" : f === "photo" ? "Photos" : "Check-ins"}
          </button>
        ))}
      </div>

      {/* Gallery grid */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <WorldSpinner className="!text-white" />
            <WorldTypography variant="body" level={3} className="!text-gray-500">
              Loading proofs...
            </WorldTypography>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <WorldTypography variant="body" level={3} className="!text-gray-500">
              No verified proofs yet
            </WorldTypography>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((task, i) => {
              const verdict = task.verificationResult?.verdict;
              const verdictColor = verdict === "pass" ? "#22c55e" : verdict === "flag" ? "#eab308" : "#ef4444";
              const verdictLabel = verdict === "pass" ? "PASS" : verdict === "flag" ? "FLAG" : "FAIL";
              const confidencePct = Math.round((task.verificationResult?.confidence || 0) * 100);

              return (
                <div
                  key={task.id}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="animate-[slideUp_0.3s_ease-out_both] rounded-2xl overflow-hidden bg-[#0a0a0a] border border-white/[0.06]"
                >
                  {task.proofImageUrl && (
                    <div className="relative">
                      <img src={task.proofImageUrl} alt="Proof" className="w-full h-56 object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent" />

                      {/* Agent badge + verdict badge */}
                      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
                        <div className="flex gap-2">
                          {task.agent && (
                            <div
                              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 backdrop-blur-md border text-[10px] font-bold shadow-lg"
                              style={{
                                backgroundColor: `${task.agent.color}25`,
                                borderColor: `${task.agent.color}40`,
                                color: task.agent.color,
                              }}
                            >
                              {task.agent.icon} {task.agent.name}
                            </div>
                          )}
                        </div>
                        {/* Verdict badge - larger and more prominent */}
                        <div
                          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 backdrop-blur-md border text-xs font-bold shadow-lg"
                          style={{
                            backgroundColor: `${verdictColor}25`,
                            borderColor: `${verdictColor}50`,
                            color: verdictColor,
                            boxShadow: `0 0 20px ${verdictColor}15`,
                          }}
                        >
                          <VerdictIcon verdict={verdict || "fail"} size={14} />
                          {verdictLabel}
                        </div>
                      </div>

                      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                        <div
                          className="backdrop-blur-md border rounded-full px-3 py-1.5 flex items-center gap-2 shadow-lg"
                          style={{
                            backgroundColor: `${verdictColor}20`,
                            borderColor: `${verdictColor}30`,
                          }}
                        >
                          <span className="text-[11px] font-bold" style={{ color: verdictColor }}>
                            {confidencePct}%
                          </span>
                          <span className="text-[9px] text-white/40">confidence</span>
                        </div>
                        <span className="text-xs font-bold text-green-400 bg-black/50 backdrop-blur-md rounded-full px-3 py-1.5 border border-green-500/20 shadow-lg">
                          ${task.bountyUsdc}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-4">
                    {/* Task description */}
                    <WorldTypography variant="subtitle" level={3} as="p" className="!text-white !font-medium leading-snug break-words">
                      {task.description}
                    </WorldTypography>

                    {task.verificationResult && (
                      <p className="text-xs text-gray-500 mt-2 italic leading-relaxed">
                        &ldquo;{task.verificationResult.reasoning.length > 150
                          ? task.verificationResult.reasoning.slice(0, 150) + "..."
                          : task.verificationResult.reasoning}&rdquo;
                      </p>
                    )}

                    {/* Confidence mini-bar */}
                    <div className="mt-3 mb-3">
                      <WorldProgress
                        value={confidencePct}
                        className={`!bg-white/[0.04] ${
                          verdict === "pass" ? "!text-green-400" :
                          verdict === "flag" ? "!text-yellow-400" : "!text-red-400"
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/[0.04] gap-2">
                      <div className="flex items-center gap-2 text-[10px] text-gray-600 truncate min-w-0">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                        </svg>
                        <span className="truncate">{task.location}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-gray-700">{timeAgo(task.createdAt)}</span>
                        {task.attestationTxHash && (
                          <a
                            href={`https://worldscan.org/tx/${task.attestationTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-blue-400 font-bold flex items-center gap-1 bg-blue-500/8 border border-blue-500/20 rounded-full px-2 py-0.5"
                          >
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            on-chain
                          </a>
                        )}
                      </div>
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
