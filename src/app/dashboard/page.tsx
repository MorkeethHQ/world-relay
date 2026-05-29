"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";
import { ProofOfFavourCard } from "@/components/ProofOfFavourCard";
import { TaskSearch } from "@/components/TaskSearch";
import { displayName } from "@/hooks/useWorldUser";
import {
  TopBar,
  Typography,
  Spinner,
  ListItem,
  Button,
} from "@worldcoin/mini-apps-ui-kit-react";

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

  const BackButton = (
    <Link href="/" className="flex items-center text-gray-400 hover:text-gray-900 transition-colors">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </Link>
  );

  return (
    <div className="min-h-screen bg-white text-gray-900 max-w-lg mx-auto">
      <TopBar title="Profile" startAdornment={BackButton} />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Spinner />
        </div>
      ) : (
        <div className="px-6 pt-6 pb-24 flex flex-col gap-8">

          {chain && (
            <>
              <div>
                <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
                  On-chain escrow
                </Typography>
                <div className="bg-white border border-gray-200 rounded-2xl p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Typography variant="body" level={4} className="text-gray-400">Total deposited</Typography>
                      <Typography variant="number" level={2}>${chain.totalDeposited}</Typography>
                    </div>
                    <div className="text-right">
                      <Typography variant="body" level={4} className="text-gray-400">Paid out</Typography>
                      <Typography variant="number" level={2}>${chain.paidOut}</Typography>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-200 text-center">
                    <div>
                      <Typography variant="number" level={3}>${chain.escrowBalance}</Typography>
                      <Typography variant="body" level={4} className="text-gray-400">Locked now</Typography>
                    </div>
                    <div>
                      <Typography variant="number" level={3}>{chain.taskCount}</Typography>
                      <Typography variant="body" level={4} className="text-gray-400">Transactions</Typography>
                    </div>
                    <div>
                      <Typography variant="number" level={3}>{chain.claimants}</Typography>
                      <Typography variant="body" level={4} className="text-gray-400">Claimants</Typography>
                    </div>
                  </div>
                  <div className="mt-3 pt-4 border-t border-gray-200">
                    <a
                      href={`https://worldscan.org/address/${chain.escrowAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-900 underline underline-offset-2"
                    >
                      View contract on WorldScan
                    </a>
                  </div>
                </div>
              </div>

              <div>
                <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Transaction ledger ({chain.tasks.length})
                </Typography>
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-200">
                  {chain.tasks.slice().reverse().map((t) => (
                    <div key={t.id} className="px-3 py-2.5 flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.status === "completed" ? "bg-success-500" :
                        t.status === "open" ? "bg-gray-500" :
                        t.status === "claimed" ? "bg-warning-500" :
                        "bg-gray-400"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <Typography variant="body" level={4} className="text-gray-500 truncate">{t.description}</Typography>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Typography variant="body" level={4} className="text-gray-400">#{t.id}</Typography>
                          {t.claimant && (
                            <Typography variant="body" level={4} className="text-gray-400">{shortAddr(t.claimant)}</Typography>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <Typography variant="body" level={4} className="font-semibold">${t.bounty}</Typography>
                        <Typography variant="body" level={4} className={
                          t.status === "completed" ? "text-success-600" :
                          t.status === "open" ? "text-gray-900" :
                          "text-gray-400"
                        }>{t.status}</Typography>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
              Your reputation
            </Typography>
            <ProofOfFavourCard address={typeof window !== "undefined" ? localStorage.getItem("relay_user_id") || "anonymous" : "anonymous"} />
          </div>

          <div>
            <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
              App overview
            </Typography>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-100 border border-gray-200 rounded-2xl py-4">
                <Typography variant="number" level={2}>{openFunded.length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-1">Funded</Typography>
              </div>
              <div className="bg-gray-100 border border-gray-200 rounded-2xl py-4">
                <Typography variant="number" level={2}>{tasks.filter(t => t.status === "open").length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-1">Open</Typography>
              </div>
              <div className="bg-gray-100 border border-gray-200 rounded-2xl py-4">
                <Typography variant="number" level={2}>{appCompleted.length}</Typography>
                <Typography variant="body" level={4} className="text-gray-400 mt-1">Completed</Typography>
              </div>
            </div>
          </div>

          <div>
            <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
              Browse favours
            </Typography>
            <TaskSearch initialTasks={tasks.filter(t => t.status === "open")} />
          </div>

          {agents.length > 0 && (
            <div>
              <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
                Active agents
              </Typography>
              <div className="flex flex-col gap-1.5">
                {agents.map((agent) => (
                  <ListItem
                    key={agent.name}
                    label={agent.name}
                    description={`${agent.count} favours`}
                    endAdornment={
                      <Typography variant="body" level={3} className="font-medium">${agent.usdc}</Typography>
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 mt-4">
            <Typography variant="body" level={4} className="text-gray-400">RELAY FAVOURS</Typography>
            <Typography variant="body" level={4} className="text-gray-400">·</Typography>
            <Typography variant="body" level={4} className="text-gray-400">World Chain</Typography>
            <Typography variant="body" level={4} className="text-gray-400">·</Typography>
            <Typography variant="body" level={4} className="text-gray-400">XMTP</Typography>
          </div>
        </div>
      )}
    </div>
  );
}
