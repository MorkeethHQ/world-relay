"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { MiniKit } from "@worldcoin/minikit-js";
import type { Task, AgentInfo } from "@/lib/types";
import { encodeCreateTask, encodeClaimTask, encodeReleasePayment, encodeUniswapSwap, readTaskCount, RELAY_ESCROW_ADDRESS, type SwapToken } from "@/lib/contracts";
import { TASK_TEMPLATES } from "@/lib/agents";

const TaskMap = dynamic(() => import("./TaskMap").then((m) => m.TaskMap), { ssr: false });

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600_000);
  const mins = Math.floor((ms % 3600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function shortId(id: string): string {
  if (id.startsWith("dev_")) return id;
  if (id.startsWith("0x")) return `${id.slice(0, 6)}...${id.slice(-4)}`;
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m away`;
  if (km < 10) return `${km.toFixed(1)}km away`;
  return `${Math.round(km)}km away`;
}

const CATEGORY_ICONS: Record<string, string> = {
  photo: "📸",
  delivery: "📦",
  "check-in": "📍",
  custom: "✏️",
};

function useUserLocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);
  return coords;
}

function ActivityTicker({ tasks }: { tasks: Task[] }) {
  const events: { icon: string; text: string; color: string; time: string }[] = [];

  const sorted = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const t of sorted.slice(0, 20)) {
    if (t.status === "completed" && t.verificationResult) {
      events.push({
        icon: "✅",
        text: `${t.agent ? t.agent.name : shortId(t.poster)} task verified${t.verificationResult.confidence ? ` · ${Math.round(t.verificationResult.confidence * 100)}%` : ""}`,
        color: "text-green-400/70",
        time: timeAgo(t.createdAt),
      });
    }
    if (t.claimant) {
      events.push({
        icon: "⚡",
        text: `${shortId(t.claimant)} claimed ${t.agent ? t.agent.name : ""} task · $${t.bountyUsdc}`,
        color: "text-blue-400/70",
        time: timeAgo(t.createdAt),
      });
    }
    if (t.agent && t.status === "open") {
      events.push({
        icon: t.agent.icon,
        text: `${t.agent.name} posted · ${t.location}`,
        color: "text-gray-400",
        time: timeAgo(t.createdAt),
      });
    }
  }

  if (events.length === 0) return null;

  return (
    <div className="overflow-hidden px-4 py-2">
      <div className="flex gap-6 animate-[ticker_30s_linear_infinite] w-max">
        {[...events, ...events].map((ev, i) => (
          <span key={i} className={`text-[10px] whitespace-nowrap flex items-center gap-1.5 ${ev.color}`}>
            <span>{ev.icon}</span>
            {ev.text}
            <span className="text-gray-700">{ev.time}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

type Tab = "available" | "mine" | "completed";

export function Feed({ userId, verificationLevel, onLogout }: { userId: string | null; verificationLevel?: string | null; onLogout?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<"board" | "post" | "proof" | "detail">("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<Tab>("available");
  const [mapMode, setMapMode] = useState(false);
  const [xmtpStatus, setXmtpStatus] = useState<{ connected: boolean; inboxId: string | null } | null>(null);
  const userLocation = useUserLocation();

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data.tasks);
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/xmtp-status")
      .then((res) => res.json())
      .then((data) => setXmtpStatus({ connected: data.connected, inboxId: data.inboxId }))
      .catch(() => setXmtpStatus({ connected: false, inboxId: null }));
  }, []);

  if (view === "post") {
    return <PostTask userId={userId} onDone={() => { setView("board"); fetchTasks(); }} onCancel={() => setView("board")} />;
  }

  if (view === "proof" && selectedTask) {
    return <SubmitProof task={selectedTask} onDone={() => { setView("board"); fetchTasks(); }} onCancel={() => setView("board")} />;
  }

  if (view === "detail" && selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        userId={userId}
        onBack={() => { setView("board"); fetchTasks(); }}
        onSubmitProof={() => setView("proof")}
      />
    );
  }

  const filtered = tasks.filter((t) => {
    if (tab === "available") return t.status === "open";
    if (tab === "mine") return t.poster === userId || t.claimant === userId;
    if (tab === "completed") return t.status === "completed";
    return true;
  }).sort((a, b) => {
    if (tab === "available") {
      const now = Date.now();
      const aHoursLeft = (new Date(a.deadline).getTime() - now) / 3600_000;
      const bHoursLeft = (new Date(b.deadline).getTime() - now) / 3600_000;
      const aUrgent = aHoursLeft < 4 || a.bountyUsdc >= 15;
      const bUrgent = bHoursLeft < 4 || b.bountyUsdc >= 15;
      if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
      if (userLocation && a.lat && a.lng && b.lat && b.lng) {
        return haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng)
             - haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
      }
    }
    return 0;
  });

  const myTaskCount = tasks.filter(t => t.poster === userId || t.claimant === userId).length;
  const completedByClaiming = tasks.filter(t => t.claimant === userId && t.status === "completed");
  const totalEarned = completedByClaiming.reduce((sum, t) => sum + t.bountyUsdc, 0);
  const totalPosted = tasks.filter(t => t.poster === userId).length;
  const totalClaimed = tasks.filter(t => t.claimant === userId).length;

  return (
    <div className="flex flex-col gap-0 max-w-lg mx-auto w-full min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">RELAY</h1>
              {userId && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <button onClick={onLogout} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors leading-none">
                    {shortId(userId)}
                  </button>
                  <VerificationBadge level={verificationLevel} />
                </div>
              )}
            </div>
          </div>
          {userId && (
            <div className="flex items-center gap-2">
              <a
                href="/gallery"
                className="h-9 px-2.5 rounded-full font-semibold text-[11px] border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1"
                title="Proof Gallery"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                </svg>
              </a>
              <a
                href="/leaderboard"
                className="h-9 px-2.5 rounded-full font-semibold text-[11px] border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1"
                title="Leaderboard"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </a>
              <a
                href="/dashboard"
                className="h-9 px-2.5 rounded-full font-semibold text-[11px] border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1"
                title="Agent Dashboard"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              </a>
              <a
                href="/agents"
                className="h-9 px-3 rounded-full font-semibold text-[11px] border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
                </svg>
                API
              </a>
              <a
                href="/demo"
                className="h-9 px-3 rounded-full font-semibold text-[11px] border border-blue-500/30 text-blue-400 hover:text-blue-300 hover:border-blue-500/50 transition-all flex items-center gap-1.5 bg-blue-500/5"
                title="XMTP Demo Flow"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Demo
              </a>
              <a
                href="/live"
                className="h-9 px-3 rounded-full font-semibold text-[11px] border border-green-500/30 text-green-400 hover:text-green-300 hover:border-green-500/50 transition-all flex items-center gap-1.5 bg-green-500/5"
                title="Live Mission Control"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Live
              </a>
              <a
                href="/map"
                className="h-9 px-3 rounded-full font-semibold text-[11px] border border-purple-500/30 text-purple-400 hover:text-purple-300 hover:border-purple-500/50 transition-all flex items-center gap-1.5 bg-purple-500/5"
                title="Task Map"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="22" />
                </svg>
                Map
              </a>
              <button
                onClick={() => setView("post")}
                className="bg-white text-black h-9 px-4 rounded-full font-semibold text-xs active:scale-95 transition-all shadow-[0_0_12px_rgba(255,255,255,0.08)]"
              >
                + Request
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-0 items-center">
          {(["available", "mine", "completed"] as Tab[]).map((t) => {
            const label = t === "available" ? "Nearby" : t === "mine" ? "Yours" : "Done";
            const count = t === "mine" ? myTaskCount : null;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 text-xs py-2.5 font-medium transition-all relative ${
                  tab === t ? "text-white" : "text-gray-500"
                }`}
              >
                {label}
                {count !== null && count > 0 && (
                  <span className="ml-1 text-[10px] text-gray-500">{count}</span>
                )}
                {tab === t && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-white rounded-full" />
                )}
              </button>
            );
          })}
          {tab === "available" && (
            <button
              onClick={() => setMapMode(!mapMode)}
              className={`ml-1 p-2 rounded-lg transition-all ${mapMode ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"}`}
            >
              {mapMode ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {tab === "available" && tasks.length > 0 && !mapMode && (
        <div className="px-4 pt-3 pb-0">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>{tasks.filter(t => t.status === "open").length} open</span>
            <span className="text-gray-700">·</span>
            <span>{tasks.filter(t => t.status === "completed").length} verified</span>
            <span className="text-gray-700">·</span>
            <span className="text-green-500/70 font-medium">
              ${tasks.filter(t => t.status === "completed").reduce((s, t) => s + t.bountyUsdc, 0).toFixed(0)} USDC settled
            </span>
            <span className="text-gray-700">·</span>
            <span>{new Set(tasks.filter(t => t.claimant).map(t => t.claimant)).size} runners</span>
          </div>
        </div>
      )}

      {/* Activity ticker */}
      {tab === "available" && tasks.length > 3 && !mapMode && (
        <ActivityTicker tasks={tasks} />
      )}

      {/* Content */}
      <div className="flex-1 px-4 py-3">
        {/* Profile + Reputation for "Yours" tab */}
        {tab === "mine" && (
          <div className="mb-4 flex flex-col gap-3">
            {/* Identity card */}
            <div className="bg-gradient-to-r from-white/[0.03] to-white/[0.06] border border-white/[0.08] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-white">{userId?.slice(-2).toUpperCase()}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{userId ? shortId(userId) : ""}</p>
                    <VerificationBadge level={verificationLevel} size="md" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xl font-bold text-green-400">${totalEarned.toFixed(2)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">USDC Earned</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-white">{completedByClaiming.length}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Completed</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-blue-400">{totalPosted}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Posted</p>
                </div>
              </div>
            </div>

            {/* Trust tiers explanation */}
            <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2.5">World ID Trust Tiers</p>
              <div className="flex flex-col gap-2">
                {[
                  { level: "orb", label: "Orb Verified", access: "All tasks", limit: "No limit", color: "text-cyan-400", icon: "◉" },
                  { level: "device", label: "Device Verified", access: "Tasks up to $20", limit: "$20 max", color: "text-blue-400", icon: "✓" },
                  { level: "wallet", label: "Wallet Verified", access: "Tasks up to $10", limit: "$10 max", color: "text-green-400", icon: "✓" },
                ].map((tier) => {
                  const isCurrentTier = verificationLevel === tier.level;
                  return (
                    <div key={tier.level} className={`flex items-center justify-between rounded-xl px-3 py-2 ${isCurrentTier ? "bg-white/5 border border-white/10" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${tier.color}`}>{tier.icon}</span>
                        <div>
                          <span className={`text-xs font-medium ${isCurrentTier ? "text-white" : "text-gray-400"}`}>{tier.label}</span>
                          {isCurrentTier && <span className="text-[9px] text-gray-500 ml-1.5">← You</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-600">{tier.limit}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {completedByClaiming.length > 0 && (
              <div className="bg-[#111] border border-white/[0.06] rounded-2xl px-4 py-3">
                <p className="text-[10px] text-gray-600 text-center">
                  {totalClaimed} tasks claimed · {completedByClaiming.length} verified by AI · settled on World Chain
                </p>
              </div>
            )}
          </div>
        )}

        {/* Map view */}
        {mapMode && tab === "available" ? (
          <TaskMap
            tasks={tasks.filter(t => t.status === "open")}
            userLocation={userLocation}
            onSelectTask={(task) => {
              setSelectedTask(task);
              setView("detail");
            }}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center">
              {tab === "available" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              ) : tab === "mine" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {tab === "available" ? "No requests nearby yet" :
               tab === "mine" ? "You haven't posted or claimed anything" :
               "No completed tasks yet"}
            </p>
            {tab === "available" && (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={async () => {
                    await fetch("/api/seed", { method: "POST" });
                    fetchTasks();
                  }}
                  className="text-xs bg-[#111] border border-white/10 text-gray-300 px-4 py-2 rounded-xl hover:border-white/20 transition-all active:scale-95"
                >
                  Load demo tasks
                </button>
                <button
                  onClick={() => setView("post")}
                  className="text-xs text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors"
                >
                  Or post your own
                </button>
              </div>
            )}
          </div>
        ) : tab === "completed" ? (
          <div className="flex flex-col gap-4">
            {/* Gallery stats bar */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-gray-500">{filtered.length} completed</span>
              <span className="text-xs text-green-400 font-semibold">
                ${filtered.reduce((sum, t) => sum + t.bountyUsdc, 0).toFixed(2)} USDC settled
              </span>
            </div>
            {filtered.map((task, i) => (
              <div
                key={task.id}
                style={{ animationDelay: `${i * 60}ms` }}
                className="animate-[slideUp_0.3s_ease-out_both] rounded-2xl overflow-hidden bg-[#111] border border-white/[0.06] cursor-pointer active:scale-[0.98] transition-all"
                onClick={() => { setSelectedTask(task); setView("detail"); }}
              >
                {task.proofImageUrl && (
                  <div className="relative">
                    <img src={task.proofImageUrl} alt="Proof" className="w-full h-48 object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                      <div className="bg-green-500/20 backdrop-blur-sm border border-green-500/30 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] font-bold text-green-400">AI VERIFIED</span>
                      </div>
                      <span className="text-[11px] font-bold text-green-400 bg-black/40 backdrop-blur-sm rounded-lg px-2 py-1">
                        ${task.bountyUsdc} USDC
                      </span>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  <p className="font-medium text-[15px] leading-snug">{task.description}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {task.agent && <AgentBadge agent={task.agent} />}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="text-xs text-gray-500">{task.location}</span>
                    <span className="text-[10px] text-gray-700 mx-0.5">·</span>
                    <span className="text-xs text-gray-500">{timeAgo(task.createdAt)}</span>
                  </div>
                  {task.verificationResult && (
                    <div className="mt-3 pt-3 border-t border-white/[0.04]">
                      <p className="text-xs text-gray-400 leading-relaxed italic">&ldquo;{task.verificationResult.reasoning}&rdquo;</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] text-gray-600">
                          {shortId(task.poster)} → {task.claimant ? shortId(task.claimant) : "?"}
                        </span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[10px] text-green-500/70 font-medium">
                          {Math.round((task.verificationResult.confidence || 0) * 100)}% confidence
                        </span>
                        {task.attestationTxHash && (
                          <>
                            <span className="text-[10px] text-gray-700">·</span>
                            <a href={`https://worldscan.org/tx/${task.attestationTxHash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400/70">
                              on-chain →
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {!task.proofImageUrl && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] font-bold text-green-400">VERIFIED</span>
                      </div>
                      <span className="text-xs font-semibold text-green-400">${task.bountyUsdc} USDC</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((task, i) => (
              <div key={task.id} style={{ animationDelay: `${i * 50}ms` }} className="animate-[slideUp_0.3s_ease-out_both]">
                <TaskCard
                  task={task}
                  userId={userId}
                  userLocation={userLocation}
                  verificationLevel={verificationLevel}
                  onTap={() => {
                    setSelectedTask(task);
                    setView("detail");
                  }}
                  onClaim={async () => {
                    let claimCode: string | undefined;
                    if (task.claimCode) {
                      const code = prompt("This is a restricted bounty. Enter the claim code:");
                      if (!code) return;
                      claimCode = code;
                    }

                    if (MiniKit.isInstalled() && RELAY_ESCROW_ADDRESS && task.onChainId !== null) {
                      const txPayload = encodeClaimTask(task.onChainId);
                      if (txPayload) {
                        try {
                          const txResult = await MiniKit.sendTransaction(txPayload);
                          if (!txResult) {
                            alert("On-chain claim failed. Please try again.");
                            return;
                          }
                        } catch (err) {
                          alert("On-chain claim transaction rejected.");
                          return;
                        }
                      }
                    }
                    const res = await fetch(`/api/tasks/${task.id}/claim`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ claimant: userId, claimCode }),
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      if (err.requiresCode) {
                        alert("Wrong claim code. This bounty is restricted.");
                        return;
                      }
                      if (err.required) {
                        alert(`This task requires ${err.required} verification. Your level: ${err.current}. Upgrade your World ID to claim higher-bounty tasks.`);
                        return;
                      }
                    }
                    fetchTasks();
                  }}
                  onSubmitProof={() => {
                    setSelectedTask(task);
                    setView("proof");
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* XMTP Status + Powered by footer */}
      <div className="px-4 py-4 border-t border-white/[0.04]">
        {xmtpStatus && (
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <span className="relative flex h-2 w-2">
              {xmtpStatus.connected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              )}
            </span>
            <span className={`text-[10px] font-medium ${xmtpStatus.connected ? "text-green-400/70" : "text-red-400/70"}`}>
              {xmtpStatus.connected ? "XMTP Connected" : "XMTP Offline"}
            </span>
            {xmtpStatus.connected && xmtpStatus.inboxId && (
              <span className="text-[10px] text-gray-600 font-mono">
                {xmtpStatus.inboxId.slice(0, 8)}...{xmtpStatus.inboxId.slice(-4)}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-center gap-4">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <span className="text-[10px] text-gray-600">World ID</span>
          </div>
          <span className="text-gray-800">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="text-[10px] text-gray-600">XMTP</span>
          </div>
          <span className="text-gray-800">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
            <span className="text-[10px] text-gray-600">World Chain</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  userId,
  userLocation,
  verificationLevel,
  onTap,
  onClaim,
  onSubmitProof,
}: {
  task: Task;
  userId: string | null;
  userLocation?: { lat: number; lng: number } | null;
  verificationLevel?: string | null;
  onTap: () => void;
  onClaim: () => void;
  onSubmitProof: () => void;
}) {
  const isOwnTask = task.poster === userId;
  const isClaimant = task.claimant === userId;
  const distance = userLocation && task.lat && task.lng
    ? haversineKm(userLocation.lat, userLocation.lng, task.lat, task.lng)
    : null;

  const hoursLeft = (new Date(task.deadline).getTime() - Date.now()) / 3600_000;
  const isUrgent = task.status === "open" && (hoursLeft < 4 || task.bountyUsdc >= 15);

  return (
    <div
      onClick={onTap}
      className={`rounded-2xl p-4 flex flex-col gap-3 cursor-pointer active:scale-[0.98] transition-all ${
        isUrgent
          ? "bg-gradient-to-r from-red-500/[0.04] to-orange-500/[0.04] border border-red-500/20"
          : "bg-[#111] border border-white/[0.06]"
      }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">{CATEGORY_ICONS[task.category] || "✏️"}</span>
            {isUrgent && (
              <span className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5 uppercase tracking-wider">
                Urgent
              </span>
            )}
            <p className="font-medium text-[15px] leading-snug">{task.description}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{task.location}</span>
            {distance !== null && (
              <>
                <span className="text-[10px] text-gray-700 mx-0.5">·</span>
                <span className="text-xs text-blue-400 font-medium">{formatDistance(distance)}</span>
              </>
            )}
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-gray-600">{timeLeft(task.deadline)}</span>
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-1.5">
            <p className="font-bold text-green-400 text-sm leading-none">${task.bountyUsdc}</p>
            <p className="text-[9px] text-green-500/60 mt-0.5">USDC</p>
          </div>
          <TrustTier bounty={task.bountyUsdc} verificationLevel={verificationLevel} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {task.agent ? (
            <AgentBadge agent={task.agent} />
          ) : (
            <>
              {isOwnTask && <span className="text-[10px] text-gray-600">You posted</span>}
              {isClaimant && task.status === "claimed" && <span className="text-[10px] text-gray-600">You claimed</span>}
              <span className="flex items-center gap-0.5 text-[9px] text-cyan-500/60">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                World ID
              </span>
            </>
          )}
          {task.recurring && (
            <span className="flex items-center gap-0.5 text-[9px] text-orange-400/70 font-medium">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {task.recurring.completedRuns}/{task.recurring.totalRuns}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-700">{timeAgo(task.createdAt)}</span>
      </div>

      {task.verificationResult && (
        <div className={`text-xs p-3 rounded-xl ${
          task.verificationResult.verdict === "pass" ? "bg-green-500/8 text-green-300 border border-green-500/15" :
          task.verificationResult.verdict === "flag" ? "bg-yellow-500/8 text-yellow-300 border border-yellow-500/15" :
          "bg-red-500/8 text-red-300 border border-red-500/15"
        }`}>
          <span className="font-bold text-[11px] tracking-wide">{task.verificationResult.verdict === "pass" ? "VERIFIED" : task.verificationResult.verdict === "flag" ? "FLAGGED" : "REJECTED"}</span>
          <span className="text-gray-400 mx-1.5">—</span>
          <span className="opacity-80">{task.verificationResult.reasoning}</span>
        </div>
      )}

      {task.status === "open" && userId && !isOwnTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onClaim(); }}
          className={`px-4 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-all ${
            task.claimCode
              ? "bg-amber-600 hover:bg-amber-500 text-white"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {task.claimCode ? "🔒 Claim (Code Required)" : "Claim"}
        </button>
      )}

      {task.status === "claimed" && isClaimant && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-all"
        >
          Submit Proof
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    open: { bg: "text-blue-400", dot: "bg-blue-400", label: "Open" },
    claimed: { bg: "text-yellow-400", dot: "bg-yellow-400", label: "Claimed" },
    completed: { bg: "text-green-400", dot: "bg-green-400", label: "Done" },
    failed: { bg: "text-red-400", dot: "bg-red-400", label: "Failed" },
    expired: { bg: "text-gray-400", dot: "bg-gray-500", label: "Expired" },
  };

  const c = config[status] || config.expired;

  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-medium ${c.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} animate-[pulse-dot_2s_ease-in-out_infinite]`} />
      {c.label}
    </span>
  );
}

function AgentBadge({ agent }: { agent: AgentInfo }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 border"
      style={{
        backgroundColor: `${agent.color}10`,
        borderColor: `${agent.color}30`,
      }}
    >
      <span className="text-xs">{agent.icon}</span>
      <span className="text-[10px] font-bold tracking-wide" style={{ color: agent.color }}>
        {agent.name}
      </span>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={agent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    </div>
  );
}

function VerificationBadge({ level, size = "sm" }: { level?: string | null; size?: "sm" | "md" }) {
  if (!level) return null;
  const config: Record<string, { color: string; bg: string; label: string; tier: string }> = {
    orb: { color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", label: "Orb Verified", tier: "Tier 1" },
    device: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", label: "Device Verified", tier: "Tier 2" },
    wallet: { color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", label: "Verified", tier: "Tier 3" },
    dev: { color: "text-gray-500", bg: "bg-gray-500/10 border-gray-500/20", label: "Dev", tier: "" },
  };
  const c = config[level] || config.dev;

  if (size === "md") {
    return (
      <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border ${c.bg}`}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={c.color}>
          {level === "orb" ? (
            <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /></>
          ) : (
            <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
          )}
        </svg>
        <span className={`text-[10px] font-bold ${c.color}`}>{c.label}</span>
      </div>
    );
  }

  return (
    <span className={`text-[9px] font-semibold ${c.color} flex items-center gap-0.5`}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {level === "orb" ? (
          <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /></>
        ) : (
          <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
        )}
      </svg>
      {c.label}
    </span>
  );
}

function TrustTier({ bounty, verificationLevel }: { bounty: number; verificationLevel?: string | null }) {
  if (bounty < 10) return null;
  const requiredLevel = bounty >= 20 ? "orb" : "device";
  const levelRank: Record<string, number> = { orb: 3, device: 2, wallet: 1, dev: 0 };
  const userRank = levelRank[verificationLevel || "dev"] || 0;
  const requiredRank = levelRank[requiredLevel];
  const canClaim = userRank >= requiredRank;

  return (
    <div className={`flex items-center gap-1 text-[9px] font-medium ${canClaim ? "text-cyan-400" : "text-gray-600"}`}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      {bounty >= 20 ? "Orb required" : "Device+ required"}
    </div>
  );
}

function PostTask({
  userId,
  onDone,
  onCancel,
}: {
  userId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<"photo" | "delivery" | "check-in" | "custom">("photo");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [bounty, setBounty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleSubmit = async () => {
    if (!description || !location || !bounty || !userId) return;
    setSubmitting(true);

    let onChainId: number | null = null;
    let escrowTxHash: string | null = null;

    if (MiniKit.isInstalled() && RELAY_ESCROW_ADDRESS) {
      const txPayload = encodeCreateTask(description, parseFloat(bounty), 24);
      if (txPayload) {
        try {
          const countBefore = await readTaskCount();
          const txResult = await MiniKit.sendTransaction(txPayload);
          if (!txResult) {
            alert("Escrow deposit failed. Task not created.");
            setSubmitting(false);
            return;
          }
          onChainId = countBefore;
          escrowTxHash = typeof txResult === "object" && txResult !== null && "transactionHash" in txResult
            ? String((txResult as Record<string, unknown>).transactionHash)
            : null;
        } catch (err) {
          alert("Escrow transaction rejected. USDC deposit required to post a task.");
          setSubmitting(false);
          return;
        }
      }
    }

    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poster: userId,
        category,
        description,
        location,
        lat: coords?.lat || null,
        lng: coords?.lng || null,
        bountyUsdc: parseFloat(bounty),
        deadlineHours: 24,
        onChainId,
        escrowTxHash,
      }),
    });
    onDone();
  };

  const isValid = description && location && bounty;

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
        <span className="text-sm font-semibold">New Request</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-5">
        {/* Quick templates */}
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Quick Start</label>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            {TASK_TEMPLATES.map((t) => (
              <button
                key={t.label}
                onClick={() => {
                  setCategory(t.category);
                  setDescription(t.description);
                  setBounty(String(t.bounty));
                }}
                className="shrink-0 flex items-center gap-1.5 bg-[#111] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-gray-400 hover:text-white hover:border-white/15 transition-all active:scale-95"
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category picker */}
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Category</label>
          <div className="flex gap-2">
            {([
              { key: "photo" as const, icon: "📸", label: "Photo" },
              { key: "delivery" as const, icon: "📦", label: "Delivery" },
              { key: "check-in" as const, icon: "📍", label: "Check-in" },
              { key: "custom" as const, icon: "✏️", label: "Custom" },
            ]).map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  category === c.key
                    ? "bg-white text-black"
                    : "bg-[#111] text-gray-400 border border-white/[0.06]"
                }`}
              >
                <span className="text-base">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">What do you need?</label>
          <textarea
            placeholder="Take a photo of the menu board at Blue Bottle on Rue de Rivoli"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-[#111] border border-white/[0.06] rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Location</label>
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <input
              type="text"
              placeholder="City or neighborhood"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Bounty</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">$</span>
            <input
              type="number"
              placeholder="5"
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl pl-8 pr-16 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-600 font-medium">USDC</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!isValid || submitting}
          className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
            isValid ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]" : "bg-gray-800 text-gray-500"
          } disabled:opacity-50`}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Posting...
            </span>
          ) : `Post Request${bounty ? ` — $${bounty} USDC` : ""}`}
        </button>
      </div>
    </div>
  );
}

function SubmitProof({
  task,
  onDone,
  onCancel,
}: {
  task: Task;
  onDone: () => void;
  onCancel: () => void;
}) {
  const MAX_PHOTOS = 3;
  const [proofNote, setProofNote] = useState("");
  const [images, setImages] = useState<{ base64: string; preview: string; isVideo: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ verdict: string; reasoning: string; locationVerified?: boolean; distanceKm?: number } | null>(null);
  const [proofCoords, setProofCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setProofCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const extractVideoFrame = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;
      video.onloadeddata = () => {
        video.currentTime = 0.5;
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Video load failed")); };
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = "";

    if (file.type.startsWith("video/")) {
      try {
        const dataUrl = await extractVideoFrame(file);
        setImages((prev) => [...prev, { base64: dataUrl.split(",")[1], preview: dataUrl, isVideo: true }]);
      } catch {
        console.error("Failed to extract video frame");
      }
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setImages((prev) => [...prev, { base64: dataUrl.split(",")[1], preview: dataUrl, isVideo: false }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (images.length === 0) return;
    setSubmitting(true);

    const proofImages = images.map((img) => img.base64);

    const res = await fetch("/api/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        proofImageBase64: proofImages[0],
        proofImages,
        proofNote: proofNote || null,
        lat: proofCoords?.lat || null,
        lng: proofCoords?.lng || null,
      }),
    });

    const data = await res.json();
    setResult({
      ...data.verification,
      locationVerified: data.locationVerified,
      distanceKm: data.distanceKm,
    });
    setSubmitting(false);

    if (data.verification.verdict === "pass") {
      setTimeout(onDone, 2500);
    }
  };

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
        <span className="text-sm font-semibold">Submit Proof</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4">
        {/* Task context */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">Task</p>
          <p className="text-sm font-medium leading-snug">{task.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{task.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-green-400 font-semibold">${task.bountyUsdc} USDC</span>
          </div>
        </div>

        {/* Photo upload — multi-image */}
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">
            Proof Photos ({images.length}/{MAX_PHOTOS})
          </label>

          {images.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <div key={i} className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-white/[0.06]">
                  <img src={img.preview} alt={`Proof ${i + 1}`} className="w-full h-full object-cover" />
                  {img.isVideo && (
                    <div className="absolute bottom-1 left-1 bg-black/70 rounded px-1 py-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-[10px] font-bold hover:bg-red-500/80 transition-colors"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {images.length < MAX_PHOTOS && (
            <label className="flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl p-8 cursor-pointer hover:border-white/20 transition-all bg-[#111]/50 active:scale-[0.99]">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <span className="text-sm text-gray-400">
                {images.length === 0 ? "Take photo or choose from library" : "Add another photo"}
              </span>
              <span className="text-[10px] text-gray-600 mt-1">Photos or video accepted</span>
              <input
                type="file"
                accept="image/*,video/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          )}
        </div>

        <input
          type="text"
          placeholder="Add a note (optional)"
          value={proofNote}
          onChange={(e) => setProofNote(e.target.value)}
          className="bg-[#111] border border-white/[0.06] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
        />

        {/* Verification spinner */}
        {submitting && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="w-12 h-12 border-2 border-purple-500/30 rounded-full" />
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin absolute inset-0" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Verifying proof...</p>
              <p className="text-xs text-gray-500 mt-1">AI is analyzing your photo{images.length > 1 ? "s" : ""}</p>
            </div>
          </div>
        )}

        {/* Verdict result */}
        {result && (
          <div className={`p-5 rounded-2xl text-sm border animate-[fadeIn_0.3s_ease-out] ${
            result.verdict === "pass" ? "bg-green-500/8 border-green-500/20" :
            result.verdict === "flag" ? "bg-yellow-500/8 border-yellow-500/20" :
            "bg-red-500/8 border-red-500/20"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              {result.verdict === "pass" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : result.verdict === "flag" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <span className={`font-bold text-lg tracking-tight ${
                result.verdict === "pass" ? "text-green-400" :
                result.verdict === "flag" ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {result.verdict === "pass" ? "VERIFIED" : result.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{result.reasoning}</p>
            {result.locationVerified !== undefined && result.locationVerified !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={result.locationVerified ? "#4ade80" : "#f59e0b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className={`text-[11px] font-medium ${result.locationVerified ? "text-green-400" : "text-yellow-400"}`}>
                  {result.locationVerified ? "Location verified" : "Location not confirmed"}
                  {result.distanceKm !== undefined && result.distanceKm !== null && (
                    <span className="text-gray-500 font-normal"> · {result.distanceKm < 1 ? `${Math.round(result.distanceKm * 1000)}m` : `${result.distanceKm.toFixed(1)}km`} from task</span>
                  )}
                </span>
              </div>
            )}
            {result.verdict === "pass" && (
              <div className="mt-3 pt-3 border-t border-green-500/15">
                <p className="font-semibold text-sm text-green-400">${task.bountyUsdc} USDC released</p>
              </div>
            )}
            {result.verdict === "flag" && (
              <p className="mt-2 text-xs text-yellow-400/70">Waiting for poster to review...</p>
            )}
            {result.verdict === "fail" && (
              <p className="mt-2 text-xs text-red-400/70">Task reopened for new claims.</p>
            )}
          </div>
        )}
      </div>

      {!result && !submitting && (
        <div className="px-4 pb-8 pt-2">
          <button
            onClick={handleSubmit}
            disabled={images.length === 0}
            className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
              images.length > 0 ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-500"
            } disabled:opacity-50`}
          >
            Submit for Verification
          </button>
        </div>
      )}
    </div>
  );
}

function TaskTimeline({ task }: { task: Task }) {
  const steps = [
    {
      label: "Posted",
      time: task.createdAt,
      done: true,
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
    {
      label: "Claimed",
      time: task.claimant ? task.createdAt : null,
      done: !!task.claimant,
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
        </svg>
      ),
    },
    {
      label: "Proof",
      time: task.proofImageUrl ? task.createdAt : null,
      done: !!task.proofImageUrl,
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
        </svg>
      ),
    },
    {
      label: task.verificationResult?.verdict === "pass" ? "Verified" : task.verificationResult?.verdict === "flag" ? "Flagged" : task.verificationResult ? "Rejected" : "AI Review",
      time: task.verificationResult ? task.createdAt : null,
      done: !!task.verificationResult,
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
        </svg>
      ),
    },
    {
      label: "Settled",
      time: task.status === "completed" ? task.createdAt : null,
      done: task.status === "completed",
      icon: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
  ];

  const currentStepIndex = steps.findIndex(s => !s.done);
  const activeIndex = currentStepIndex === -1 ? steps.length - 1 : currentStepIndex;

  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
      <div className="flex items-center justify-between">
        {steps.map((step, i) => {
          const isActive = i === activeIndex && !step.done;
          const isDone = step.done;
          const isFlagged = step.label === "Flagged";
          const isRejected = step.label === "Rejected";
          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isDone
                    ? isFlagged ? "bg-yellow-500/20 text-yellow-400" :
                      isRejected ? "bg-red-500/20 text-red-400" :
                      "bg-green-500/20 text-green-400"
                    : isActive
                    ? "bg-blue-500/20 text-blue-400 animate-[pulse-dot_2s_ease-in-out_infinite]"
                    : "bg-white/5 text-gray-600"
                }`}>
                  {step.icon}
                </div>
                <span className={`text-[9px] font-medium ${
                  isDone ? isFlagged ? "text-yellow-400" : isRejected ? "text-red-400" : "text-green-400"
                  : isActive ? "text-blue-400" : "text-gray-600"
                }`}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-1.5 ${
                  i < activeIndex ? "bg-green-500/30" : "bg-white/5"
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ThreadMessage = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
};

function TaskDetail({
  task,
  userId,
  onBack,
  onSubmitProof,
}: {
  task: Task;
  userId: string | null;
  onBack: () => void;
  onSubmitProof: () => void;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [currentTask, setCurrentTask] = useState(task);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showProofImage, setShowProofImage] = useState(false);
  const [swapToken, setSwapToken] = useState<SwapToken>("USDC");
  const [swapping, setSwapping] = useState(false);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const isClaimant = currentTask.claimant === userId;
  const isPoster = currentTask.poster === userId;
  const isParticipant = isClaimant || isPoster;
  const isFlagged = currentTask.verificationResult?.verdict === "flag" && currentTask.status === "claimed";
  const hasFollowUp = currentTask.aiFollowUp?.status === "pending";
  const messagesEndRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/tasks/${task.id}/messages`);
    const data = await res.json();
    setMessages(data.messages || []);
  }, [task.id]);

  const fetchTask = useCallback(async () => {
    const res = await fetch(`/api/tasks`);
    const data = await res.json();
    const updated = data.tasks?.find((t: Task) => t.id === task.id);
    if (updated) setCurrentTask(updated);
  }, [task.id]);

  useEffect(() => {
    fetchMessages();
    fetchTask();
    const interval = setInterval(() => { fetchMessages(); fetchTask(); }, 2000);
    return () => clearInterval(interval);
  }, [fetchMessages, fetchTask]);

  const sendMessage = async () => {
    if (!chatInput.trim() || !userId || sending) return;
    setSending(true);
    await fetch(`/api/tasks/${task.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: userId, text: chatInput.trim() }),
    });
    setChatInput("");
    setSending(false);
    fetchMessages();
  };

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <StatusBadge status={currentTask.status} />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4 overflow-y-auto">
        {/* Task info */}
        <div>
          <p className="font-semibold text-lg leading-snug">{currentTask.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{currentTask.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-green-400 font-semibold">${currentTask.bountyUsdc} USDC</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-gray-500">{timeLeft(currentTask.deadline)}</span>
          </div>
        </div>

        {/* Lifecycle timeline */}
        <TaskTimeline task={currentTask} />

        {/* Agent info or People */}
        {currentTask.agent ? (
          <div className="rounded-xl p-4 border" style={{ backgroundColor: `${currentTask.agent.color}08`, borderColor: `${currentTask.agent.color}20` }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: `${currentTask.agent.color}15` }}>
                {currentTask.agent.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: currentTask.agent.color }}>{currentTask.agent.name}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={currentTask.agent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">AI Agent · Needs verified human</p>
              </div>
            </div>
            {currentTask.claimant && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: `${currentTask.agent.color}15` }}>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Claimed by</p>
                <p className="text-xs font-medium">{shortId(currentTask.claimant)}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-3">
            <div className="flex-1 bg-[#111] rounded-xl p-3 border border-white/[0.06]">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Poster</p>
              <p className="text-xs font-medium">{shortId(currentTask.poster)}</p>
            </div>
            {currentTask.claimant && (
              <div className="flex-1 bg-[#111] rounded-xl p-3 border border-white/[0.06]">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Claimant</p>
                <p className="text-xs font-medium">{shortId(currentTask.claimant)}</p>
              </div>
            )}
          </div>
        )}

        {/* Proof image */}
        {currentTask.proofImageUrl && (
          <div>
            <button
              onClick={() => setShowProofImage(!showProofImage)}
              className="flex items-center gap-2 text-xs text-purple-400 font-medium"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {showProofImage ? "Hide proof photo" : "View proof photo"}
            </button>
            {showProofImage && (
              <div className="mt-2 rounded-2xl overflow-hidden border border-white/[0.06] animate-[fadeIn_0.2s_ease-out]">
                <img src={currentTask.proofImageUrl} alt="Proof" className="w-full max-h-80 object-cover" />
                {currentTask.proofNote && (
                  <div className="bg-[#111] px-4 py-2 border-t border-white/[0.06]">
                    <p className="text-xs text-gray-400 italic">&ldquo;{currentTask.proofNote}&rdquo;</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Verification result */}
        {currentTask.verificationResult && (
          <div className={`p-4 rounded-2xl border ${
            currentTask.verificationResult.verdict === "pass" ? "bg-green-500/8 border-green-500/20" :
            currentTask.verificationResult.verdict === "flag" ? "bg-yellow-500/8 border-yellow-500/20" :
            "bg-red-500/8 border-red-500/20"
          }`}>
            <div className="flex items-center gap-2 mb-1.5">
              {currentTask.verificationResult.verdict === "pass" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              ) : currentTask.verificationResult.verdict === "flag" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <span className={`font-bold text-sm tracking-tight ${
                currentTask.verificationResult.verdict === "pass" ? "text-green-400" :
                currentTask.verificationResult.verdict === "flag" ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {currentTask.verificationResult.verdict === "pass" ? "VERIFIED" : currentTask.verificationResult.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{currentTask.verificationResult.reasoning}</p>
            {currentTask.verificationResult.verdict === "pass" && (
              <div className="mt-2 pt-2 border-t border-green-500/15">
                <p className="text-xs text-green-400 font-semibold">${currentTask.bountyUsdc} USDC released</p>
              </div>
            )}
            {currentTask.attestationTxHash && (
              <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <a
                  href={`https://worldscan.org/tx/${currentTask.attestationTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-400 underline underline-offset-2"
                >
                  On-chain attestation →
                </a>
              </div>
            )}
          </div>
        )}

        {/* On-chain release — poster confirms settlement */}
        {currentTask.status === "completed" && isPoster && MiniKit.isInstalled() && RELAY_ESCROW_ADDRESS && currentTask.onChainId !== null && (
          <button
            onClick={async () => {
              const txPayload = encodeReleasePayment(currentTask.onChainId!);
              if (txPayload) {
                try {
                  const result = await MiniKit.sendTransaction(txPayload);
                  if (!result) {
                    alert("Release transaction failed.");
                  }
                } catch {
                  alert("Release transaction rejected.");
                }
              }
            }}
            className="bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Release ${currentTask.bountyUsdc} USDC
            <span className="text-[10px] opacity-70 font-normal">via World Chain</span>
          </button>
        )}

        {/* Uniswap swap — claimant can convert received USDC */}
        {currentTask.status === "completed" && isClaimant && MiniKit.isInstalled() && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <span className="text-xs font-semibold text-white">Swap Earnings</span>
              <span className="text-[10px] text-gray-600 ml-auto">via Uniswap V3</span>
            </div>
            <div className="flex gap-2 mb-3">
              {(["USDC", "WETH", "WLD"] as SwapToken[]).map((token) => (
                <button
                  key={token}
                  onClick={() => setSwapToken(token)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
                    swapToken === token
                      ? "bg-white text-black"
                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {token}
                </button>
              ))}
            </div>
            {swapToken !== "USDC" ? (
              <button
                onClick={async () => {
                  if (!userId?.startsWith("0x")) return;
                  setSwapping(true);
                  const txPayload = encodeUniswapSwap(currentTask.bountyUsdc, swapToken, userId as `0x${string}`);
                  if (txPayload) {
                    try { await MiniKit.sendTransaction(txPayload); } catch {}
                  }
                  setSwapping(false);
                }}
                disabled={swapping}
                className="w-full bg-pink-600 hover:bg-pink-500 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {swapping ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Swap ${currentTask.bountyUsdc} USDC → {swapToken}</>
                )}
              </button>
            ) : (
              <p className="text-xs text-gray-500 text-center py-1">Select a token to swap your USDC earnings</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        {currentTask.status === "claimed" && isClaimant && !isFlagged && !hasFollowUp && (
          <button
            onClick={onSubmitProof}
            className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
          >
            Submit Proof
          </button>
        )}

        {/* AI Follow-up: claimant can respond and request re-evaluation */}
        {hasFollowUp && isClaimant && (
          <div className="bg-purple-500/8 border border-purple-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-sm font-semibold text-purple-400">AI needs more info</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">Reply to the AI&apos;s question in the thread below, then tap re-evaluate.</p>
            <button
              onClick={async () => {
                setReEvaluating(true);
                const res = await fetch(`/api/tasks/${currentTask.id}/followup`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.task) setCurrentTask(data.task);
                fetchMessages();
                setReEvaluating(false);
              }}
              disabled={reEvaluating}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {reEvaluating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  AI re-evaluating...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Re-evaluate Proof
                </>
              )}
            </button>
          </div>
        )}

        {isFlagged && isPoster && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-yellow-400/70 text-center">AI flagged this proof. Your call — or let AI mediate.</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const res = await fetch(`/api/tasks/${currentTask.id}/confirm`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ poster: userId, approved: true }),
                  });
                  const data = await res.json();
                  if (data.task) setCurrentTask(data.task);
                  fetchMessages();
                }}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
              >
                Approve
              </button>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/tasks/${currentTask.id}/confirm`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ poster: userId, approved: false }),
                  });
                  const data = await res.json();
                  if (data.task) setCurrentTask(data.task);
                  fetchMessages();
                }}
                className="flex-1 bg-red-600/80 hover:bg-red-600 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
              >
                Reject
              </button>
            </div>
            <button
              onClick={async () => {
                setDisputing(true);
                const res = await fetch(`/api/tasks/${currentTask.id}/dispute`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ poster: userId }),
                });
                const data = await res.json();
                if (data.task) setCurrentTask(data.task);
                fetchMessages();
                setDisputing(false);
              }}
              disabled={disputing}
              className="w-full bg-indigo-600/80 hover:bg-indigo-600 text-white py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {disputing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  AI analyzing thread...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                  </svg>
                  AI Mediate — Let AI decide
                </>
              )}
            </button>
          </div>
        )}

        {/* XMTP Thread */}
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Thread</span>
            <span className="flex-1 h-px bg-white/5" />
            <div className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span className="text-[10px] text-indigo-400/70">XMTP Encrypted</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-[pulse-dot_2s_ease-in-out_infinite]" />
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-gray-600">No messages yet</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isAiBriefing = msg.sender === "relay-bot" && msg.text.includes("AI BRIEFING");
              const isAiFollowUp = msg.sender === "relay-bot" && msg.text.includes("AI FOLLOW-UP");
              const isAiDispute = msg.sender === "relay-bot" && msg.text.includes("DISPUTE RESOLUTION");
              const isAiReEval = msg.sender === "relay-bot" && msg.text.includes("RE-EVALUATION");
              const isAiMessage = isAiBriefing || isAiFollowUp || isAiDispute || isAiReEval;

              return (
                <div
                  key={msg.id}
                  className={`rounded-xl p-3 ${
                    isAiMessage
                      ? "bg-gradient-to-br from-purple-500/8 to-indigo-500/8 border border-purple-500/20"
                      : msg.sender === "relay-bot"
                      ? "bg-[#111] border border-white/[0.06]"
                      : msg.sender === userId
                      ? "bg-blue-600/10 border border-blue-500/15 ml-6"
                      : "bg-[#111] border border-white/[0.06] mr-6"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-semibold flex items-center gap-1 ${
                      isAiMessage ? "text-purple-400" :
                      msg.sender === "relay-bot" ? "text-purple-400" :
                      msg.sender === userId ? "text-blue-400" : "text-gray-400"
                    }`}>
                      {isAiMessage && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
                        </svg>
                      )}
                      {msg.sender === "relay-bot" ? (isAiMessage ? "RELAY AI" : "RELAY") : msg.sender === userId ? "You" : shortId(msg.sender)}
                    </span>
                    <span className="text-[10px] text-gray-700">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 whitespace-pre-line leading-relaxed">{msg.text}</p>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Chat input */}
      {isParticipant && currentTask.status !== "completed" && currentTask.status !== "failed" && (
        <div className="sticky bottom-0 bg-[#050505] border-t border-white/5 px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={hasFollowUp && isClaimant ? "Reply to AI's question..." : "Message..."}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              className={`flex-1 bg-[#111] border rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors placeholder:text-gray-600 ${
                hasFollowUp && isClaimant ? "border-purple-500/30 focus:border-purple-500/50" : "border-white/[0.06] focus:border-white/20"
              }`}
            />
            <button
              onClick={sendMessage}
              disabled={!chatInput.trim() || sending}
              className="bg-blue-600 text-white px-4 rounded-xl text-sm font-medium disabled:opacity-30 active:scale-95 transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
