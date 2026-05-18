"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";
import { ProofOfFavourCard } from "@/components/ProofOfFavourCard";
import { TaskSearch } from "@/components/TaskSearch";
import { displayName } from "@/hooks/useWorldUser";

type OnChainTask = {
  id: number;
  bounty: string;
  status: string;
  description: string;
  claimant: string;
};

type EscrowStats = {
  escrowAddress: string;
  taskCount: number;
  escrowBalance: string;
  totalDeposited: string;
  paidOut: string;
  openLocked: string;
  completedCount: number;
  claimants: number;
  tasks: OnChainTask[];
};

function shortAddr(addr: string): string {
  return displayName(addr);
}

export default function ProfilePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chain, setChain] = useState<EscrowStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then(r => r.json()).then(d => setTasks(d.tasks || [])),
      fetch("/api/escrow-stats").then(r => r.json()).then(d => { if (!d.error) setChain(d); }),
    ]).finally(() => setLoading(false));
  }, []);

  const funded = tasks.filter(t => t.escrowTxHash);
  const openFunded = funded.filter(t => t.status === "open");
  const appCompleted = tasks.filter(t => t.status === "completed");

  const agentMap = new Map<string, { name: string; count: number; usdc: number }>();
  for (const t of tasks) {
    if (!t.agent) continue;
    const existing = agentMap.get(t.agent.id);
    if (existing) { existing.count++; existing.usdc += t.bountyUsdc; }
    else agentMap.set(t.agent.id, { name: t.agent.name, count: 1, usdc: t.bountyUsdc });
  }
  const agents = Array.from(agentMap.values()).sort((a, b) => b.count - a.count);

  return (
    <div className="min-h-screen bg-white text-[#191C20] max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-[#E9ECF0]">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center text-sm text-[#9BA3AE] hover:text-[#191C20] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="text-sm font-semibold text-[#191C20]">Profile</span>
          <div className="w-8" />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-5 h-5 border-2 border-[#E9ECF0] border-t-[#191C20] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-6 pt-6 pb-24 flex flex-col gap-8">

          {/* On-chain stats */}
          {chain && (
            <>
              <div>
                <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">On-chain escrow</p>
                <div className="bg-white border border-[#E9ECF0] rounded-2xl p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-[#9BA3AE]">Total deposited</p>
                      <p className="text-xl font-bold text-[#191C20]">${chain.totalDeposited}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-[#9BA3AE]">Paid out</p>
                      <p className="text-xl font-bold text-[#191C20]">${chain.paidOut}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-[#E9ECF0] text-center">
                    <div>
                      <p className="text-lg font-bold text-[#191C20]">${chain.escrowBalance}</p>
                      <p className="text-xs text-[#9BA3AE]">Locked now</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-[#191C20]">{chain.taskCount}</p>
                      <p className="text-xs text-[#9BA3AE]">Transactions</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-[#191C20]">{chain.claimants}</p>
                      <p className="text-xs text-[#9BA3AE]">Claimants</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-4 border-t border-[#E9ECF0]">
                    <a
                      href={`https://worldscan.org/address/${chain.escrowAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 underline underline-offset-2"
                    >
                      View contract on WorldScan
                    </a>
                  </div>
                </div>
              </div>

              {/* On-chain ledger */}
              <div>
                <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">
                  Transaction ledger ({chain.tasks.length})
                </p>
                <div className="bg-white border border-[#E9ECF0] rounded-2xl overflow-hidden divide-y divide-[#E9ECF0]">
                  {chain.tasks.slice().reverse().map((t) => (
                    <div key={t.id} className="px-3 py-2.5 flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.status === "completed" ? "bg-green-400" :
                        t.status === "open" ? "bg-blue-400" :
                        t.status === "claimed" ? "bg-yellow-400" :
                        "bg-[#9BA3AE]"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#657080] truncate">{t.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-[#9BA3AE]">#{t.id}</span>
                          {t.claimant && (
                            <span className="text-xs text-[#9BA3AE]">{shortAddr(t.claimant)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-[#191C20]">${t.bounty}</p>
                        <p className={`text-xs ${
                          t.status === "completed" ? "text-green-600" :
                          t.status === "open" ? "text-blue-500" :
                          "text-[#9BA3AE]"
                        }`}>{t.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Proof of Favour reputation */}
          <div>
            <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">Your reputation</p>
            <ProofOfFavourCard address={typeof window !== "undefined" ? localStorage.getItem("relay_user_id") || "anonymous" : "anonymous"} />
          </div>

          {/* App stats */}
          <div>
            <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">App overview</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-[#F0F2F5] border border-[#E9ECF0] rounded-2xl py-4">
                <p className="text-2xl font-bold text-[#191C20]">{openFunded.length}</p>
                <p className="text-xs text-[#9BA3AE] mt-1">Funded</p>
              </div>
              <div className="bg-[#F0F2F5] border border-[#E9ECF0] rounded-2xl py-4">
                <p className="text-2xl font-bold text-[#191C20]">{tasks.filter(t => t.status === "open").length}</p>
                <p className="text-xs text-[#9BA3AE] mt-1">Open</p>
              </div>
              <div className="bg-[#F0F2F5] border border-[#E9ECF0] rounded-2xl py-4">
                <p className="text-2xl font-bold text-[#191C20]">{appCompleted.length}</p>
                <p className="text-xs text-[#9BA3AE] mt-1">Completed</p>
              </div>
            </div>
          </div>

          {/* Search & filter tasks */}
          <div>
            <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">Browse favours</p>
            <TaskSearch initialTasks={tasks.filter(t => t.status === "open")} />
          </div>

          {/* Active agents */}
          {agents.length > 0 && (
            <div>
              <p className="text-xs text-[#9BA3AE] uppercase tracking-wider mb-2 px-1">Active agents</p>
              <div className="flex flex-col gap-1.5">
                {agents.map((agent) => (
                  <div
                    key={agent.name}
                    className="flex items-center justify-between bg-white border border-[#E9ECF0] rounded-xl px-6 py-4"
                  >
                    <span className="text-sm font-medium text-[#191C20]">{agent.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[#9BA3AE]">{agent.count} favours</span>
                      <span className="text-xs font-medium text-[#191C20]">${agent.usdc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 text-xs text-[#9BA3AE] mt-4">
            <span>RELAY FAVOURS</span>
            <span>·</span>
            <span>World Chain</span>
            <span>·</span>
            <span>XMTP</span>
          </div>
        </div>
      )}
    </div>
  );
}
