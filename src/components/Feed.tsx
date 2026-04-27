"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { MiniKit } from "@worldcoin/minikit-js";
import type { Task, AgentInfo } from "@/lib/types";

function isMiniKit(): boolean {
  try { return typeof window !== "undefined" && MiniKit.isInstalled(); } catch { return false; }
}
import { VerificationBadge, RequiredTierBadge } from "@/components/VerificationBadge";
import { FeedbackTasks } from "@/components/FeedbackTasks";
import { ProofOfFavourCard } from "@/components/ProofOfFavourCard";
import { encodeCreateTask, encodeClaimTask, encodeReleasePayment, encodeUniswapSwap, readTaskCount, RELAY_ESCROW_ADDRESS, DOUBLE_OR_NOTHING_ADDRESS, encodeCreateDoubleOrNothing, encodeStakeAndClaimWithApproval, readDonTaskCount, type SwapToken } from "@/lib/contracts";
import { hapticSuccess, hapticError, hapticTap, hapticHeavy, hapticMedium, hapticSelection, shareTask } from "@/lib/minikit-helpers";
import { TASK_TEMPLATES } from "@/lib/agents";
// Plain Tailwind buttons — @worldcoin/mini-apps-ui-kit-react causes hydration crashes

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

function rewardLabel(task: Task): string {
  if (task.escrowTxHash) return `$${task.bountyUsdc} USDC`;
  return `${task.bountyUsdc * 10} pts`;
}

const CATEGORY_ICONS: Record<string, string> = {
  photo: "📸",
  delivery: "📦",
  "check-in": "📍",
  custom: "✏️",
  feedback: "💬",
};

function SkeletonCard() {
  const shimmerBg = "bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 animate-[shimmer_1.5s_infinite]";
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 bg-white border border-gray-100 shadow-sm">
      <div className="flex items-start gap-1.5">
        <div className={`w-5 h-5 rounded shrink-0 mt-0.5 ${shimmerBg}`} />
        <div className="flex-1 flex flex-col gap-1.5">
          <div className={`h-4 rounded-md w-full ${shimmerBg}`} />
          <div className={`h-4 rounded-md w-3/4 ${shimmerBg}`} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className={`w-3 h-3 rounded-full shrink-0 ${shimmerBg}`} />
        <div className={`h-3 rounded-md w-28 ${shimmerBg}`} />
        <div className={`h-3 rounded-md w-12 ${shimmerBg}`} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-6 rounded-full w-14 ${shimmerBg}`} />
          <div className={`h-6 rounded-lg w-20 ${shimmerBg}`} />
        </div>
        <div className={`h-10 rounded-xl w-16 ${shimmerBg}`} />
      </div>
    </div>
  );
}

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
        text: `${t.agent ? t.agent.name : shortId(t.poster)} favour verified${t.verificationResult.confidence ? ` · ${Math.round(t.verificationResult.confidence * 100)}%` : ""}`,
        color: "text-green-600",
        time: timeAgo(t.createdAt),
      });
    }
    if (t.claimant) {
      events.push({
        icon: "⚡",
        text: `${shortId(t.claimant)} claimed ${t.agent ? t.agent.name : ""} favour · $${t.bountyUsdc}`,
        color: "text-blue-600",
        time: timeAgo(t.createdAt),
      });
    }
    if (t.agent && t.status === "open") {
      events.push({
        icon: t.agent.icon,
        text: `${t.agent.name} posted a favour · ${t.location}`,
        color: "text-gray-400",
        time: timeAgo(t.createdAt),
      });
    }
  }

  if (events.length === 0) return null;

  return (
    <div className="overflow-hidden px-4 py-2">
      <div className="flex gap-6 overflow-x-auto no-scrollbar">
        {events.map((ev, i) => (
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

const RELAY_BOT_ADDRESS = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";

export function Feed({ userId, verificationLevel, onLogout }: { userId: string | null; verificationLevel?: string | null; onLogout?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<"board" | "post" | "proof" | "detail">("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<Tab>("available");
  const [mapMode, setMapMode] = useState(false);
  const [agentFilter] = useState<"all">("all");
  const [xmtpStatus, setXmtpStatus] = useState<{ connected: boolean; inboxId: string | null } | null>(null);
  const [botAddrCopied, setBotAddrCopied] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [chatReply, setChatReply] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ required: string; current: string } | null>(null);
  const [claimTxSuccess, setClaimTxSuccess] = useState<{ hash: string; taskId: string } | null>(null);
  const [claimTxError, setClaimTxError] = useState<{ message: string; taskId: string; retry: () => void } | null>(null);
  const [newTaskToast, setNewTaskToast] = useState<{ count: number; visible: boolean }>({ count: 0, visible: false });
  const [statusToast, setStatusToast] = useState<{ message: string; color: string; visible: boolean }>({ message: "", color: "", visible: false });
  const [changedTaskIds, setChangedTaskIds] = useState<Set<string>>(new Set());
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);
  const sseReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownTaskIds = useRef<Set<string>>(new Set());
  const prevTaskStatuses = useRef<Map<string, string>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);
  const userLocation = useUserLocation();

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    const incoming: Task[] = data.tasks;

    // Detect genuinely new task IDs
    if (knownTaskIds.current.size > 0) {
      const newIds = incoming.filter((t) => !knownTaskIds.current.has(t.id));
      if (newIds.length > 0) {
        // Clear any existing dismiss timer
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setNewTaskToast({ count: newIds.length, visible: true });
        toastTimer.current = setTimeout(() => {
          setNewTaskToast((prev) => ({ ...prev, visible: false }));
        }, 3000);
      }
    }

    // Detect status changes (open->claimed, claimed->completed)
    if (prevTaskStatuses.current.size > 0) {
      const changed: string[] = [];
      let statusMsg = "";
      let statusColor = "";

      for (const task of incoming) {
        const prevStatus = prevTaskStatuses.current.get(task.id);
        if (prevStatus && prevStatus !== task.status) {
          changed.push(task.id);
          if (prevStatus === "open" && task.status === "claimed") {
            statusMsg = `Favour claimed: "${task.description.slice(0, 40)}${task.description.length > 40 ? "..." : ""}"`;
            statusColor = "text-yellow-600";
          } else if (prevStatus === "claimed" && task.status === "completed") {
            statusMsg = `Favour completed: "${task.description.slice(0, 40)}${task.description.length > 40 ? "..." : ""}"`;

            statusColor = "text-green-600";
          }
        }
      }

      if (changed.length > 0) {
        setChangedTaskIds(new Set(changed));
        setTimeout(() => setChangedTaskIds(new Set()), 2000);
      }

      if (statusMsg) {
        if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
        setStatusToast({ message: statusMsg, color: statusColor, visible: true });
        statusToastTimer.current = setTimeout(() => {
          setStatusToast((prev) => ({ ...prev, visible: false }));
        }, 4000);
      }
    }

    // Update the known set and previous statuses
    knownTaskIds.current = new Set(incoming.map((t) => t.id));
    prevTaskStatuses.current = new Map(incoming.map((t) => [t.id, t.status]));
    setTasks(incoming);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);

    // Trigger XMTP sync every 30s so DMs get processed in near-real-time
    // (Vercel hobby cron is daily — this compensates)
    const syncXmtp = () => fetch("/api/xmtp-sync", { method: "POST" }).catch(() => {});
    syncXmtp();
    const syncInterval = setInterval(syncXmtp, 30_000);

    return () => {
      clearInterval(interval);
      clearInterval(syncInterval);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
    };
  }, [fetchTasks]);

  // SSE: real-time refresh trigger (only in board view)
  useEffect(() => {
    if (view !== "board") {
      // Clean up if we leave board view
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
        setSseConnected(false);
      }
      return;
    }

    function connect() {
      if (sseRef.current) {
        sseRef.current.close();
      }
      const es = new EventSource("/api/events");
      sseRef.current = es;

      es.onopen = () => {
        setSseConnected(true);
      };

      es.onmessage = () => {
        // Any message (including unnamed events) triggers a refresh
        fetchTasks();
      };

      // Listen for all named task events as refresh signals
      const eventTypes = ["task:created", "task:claimed", "task:proof", "task:verified", "task:completed", "task:failed"];
      for (const type of eventTypes) {
        es.addEventListener(type, () => {
          fetchTasks();
        });
      }

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        sseRef.current = null;
        // Reconnect after 5 seconds
        sseReconnectTimer.current = setTimeout(() => {
          connect();
        }, 5000);
      };
    }

    connect();

    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (sseReconnectTimer.current) {
        clearTimeout(sseReconnectTimer.current);
        sseReconnectTimer.current = null;
      }
      setSseConnected(false);
    };
  }, [view, fetchTasks]);

  useEffect(() => {
    fetch("/api/xmtp-status")
      .then((res) => res.json())
      .then((data) => setXmtpStatus({ connected: data.connected, inboxId: data.inboxId }))
      .catch(() => setXmtpStatus({ connected: false, inboxId: null }));

    if (isMiniKit()) {
      setNotificationsEnabled(true);
    }
  }, []);

  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = feedContainerRef.current;
    if (!container || container.scrollTop > 0) return;
    touchStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;
    const container = feedContainerRef.current;
    if (!container || container.scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.5, 100));
    }
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD * 0.5);
      await fetchTasks();
      setIsRefreshing(false);
    }
    setPullDistance(0);
  }, [pullDistance, isRefreshing, fetchTasks]);

  const filtered = tasks.filter((t) => {
    if (tab === "available") {
      // Hide unfunded dev/demo junk — only show funded tasks or user's own claims
      if (t.status === "open") {
        if (!t.escrowTxHash && t.category !== "feedback") return false;
      }
      else if (t.status === "claimed" && t.claimant === userId) { /* show my active claims */ }
      else return false;
      return true;
    }
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
      const aFunded = !!a.escrowTxHash;
      const bFunded = !!b.escrowTxHash;
      if (aFunded !== bFunded) return aFunded ? -1 : 1;
      if (userLocation && a.lat && a.lng && b.lat && b.lng) {
        return haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng)
             - haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
      }
    }
    return 0;
  });

  const [heroVisible, setHeroVisible] = useState(true);
  const myTaskCount = tasks.filter(t => t.poster === userId || t.claimant === userId).length;
  const completedByClaiming = tasks.filter(t => t.claimant === userId && t.status === "completed");
  const totalEarned = completedByClaiming.reduce((sum, t) => sum + t.bountyUsdc, 0);
  const totalPosted = tasks.filter(t => t.poster === userId).length;
  const totalClaimed = tasks.filter(t => t.claimant === userId).length;

  async function handleChatQuery() {
    if (!chatQuery.trim() || chatLoading) return;
    setChatLoading(true);
    setChatReply("");
    try {
      const res = await fetch("/api/xmtp-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: chatQuery }),
      });
      const data = await res.json();
      setChatReply(data.response || "No response.");
    } catch {
      setChatReply("Something went wrong.");
    }
    setChatLoading(false);
  }

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

  return (
    <div
      ref={feedContainerRef}
      className="flex flex-col gap-0 max-w-lg mx-auto w-full min-h-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-gray-100">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight leading-none">RELAY FAVOURS</h1>
                {notificationsEnabled && (
                  <span className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="#22c55e" stroke="none">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    <span className="text-[8px] font-medium text-green-600">ON</span>
                  </span>
                )}
                <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5" title={sseConnected ? "Real-time updates active" : "Real-time updates disconnected"}>
                  <span className={`inline-flex rounded-full h-1.5 w-1.5 ${sseConnected ? "bg-green-500" : "bg-gray-600"}`} />
                  <span className={`text-[8px] font-medium ${sseConnected ? "text-green-600" : "text-gray-600"}`}>
                    {sseConnected ? "Live" : ""}
                  </span>
                </span>
              </div>
              {userId && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <button onClick={onLogout} className="text-[10px] text-gray-500 hover:text-gray-900 transition-colors leading-none min-h-[44px] flex items-center">
                    {shortId(userId)}
                  </button>
                  <VerificationBadge level={verificationLevel} />
                </div>
              )}
            </div>
          </div>
          {userId && (
            <div className="flex items-center gap-2 mt-0.5">
              <button
                onClick={() => { hapticTap(); setView("post"); }}
                className="shrink-0 bg-black hover:bg-gray-800 text-white text-sm font-medium rounded-xl px-4 py-2 transition-colors active:scale-[0.97]"
              >
                + Request
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-0 items-center">
          {(["available", "mine", "completed"] as Tab[]).map((t) => {
            const label = t === "available" ? "Favours" : t === "mine" ? "Mine" : "History";
            const count = t === "mine" ? myTaskCount : null;
            return (
              <button
                key={t}
                onClick={() => { hapticSelection(); setTab(t); }}
                className={`flex-1 text-xs min-h-[44px] py-2.5 font-medium transition-all relative flex items-center justify-center ${
                  tab === t ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {label}
                {count !== null && count > 0 && (
                  <span className="ml-1 text-[10px] text-gray-500">{count}</span>
                )}
                {tab === t && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-gray-900 rounded-full" />
                )}
              </button>
            );
          })}
          {tab === "available" && (
            <button
              onClick={() => setMapMode(!mapMode)}
              className={`ml-1 min-w-[44px] min-h-[44px] p-2.5 rounded-lg transition-all flex items-center justify-center ${mapMode ? "bg-gray-100 text-gray-900" : "text-gray-500 hover:text-gray-900"}`}
              aria-label={mapMode ? "Switch to list view" : "Switch to map view"}
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

      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200 ease-out"
        style={{ height: pullDistance > 0 || isRefreshing ? `${Math.max(pullDistance, isRefreshing ? 40 : 0)}px` : "0px" }}
      >
        {isRefreshing ? (
          <svg className="w-5 h-5 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : pullDistance > 0 ? (
          <div className="flex flex-col items-center gap-1">
            <svg
              className="w-4 h-4 text-gray-500 transition-transform duration-150"
              style={{ transform: pullDistance >= 60 ? "rotate(180deg)" : "rotate(0deg)" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <span className="text-[10px] text-gray-600">
              {pullDistance >= 60 ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        ) : null}
      </div>

      {/* Scroll anchor for "new tasks" toast */}
      <div ref={feedTopRef} />

      {/* New tasks toast */}
      {newTaskToast.visible && newTaskToast.count > 0 && (
        <div className="px-4 pt-2">
          <button
            onClick={() => {
              feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
              setNewTaskToast({ count: 0, visible: false });
            }}
            className="w-full animate-[slideDown_0.3s_ease-out] bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors active:scale-[0.98]"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            <span className="text-xs font-medium text-blue-600">
              {newTaskToast.count} new {newTaskToast.count === 1 ? "favour" : "favours"} available
            </span>
          </button>
        </div>
      )}

      {/* Status change toast */}
      {statusToast.visible && statusToast.message && (
        <div className="px-4 pt-2">
          <div className="w-full animate-[slideDown_0.3s_ease-out] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
            </span>
            <span className={`text-xs font-medium ${statusToast.color}`}>
              {statusToast.message}
            </span>
          </div>
        </div>
      )}

      {/* Hero card */}
      {tab === "available" && heroVisible && !mapMode && (
        <div className="px-4 pt-3">
          <div className="relative bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
            <button
              onClick={() => setHeroVisible(false)}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-gray-900 leading-tight">The Favour Board</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Agents get stuck on physical-world verification. You close the loop — verify, confirm, inspect. 30 seconds.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  {tasks.filter(t => t.status === "open").length} favours open
                </span>
                <span>
                  ${tasks.filter(t => t.status === "open" && t.escrowTxHash).reduce((s, t) => s + t.bountyUsdc, 0).toFixed(0)} USDC funded
                </span>
                <span>
                  {new Set(tasks.map(t => t.location.split(",").pop()?.trim()).filter(Boolean)).size} cities
                </span>
              </div>
              <a href="/demo" className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap">
                How it works
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Stats bar */}
      {tab === "available" && tasks.length > 0 && !mapMode && (
        <div className="px-4 pt-3 pb-0">
          <div className="flex items-center justify-center gap-1.5 flex-wrap text-[10px] text-gray-500">
            <span>{tasks.filter(t => t.status === "open").length} open</span>
            <span className="text-gray-700">·</span>
            <span>{tasks.filter(t => t.status === "completed").length} verified</span>
            <span className="text-gray-700">·</span>
            <span className="text-green-600 font-medium">
              ${tasks.filter(t => t.status === "open" && t.escrowTxHash).reduce((s, t) => s + t.bountyUsdc, 0).toFixed(0)} USDC live
            </span>
            <span className="text-gray-700">·</span>
            <span>{new Set(tasks.filter(t => t.claimant).map(t => t.claimant)).size} {new Set(tasks.filter(t => t.claimant).map(t => t.claimant)).size === 1 ? "runner" : "runners"}</span>
          </div>
        </div>
      )}

      {/* Inline XMTP chat prompt */}
      {tab === "available" && !mapMode && (
        <div className="px-4 pt-3">
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleChatQuery(); }}
                placeholder={'Ask RELAY — "what can I do nearby?"'}
                className="flex-1 text-xs bg-transparent text-gray-900 placeholder-gray-400 outline-none min-w-0"
              />
              <button
                onClick={handleChatQuery}
                disabled={chatLoading || !chatQuery.trim()}
                className="shrink-0 px-3 py-1.5 text-[10px] font-medium bg-gray-900 text-white rounded-lg disabled:opacity-30 transition-opacity"
              >
                {chatLoading ? "..." : "Ask"}
              </button>
            </div>
            {chatReply && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{chatReply}</p>
                <button
                  onClick={() => { setChatReply(""); setChatQuery(""); }}
                  className="text-[10px] text-gray-400 mt-1"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feedback Tasks — fun onboarding for new visitors */}
      {tab === "available" && !mapMode && (
        <div className="px-4 pt-3">
          <FeedbackTasks address={userId} onComplete={fetchTasks} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 px-4 py-3">
        {/* Profile + Reputation for "Yours" tab */}
        {tab === "mine" && (
          <div className="mb-4 flex flex-col gap-3">
            {/* Identity card */}
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center">
                  <span className="text-base font-bold text-white">{userId?.slice(-2).toUpperCase()}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{userId ? shortId(userId) : ""}</p>
                  <VerificationBadge level={verificationLevel} size="md" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center bg-gray-50 rounded-xl p-3">
                <div>
                  <p className="text-lg font-bold text-gray-900">${totalEarned.toFixed(2)}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">Earned</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{completedByClaiming.length}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">Completed</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{totalPosted}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">Posted</p>
                </div>
              </div>
            </div>

            {/* Trust level — one line */}
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Trust</span>
                <span className={`text-xs font-medium ${
                  verificationLevel === "orb" ? "text-cyan-600" :
                  verificationLevel === "device" ? "text-blue-600" :
                  "text-gray-600"
                }`}>
                  {verificationLevel === "orb" ? "Orb Verified" :
                   verificationLevel === "device" ? "Device Verified" :
                   verificationLevel === "wallet" ? "Wallet" : "Not verified"}
                </span>
              </div>
              <span className="text-[10px] text-gray-400">
                {verificationLevel === "orb" ? "No limit" :
                 verificationLevel === "device" ? "Up to $10" :
                 verificationLevel === "wallet" ? "Up to $5" : "Verify to start"}
              </span>
            </div>

            {/* Proof of Favour reputation */}
            {userId && <ProofOfFavourCard address={userId} compact />}

            {/* Recent activity summary */}
            {completedByClaiming.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-2">Recent</p>
                <div className="flex flex-col gap-2">
                  {completedByClaiming.slice(0, 3).map(t => (
                    <div key={t.id} className="flex items-center justify-between">
                      <p className="text-xs text-gray-700 truncate max-w-[200px]">{t.description}</p>
                      <span className={`text-xs font-medium ${t.escrowTxHash ? "text-gray-900" : "text-gray-400"}`}>
                        {t.escrowTxHash ? `$${t.bountyUsdc}` : `${t.bountyUsdc * 10} pts`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Map view */}
        {mapMode && tab === "available" ? (
          <div className="relative">
            <TaskMap
              tasks={tasks.filter(t => t.status === "open")}
              userLocation={userLocation}
              onSelectTask={(task) => {
                setSelectedTask(task);
                setView("detail");
              }}
            />
            <button
              onClick={() => setMapMode(false)}
              className="absolute top-3 right-3 z-[1000] bg-black/80 backdrop-blur-sm text-white px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 active:scale-95 transition-transform flex items-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              Close map
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <SkeletonCard />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            {tab === "available" ? (
              <>
                <div className="flex items-center gap-2">
                  {["🏷️", "🗺️", "⏱️", "♿", "🏢"].map((icon, i) => (
                    <div key={i} className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-lg">
                      {icon}
                    </div>
                  ))}
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-400 font-medium">No favours nearby right now</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-[260px]">
                    AI agents ask for favours when they need a human on the ground. Check back soon.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  {tab === "mine" ? (
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
                  {tab === "mine" ? "You haven't picked up any favours yet" :
                   "No completed favours yet"}
                </p>
              </>
            )}
          </div>
        ) : tab === "completed" ? (
          <div className="flex flex-col gap-4">
            {/* Gallery stats bar */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-gray-500">{filtered.length} completed</span>
              <span className="text-xs text-green-600 font-semibold">
                ${filtered.reduce((sum, t) => sum + t.bountyUsdc, 0).toFixed(2)} paid out
              </span>
            </div>
            {filtered.map((task, i) => (
              <div
                key={task.id}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`rounded-2xl overflow-hidden bg-white cursor-pointer active:scale-[0.98] transition-all ${
                  task.status === "completed"
                    ? "border border-green-200"
                    : "border border-gray-100"
                }`}
                onClick={() => { setSelectedTask(task); setView("detail"); }}
              >
                {task.proofImageUrl && (
                  <div className="relative">
                    <img src={task.proofImageUrl} alt="Proof" className="w-full h-48 object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white to-transparent opacity-60" />
                    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                      <div className="bg-green-100 backdrop-blur-sm border border-green-300 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] font-bold text-green-600">VERIFIED</span>
                      </div>
                      <span className="text-[11px] font-bold text-green-600 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1">
                        {rewardLabel(task)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="p-4 min-w-0">
                  <p className="font-medium text-[15px] leading-snug break-words">{task.description}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {task.agent && <AgentBadge agent={task.agent} />}
                    <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="text-xs text-gray-500 truncate max-w-[120px]">{task.location}</span>
                    <span className="text-[10px] text-gray-700 mx-0.5">·</span>
                    <span className="text-xs text-gray-500">{timeAgo(task.createdAt)}</span>
                  </div>
                  {task.verificationResult && (
                    <div className="mt-3 pt-3 border-t border-gray-100 min-w-0">
                      <p className="text-xs text-gray-400 leading-relaxed italic break-words">&ldquo;{String(task.verificationResult.reasoning)}&rdquo;</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-[10px] text-gray-600 flex items-center gap-1 truncate max-w-full">
                          {shortId(task.poster)} → {task.claimant ? shortId(task.claimant) : "?"}
                          {task.claimantVerification && (
                            <VerificationBadge level={task.claimantVerification} size="sm" />
                          )}
                        </span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[10px] text-green-600 font-medium">
                          {Math.round((task.verificationResult.confidence || 0) * 100)}% confidence
                        </span>
                        {task.attestationTxHash && (
                          <>
                            <span className="text-[10px] text-gray-700">·</span>
                            <a href={`https://worldscan.org/tx/${task.attestationTxHash}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 min-h-[44px] flex items-center">
                              verified →
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {!task.proofImageUrl && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] font-bold text-green-600">VERIFIED</span>
                      </div>
                      <span className="text-xs font-semibold text-green-600">{rewardLabel(task)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {/* Recently completed — show activity to judges */}
            {tab === "available" && (() => {
              const recent = tasks
                .filter(t => t.status === "completed" && t.verificationResult)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 3);
              if (recent.length === 0) return null;
              return (
                <div className="mb-1">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider font-medium mb-2 px-1">Recently verified</p>
                  <div className="flex flex-col gap-1.5">
                    {recent.map(t => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2.5 bg-green-50 border border-green-100 rounded-xl px-3 py-2 cursor-pointer active:scale-[0.98] transition-all"
                        onClick={() => { setSelectedTask(t); setView("detail"); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <span className="text-[11px] text-gray-400 truncate flex-1">{t.description.slice(0, 55)}{t.description.length > 55 ? "…" : ""}</span>
                        <span className="text-[10px] text-green-600 font-semibold shrink-0">{rewardLabel(t)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 mt-3 mb-1" />
                </div>
              );
            })()}
            {filtered.map((task, i) => (
              <div
                key={task.id}
                style={{ animationDelay: `${i * 50}ms` }}
                className="rounded-2xl"
              >
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
                    try {
                      hapticTap();
                      let claimCode: string | undefined;
                      if (task.claimCode) {
                        const code = prompt("This bounty requires an access code:");
                        if (!code) return;
                        claimCode = code;
                      }

                      setClaimTxError(null);
                      setClaimTxSuccess(null);

                      try {
                        if (task.taskType === "double-or-nothing" && isMiniKit() && DOUBLE_OR_NOTHING_ADDRESS && task.donOnChainId !== null) {
                          const txPayload = encodeStakeAndClaimWithApproval(task.donOnChainId, task.bountyUsdc);
                          if (txPayload) {
                            const txResult = await MiniKit.sendTransaction(txPayload);
                            if (!txResult) {
                              setClaimTxError({ message: `Staking $${task.bountyUsdc} USDC failed.`, taskId: task.id, retry: () => {} });
                              return;
                            }
                          }
                        } else if (isMiniKit() && RELAY_ESCROW_ADDRESS && task.onChainId !== null) {
                          const txPayload = encodeClaimTask(task.onChainId);
                          if (txPayload) {
                            const txResult = await MiniKit.sendTransaction(txPayload);
                            if (!txResult) {
                              setClaimTxError({ message: "On-chain claim failed.", taskId: task.id, retry: () => {} });
                              return;
                            }
                          }
                        }
                      } catch {
                        // MiniKit not available outside World App — continue with API claim
                      }

                      const res = await fetch(`/api/tasks/${task.id}/claim`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ claimant: userId, claimCode }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        if (err.requiresCode) {
                          setClaimTxError({ message: "Wrong access code. Try again.", taskId: task.id, retry: () => {} });
                          return;
                        }
                        if (err.required) {
                          setUpgradePrompt({ required: err.required, current: err.current });
                          return;
                        }
                        return;
                      }
                      hapticSuccess();
                      fetchTasks();
                    } catch {
                      // Silently handle any unexpected errors
                    }
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

      {/* Claim transaction success banner */}
      {claimTxSuccess && (
        <div className="mx-4 mb-2 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-green-600 font-medium">Claim confirmed on World Chain</p>
            <p className="text-[10px] text-gray-500 font-mono truncate">{claimTxSuccess.hash}</p>
          </div>
          <a
            href={`https://worldscan.org/tx/${claimTxSuccess.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-500 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
          >
            Explorer
          </a>
          <button
            onClick={() => setClaimTxSuccess(null)}
            className="text-gray-400 hover:text-gray-600 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Dismiss"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Claim transaction error banner */}
      {claimTxError && (
        <div className="mx-4 mb-2 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <p className="flex-1 text-xs text-red-400 font-medium">{claimTxError.message}</p>
          <button
            onClick={() => { setClaimTxError(null); claimTxError.retry(); }}
            className="text-[11px] text-blue-500 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center font-medium"
          >
            Retry
          </button>
          <button
            onClick={() => setClaimTxError(null)}
            className="text-gray-400 hover:text-gray-600 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Dismiss error"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* World Chat Status + Powered by footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        {xmtpStatus && (
          xmtpStatus.connected ? (
            <div className="flex items-center justify-center gap-1.5 mb-2 flex-wrap">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-[10px] font-medium text-green-600">XMTP Connected</span>
              {xmtpStatus.inboxId && (
                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]">
                  {xmtpStatus.inboxId.slice(0, 8)}...{xmtpStatus.inboxId.slice(-4)}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 mb-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500" />
              <span className="text-[10px] text-gray-500">XMTP connecting...</span>
            </div>
          )
        )}
        <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <span className="text-[10px] text-gray-500">World ID</span>
          </div>
          <span className="text-gray-300">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="text-[10px] text-gray-500">XMTP</span>
          </div>
          <span className="text-gray-300">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
            <span className="text-[10px] text-gray-500">World Chain</span>
          </div>
        </div>
      </div>

      {/* Upgrade prompt modal */}
      {upgradePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm px-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Verification Required</p>
                <p className="text-[11px] text-gray-500 mt-0.5">World ID upgrade needed</p>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Required level</span>
                <span className={`text-xs font-semibold ${upgradePrompt.required === "orb" ? "text-cyan-600" : "text-blue-600"}`}>
                  {upgradePrompt.required === "orb" ? "◉ Orb Verified" : upgradePrompt.required === "device" ? "◎ Device Verified" : "○ Wallet Verified"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Your level</span>
                <span className={`text-xs font-medium ${upgradePrompt.current === "orb" ? "text-cyan-600" : upgradePrompt.current === "device" ? "text-blue-600" : "text-green-600"}`}>
                  {upgradePrompt.current === "orb" ? "◉ Orb" : upgradePrompt.current === "device" ? "◎ Device" : upgradePrompt.current === "wallet" ? "○ Wallet" : "None"}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              Verify your identity in World App to unlock higher-paying bounties. More verification = more trust = better bounties.
            </p>

            <button
              onClick={() => setUpgradePrompt(null)}
              className="w-full min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getAgentReason(agentId: string): string {
  const reasons: Record<string, string> = {
    shelfwatch: "Brands need real shelf data. No API for that.",
    freshmap: "Local data goes stale fast. Humans keep it fresh.",
    queuepulse: "No API for real-time queues. Only a human can check.",
    propertycheck: "Listings lie. Someone needs to walk by.",
    dropscout: "Ground intel on drops and pop-ups, before anyone else.",
    openclaw: "Crawls the web but can't taste, smell, or verify in person.",
    hermes: "Sends messages but can't make calls or show up.",
    claudecode: "Writes code but can't open an app or tap a screen.",
  };
  return reasons[agentId] || "Needs a human on the ground.";
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
  const isAgentTask = !!(task.agent || task.poster?.startsWith("agent_"));

  return (
    <div
      onClick={onTap}
      className="rounded-2xl p-4 flex flex-col gap-2.5 cursor-pointer active:scale-[0.98] transition-all bg-white border border-gray-100 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isAgentTask && task.agent ? (
            <>
              <span className="text-xs font-medium text-gray-900">{task.agent.name}</span>
              <span className="text-[8px] font-medium text-gray-400 bg-gray-50 border border-gray-100 rounded px-1 py-px">AI</span>
            </>
          ) : (
            <span className="text-xs text-gray-400">Community</span>
          )}
        </div>
        {task.escrowTxHash ? (
          <span className="text-xs font-semibold text-gray-900">${task.bountyUsdc} USDC</span>
        ) : (
          <span className="text-xs font-medium text-gray-400">{task.bountyUsdc * 10} pts</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug break-words text-gray-700">{task.description}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="text-xs text-gray-400 truncate max-w-[180px]">{task.location}</span>
          {distance !== null && (
            <>
              <span className="text-[10px] text-gray-300 mx-0.5">·</span>
              <span className="text-xs text-blue-500 font-medium">{formatDistance(distance)}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {isOwnTask && <span className="text-[10px] text-gray-600">You posted</span>}
          {isClaimant && task.status === "claimed" && <span className="text-[10px] text-gray-600">You claimed</span>}
          {task.escrowTxHash && (
            <span className="flex items-center gap-0.5 text-[9px] text-green-600 font-bold bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
              &#x26d3; On-chain
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-700">{timeAgo(task.createdAt)}</span>
      </div>

      {task.status === "open" && userId && !isOwnTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onClaim(); }}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl px-4 py-3 min-h-[44px] transition-colors active:scale-[0.98]"
        >
          {task.claimCode
            ? "Claim (Code Required)"
            : task.taskType === "double-or-nothing"
              ? `Stake $${task.bountyUsdc} & Claim`
              : "Claim"}
        </button>
      )}

      {task.status === "claimed" && isClaimant && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-xl px-4 py-3 min-h-[44px] transition-colors active:scale-[0.98] border border-gray-200"
        >
          Submit Proof
        </button>
      )}

      {task.status === "completed" && task.verificationResult?.verdict === "pass" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            hapticTap();
            shareTask({
              taskDescription: task.description,
              bountyUsdc: task.bountyUsdc,
              verdict: task.verificationResult?.verdict,
              taskId: task.id,
            });
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-all text-sm text-gray-500 hover:text-gray-900 active:scale-[0.98] min-h-[44px]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share Completion
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-blue-50 text-blue-600 border-blue-200",
    claimed: "bg-yellow-50 text-yellow-600 border-yellow-200",
    completed: "bg-green-50 text-green-600 border-green-200",
    failed: "bg-red-50 text-red-600 border-red-200",
    expired: "bg-gray-100 text-gray-500 border-gray-200",
  };
  const labels: Record<string, string> = {
    open: "Open",
    claimed: "Claimed",
    completed: "Done",
    failed: "Failed",
    expired: "Expired",
  };

  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border ${styles[status] || styles.expired}`}>
      {labels[status] || status}
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

// VerificationBadge and RequiredTierBadge are imported from @/components/VerificationBadge

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
  const [taskType, setTaskType] = useState<"standard" | "double-or-nothing">("standard");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [bounty, setBounty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [escrowSuccess, setEscrowSuccess] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const enhancedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleEnhance = async () => {
    if (!description.trim() || enhancing) return;
    setEnhancing(true);
    setEnhanced(false);
    try {
      const res = await fetch("/api/enhance-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, category, location }),
      });
      const data = await res.json();
      if (data.enhanced) {
        setDescription(data.enhanced);
        setEnhanced(true);
        if (enhancedTimer.current) clearTimeout(enhancedTimer.current);
        enhancedTimer.current = setTimeout(() => setEnhanced(false), 2000);
      }
    } catch {
      /* silently fail — user keeps their original description */
    } finally {
      setEnhancing(false);
    }
  };

  const handleSubmit = async () => {
    if (!description || !location || !bounty || !userId) return;
    setSubmitting(true);

    let onChainId: number | null = null;
    let escrowTxHash: string | null = null;
    let donOnChainId: number | null = null;

    const isDoN = taskType === "double-or-nothing";

    if (isMiniKit()) {
      if (isDoN && DOUBLE_OR_NOTHING_ADDRESS) {
        const txPayload = encodeCreateDoubleOrNothing(description, parseFloat(bounty), 24);
        if (txPayload) {
          try {
            const countBefore = await readDonTaskCount().catch(() => 0);
            const txResult = await MiniKit.sendTransaction(txPayload);
            if (txResult) {
              donOnChainId = countBefore;
              escrowTxHash = typeof txResult === "object" && txResult !== null && "transactionHash" in txResult
                ? String((txResult as Record<string, unknown>).transactionHash)
                : null;
              if (escrowTxHash) {
                hapticSuccess();
                setEscrowSuccess(escrowTxHash);
              }
            }
          } catch {
          }
        }
      } else if (RELAY_ESCROW_ADDRESS) {
        const txPayload = encodeCreateTask(description, parseFloat(bounty), 24);
        if (txPayload) {
          try {
            const countBefore = await readTaskCount().catch(() => 0);
            const txResult = await MiniKit.sendTransaction(txPayload);
            if (txResult) {
              onChainId = countBefore;
              escrowTxHash = typeof txResult === "object" && txResult !== null && "transactionHash" in txResult
                ? String((txResult as Record<string, unknown>).transactionHash)
                : null;
              if (escrowTxHash) {
                hapticSuccess();
                setEscrowSuccess(escrowTxHash);
              }
            }
          } catch {
          }
        }
      }
    }

    try {
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
          taskType,
          donOnChainId,
        }),
      });
      hapticSuccess();
    } catch {
      hapticError();
    }
    onDone();
  };

  const isValid = description && location && bounty;

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-900 transition-colors min-h-[44px] min-w-[44px] flex items-center">Cancel</button>
        <span className="text-sm font-semibold">New Request</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-5">
        <div>
          <label className="text-[11px] text-gray-400 uppercase tracking-wider font-medium block mb-2">What do you need?</label>
          <textarea
            placeholder="Confirm if the package was delivered to the front door"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setEnhanced(false); }}
            rows={3}
            autoFocus
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-gray-300 transition-colors placeholder:text-gray-400"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-400 uppercase tracking-wider font-medium block mb-2">Location</label>
          <input
            type="text"
            placeholder="City or address"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gray-300 transition-colors placeholder:text-gray-400"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-400 uppercase tracking-wider font-medium block mb-2">Reward</label>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <span className="text-sm text-gray-400">$</span>
            <input
              type="number"
              placeholder="5"
              min="0.01"
              step="0.01"
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-gray-400"
            />
            <span className="text-[11px] text-gray-400">USDC</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8 pt-2">
        {escrowSuccess && (
          <div className="mb-3 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center justify-between">
            <span className="text-[11px] text-green-600 font-medium">Deposited on-chain</span>
            <a
              href={`https://worldscan.org/tx/${escrowSuccess}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-500 underline underline-offset-2"
            >
              View tx
            </a>
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!isValid || submitting}
          className="w-full bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-xl px-4 py-3 min-h-[48px] transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {submitting ? "Posting..." : "Post Favour"}
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
  const [preCheck, setPreCheck] = useState<{ assessment: string; likely: "pass" | "marginal" | "retake" } | null>(null);
  const [preChecking, setPreChecking] = useState(false);

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
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1200;
        let w = img.width, h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
          const scale = MAX_DIM / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        setImages((prev) => [...prev, { base64: dataUrl.split(",")[1], preview: dataUrl, isVideo: false }]);
      };
      img.src = URL.createObjectURL(file);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (images.length === 0 && !proofNote.trim()) return;
    hapticMedium();
    setSubmitting(true);

    const proofImages = images.map((img) => img.base64);

    try {
      const res = await fetch("/api/verify-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          submitter: task.claimant || "anonymous",
          proofImageBase64: proofImages[0] || null,
          proofImages: proofImages.length > 0 ? proofImages : [],
          proofNote: proofNote || null,
          lat: proofCoords?.lat || null,
          lng: proofCoords?.lng || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "Upload failed");
        setResult({ verdict: "fail", reasoning: `Server error: ${text.slice(0, 100)}` });
        setSubmitting(false);
        hapticError();
        return;
      }

      const data = await res.json();
      const v = data.verification || {};
      setResult({
        verdict: String(v.verdict || "fail"),
        reasoning: String(v.reasoning || "No reasoning provided"),
        locationVerified: data.locationVerified,
        distanceKm: data.distanceKm,
      });
      setSubmitting(false);

      if (data.verification.verdict === "pass") {
        hapticSuccess();
        setTimeout(onDone, 2500);
      } else if (data.verification.verdict === "fail") {
        hapticError();
      } else {
        hapticSelection();
      }
    } catch {
      setResult({ verdict: "fail", reasoning: "Network error — please try again" });
      setSubmitting(false);
      hapticError();
    }
  };

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-900 transition-colors min-h-[44px] min-w-[44px] flex items-center">Cancel</button>
        <span className="text-sm font-semibold">Submit Proof</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4">
        {/* Task context */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <p className="text-sm font-medium leading-snug text-gray-900">{task.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-400">{task.location}</span>
            <span className="text-[10px] text-gray-300 mx-0.5">·</span>
            <span className="text-xs font-medium text-gray-900">{rewardLabel(task)}</span>
          </div>
        </div>

        {/* Photo upload — multi-image */}
        <div>
          <label className="text-[10px] text-gray-400 uppercase tracking-wider block mb-2">
            Photos ({images.length}/{MAX_PHOTOS})
          </label>

          {images.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {images.map((img, i) => (
                <div key={i} className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-100">
                  <img src={img.preview} alt={`Proof ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                  {img.isVideo && (
                    <div className="absolute bottom-1 left-1 bg-black/70 rounded px-1 py-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1 -right-1 w-7 h-7 bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-500/80 transition-colors"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          {images.length < MAX_PHOTOS && (
            <label className="flex flex-col items-center justify-center border border-dashed border-gray-200 rounded-2xl p-8 cursor-pointer hover:border-gray-300 transition-all bg-gray-50 active:scale-[0.99]">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <span className="text-sm text-gray-400">
                {images.length === 0 ? "Take photo or choose from library" : "Add another"}
              </span>
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
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gray-300 transition-colors placeholder:text-gray-400"
        />

        {/* AI Pre-Check */}
        {images.length > 0 && !result && !submitting && (
          <div className="flex flex-col gap-2">
            {!preCheck && !preChecking && (
              <button
                onClick={async () => {
                  setPreChecking(true);
                  setPreCheck(null);
                  try {
                    const res = await fetch("/api/proof-precheck", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        imageBase64: images[0].base64,
                        taskDescription: task.description,
                      }),
                    });
                    if (!res.ok) throw new Error("precheck failed");
                    const data = await res.json();
                    setPreCheck({ assessment: data.assessment, likely: data.likely });
                  } catch {
                    setPreCheck({ assessment: "Pre-check unavailable. You can still submit.", likely: "marginal" });
                  } finally {
                    setPreChecking(false);
                  }
                }}
                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-all text-sm text-gray-600 active:scale-[0.98]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Pre-check with AI
                <span className="text-[10px] text-gray-400 ml-1">optional</span>
              </button>
            )}

            {preChecking && (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400">Checking your photo...</span>
              </div>
            )}

            {preCheck && (
              <div className={`p-3.5 rounded-xl border text-sm ${
                preCheck.likely === "pass"
                  ? "bg-green-50 border-green-200"
                  : preCheck.likely === "marginal"
                  ? "bg-yellow-50 border-yellow-200"
                  : "bg-red-50 border-red-200"
              }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {preCheck.likely === "pass" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : preCheck.likely === "marginal" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    preCheck.likely === "pass"
                      ? "text-green-600"
                      : preCheck.likely === "marginal"
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}>
                    {preCheck.likely === "pass"
                      ? "Looks good — likely to pass verification"
                      : preCheck.likely === "marginal"
                      ? "Marginal — consider adding more detail or another angle"
                      : "This may not pass — consider retaking the photo"}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{preCheck.assessment}</p>
              </div>
            )}
          </div>
        )}

        {/* Verification spinner */}
        {submitting && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="w-12 h-12 border-2 border-purple-500/30 rounded-full" />
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin absolute inset-0" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900">Verifying proof...</p>
              <p className="text-xs text-gray-500 mt-1">Analyzing your photo{images.length > 1 ? "s" : ""}</p>
            </div>
          </div>
        )}

        {/* Verdict result */}
        {result && (
          <div className={`p-5 rounded-2xl text-sm border ${
            result.verdict === "pass" ? "bg-green-50 border-green-200" :
            result.verdict === "flag" ? "bg-yellow-50 border-yellow-200" :
            "bg-red-50 border-red-200"
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
                result.verdict === "pass" ? "text-green-600" :
                result.verdict === "flag" ? "text-yellow-600" :
                "text-red-600"
              }`}>
                {result.verdict === "pass" ? "VERIFIED" : result.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{String(result.reasoning)}</p>
            {result.locationVerified !== undefined && result.locationVerified !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={result.locationVerified ? "#4ade80" : "#f59e0b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className={`text-[11px] font-medium ${result.locationVerified ? "text-green-600" : "text-yellow-600"}`}>
                  {result.locationVerified ? "Location verified" : "Location not confirmed"}
                  {result.distanceKm !== undefined && result.distanceKm !== null && (
                    <span className="text-gray-500 font-normal"> · {result.distanceKm < 1 ? `${Math.round(result.distanceKm * 1000)}m` : `${result.distanceKm.toFixed(1)}km`} from task</span>
                  )}
                </span>
              </div>
            )}
            {result.verdict === "pass" && (
              <div className="mt-3 pt-3 border-t border-green-200 flex flex-col gap-2">
                <p className="font-semibold text-sm text-green-600">${task.bountyUsdc} USDC released</p>
                <button
                  onClick={() => {
                    hapticTap();
                    shareTask({
                      taskDescription: task.description,
                      bountyUsdc: task.bountyUsdc,
                      verdict: "pass",
                      taskId: task.id,
                    });
                  }}
                  className="flex items-center justify-center gap-2 py-2 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100 transition-all text-xs text-green-600 active:scale-[0.98]"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                  Share your verified completion
                </button>
              </div>
            )}
            {result.verdict === "flag" && (
              <p className="mt-2 text-xs text-yellow-600">Waiting for poster to review...</p>
            )}
            {result.verdict === "fail" && (
              <p className="mt-2 text-xs text-red-600">Bounty reopened for new claims.</p>
            )}
          </div>
        )}
      </div>

      {!result && !submitting && (
        <div className="px-4 pb-8 pt-2">
          <button
            onClick={handleSubmit}
            disabled={images.length === 0 && !proofNote.trim()}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/40 disabled:cursor-not-allowed text-white font-medium rounded-xl px-4 py-3 min-h-[48px] transition-colors active:scale-[0.98]"
          >
            {images.length > 0 ? "Submit for Verification" : "Submit Text Report"}
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
      label: task.verificationResult?.verdict === "pass" ? "Verified" : task.verificationResult?.verdict === "flag" ? "Flagged" : task.verificationResult ? "Rejected" : "Pending Review",
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
    <div className="bg-white border border-gray-100 rounded-2xl p-3 sm:p-4 overflow-x-auto">
      <div className="flex items-center justify-between min-w-0">
        {steps.map((step, i) => {
          const isActive = i === activeIndex && !step.done;
          const isDone = step.done;
          const isFlagged = step.label === "Flagged";
          const isRejected = step.label === "Rejected";
          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none min-w-0">
              <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all ${
                  isDone
                    ? isFlagged ? "bg-yellow-100 text-yellow-600" :
                      isRejected ? "bg-red-100 text-red-600" :
                      "bg-green-100 text-green-600"
                    : isActive
                    ? "bg-blue-100 text-blue-600 animate-[pulse-dot_2s_ease-in-out_infinite]"
                    : "bg-gray-50 text-gray-600"
                }`}>
                  {step.icon}
                </div>
                <span className={`text-[9px] font-medium ${
                  isDone ? isFlagged ? "text-yellow-600" : isRejected ? "text-red-600" : "text-green-600"
                  : isActive ? "text-blue-400" : "text-gray-600"
                }`}>
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-0.5 sm:mx-1.5 ${
                  i < activeIndex ? "bg-green-300" : "bg-gray-200"
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
  const [txSuccess, setTxSuccess] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
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
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-900 transition-colors min-h-[44px] min-w-[44px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <StatusBadge status={currentTask.status} />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4 overflow-y-auto">
        {/* Task info */}
        <div className="min-w-0">
          <p className="font-semibold text-lg leading-snug break-words">{currentTask.description}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500 truncate max-w-[140px]">{currentTask.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs font-semibold text-gray-900">{rewardLabel(currentTask)}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-gray-500">{timeLeft(currentTask.deadline)}</span>
          </div>
        </div>

        {/* Lifecycle timeline */}
        <TaskTimeline task={currentTask} />

        {/* Transaction success banner */}
        {txSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3">
            <div className="flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-green-600 font-medium">Transaction confirmed on World Chain</p>
                <p className="text-[10px] text-gray-500 font-mono truncate">{txSuccess}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-green-200">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-green-600 font-semibold">{rewardLabel(currentTask)}</span>
                <span className="text-[9px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">Powered by World Chain</span>
              </div>
              <a
                href={`https://worldscan.org/tx/${txSuccess}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-500 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
              >
                View on Explorer
              </a>
            </div>
          </div>
        )}

        {/* Escrow transaction link */}
        {currentTask.escrowTxHash && !txSuccess && (
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-400 font-medium">Escrow deposit</p>
              <p className="text-[10px] text-gray-500 font-mono truncate">{currentTask.escrowTxHash}</p>
            </div>
            <a
              href={`https://worldscan.org/tx/${currentTask.escrowTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-500 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
            >
              View on Explorer
            </a>
          </div>
        )}

        {/* Fund with USDC — poster can fund an unfunded task */}
        {currentTask.status === "open" && isPoster && !currentTask.escrowTxHash && isMiniKit() && RELAY_ESCROW_ADDRESS && (
          <button
            disabled={funding}
            onClick={async () => {
              setFunding(true);
              try {
                const countBefore = await readTaskCount().catch(() => 0);
                const txPayload = encodeCreateTask(currentTask.description, currentTask.bountyUsdc, 24);
                if (!txPayload) { setFunding(false); return; }
                const result = await MiniKit.sendTransaction(txPayload);
                const hash = typeof result === "object" && result !== null && "transactionHash" in result
                  ? String((result as Record<string, unknown>).transactionHash)
                  : null;
                if (hash) {
                  const onChainId = countBefore;
                  await fetch(`/api/tasks/${currentTask.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ onChainId, escrowTxHash: hash }),
                  });
                  setCurrentTask(prev => ({ ...prev, onChainId, escrowTxHash: hash }));
                  setTxSuccess(hash);
                } else {
                  alert("Fund transaction failed. Please try again.");
                }
              } catch {
                alert("Fund transaction rejected by wallet.");
              }
              setFunding(false);
            }}
            className="w-full bg-gray-900 hover:bg-gray-800 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            {funding ? "Funding..." : `Fund $${currentTask.bountyUsdc} USDC`}
          </button>
        )}

        {/* Agent info or People */}
        {currentTask.agent ? (
          <div className="rounded-xl p-4 border border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl bg-white border border-gray-100">
                {currentTask.agent.icon}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">{currentTask.agent.name}</span>
                  <span className="text-[8px] font-medium text-gray-400 bg-white border border-gray-200 rounded px-1 py-px">AI</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">Favour · Pays on completion</p>
              </div>
            </div>
            {currentTask.claimant && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Claimed by</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium">{shortId(currentTask.claimant)}</p>
                  <VerificationBadge level={currentTask.claimantVerification} size="sm" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl p-3 border border-gray-100 min-w-0">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Poster</p>
              <p className="text-xs font-medium truncate">{shortId(currentTask.poster)}</p>
            </div>
            {currentTask.claimant && (
              <div className="bg-white rounded-xl p-3 border border-gray-100 min-w-0">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Claimant</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium truncate">{shortId(currentTask.claimant)}</p>
                  <VerificationBadge level={currentTask.claimantVerification} size="sm" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Proof image */}
        {currentTask.proofImageUrl && (
          <div>
            <button
              onClick={() => setShowProofImage(!showProofImage)}
              className="flex items-center gap-2 text-xs text-gray-500 font-medium min-h-[44px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {showProofImage ? "Hide proof photo" : "View proof photo"}
            </button>
            {showProofImage && (
              <div className="mt-2 rounded-2xl overflow-hidden border border-gray-100">
                <img src={currentTask.proofImageUrl} alt="Proof" className="w-full max-h-80 object-cover" loading="lazy" />
                {currentTask.proofNote && (
                  <div className="bg-white px-4 py-2 border-t border-gray-100">
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
            currentTask.verificationResult.verdict === "pass" ? "bg-green-50 border-green-200" :
            currentTask.verificationResult.verdict === "flag" ? "bg-yellow-50 border-yellow-200" :
            "bg-red-50 border-red-200"
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
                currentTask.verificationResult.verdict === "pass" ? "text-green-600" :
                currentTask.verificationResult.verdict === "flag" ? "text-yellow-600" :
                "text-red-600"
              }`}>
                {currentTask.verificationResult.verdict === "pass" ? "VERIFIED" : currentTask.verificationResult.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
              {currentTask.claimantVerification && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ml-1 ${
                  currentTask.claimantVerification === "orb" ? "text-cyan-600 border-cyan-200 bg-cyan-50" :
                  currentTask.claimantVerification === "device" ? "text-blue-600 border-blue-200 bg-blue-50" :
                  "text-green-600 border-green-200 bg-green-50"
                }`}>
                  {currentTask.claimantVerification === "orb" ? "Orb-verified human" : currentTask.claimantVerification === "device" ? "Device-verified" : "Wallet-level"}
                </span>
              )}
              {currentTask.verificationResult.confidence !== undefined && (
                <span className="text-[10px] text-gray-500 ml-auto">{Math.round(currentTask.verificationResult.confidence * 100)}% confidence</span>
              )}
            </div>
            <p className="text-xs text-gray-400 leading-relaxed break-words">{String(currentTask.verificationResult.reasoning)}</p>
            {currentTask.verificationResult.verdict === "pass" && (
              <div className="mt-2 pt-2 border-t border-green-200">
                <p className="text-xs text-green-600 font-semibold">${currentTask.bountyUsdc} USDC released</p>
              </div>
            )}
            {currentTask.attestationTxHash && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                <a
                  href={`https://worldscan.org/tx/${currentTask.attestationTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] text-blue-500 underline underline-offset-2 min-h-[44px]"
                >
                  <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  On-chain attestation →
                </a>
              </div>
            )}
          </div>
        )}

        {/* On-chain release -- poster confirms settlement */}
        {currentTask.status === "completed" && isPoster && isMiniKit() && RELAY_ESCROW_ADDRESS && currentTask.onChainId !== null && (
          <button
            onClick={async () => {
              const txPayload = encodeReleasePayment(currentTask.onChainId!);
              if (txPayload) {
                try {
                  const result = await MiniKit.sendTransaction(txPayload);
                  if (!result) {
                    setTxSuccess(null);
                    alert("Release transaction failed. Please try again.");
                  } else {
                    const hash = typeof result === "object" && result !== null && "transactionHash" in result
                      ? String((result as Record<string, unknown>).transactionHash)
                      : null;
                    if (hash) setTxSuccess(hash);
                  }
                } catch {
                  alert("Release transaction rejected by wallet.");
                }
              }
            }}
            className="w-full bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[44px] flex-wrap"
          >
            <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <span>Release ${currentTask.bountyUsdc} USDC</span>
            <span className="text-[10px] opacity-70 font-normal">via World Chain</span>
          </button>
        )}

        {/* Uniswap swap — claimant can convert received USDC */}
        {currentTask.status === "completed" && isClaimant && isMiniKit() && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <span className="text-xs font-semibold text-gray-900">Swap Earnings</span>
              <span className="text-[10px] text-gray-600 ml-auto">via Uniswap V3</span>
            </div>
            <div className="flex gap-2 mb-3">
              {(["USDC", "WETH", "WLD"] as SwapToken[]).map((token) => (
                <button
                  key={token}
                  onClick={() => setSwapToken(token)}
                  className={`flex-1 min-h-[44px] py-2 rounded-xl text-xs font-medium transition-all ${
                    swapToken === token
                      ? "bg-black text-white"
                      : "bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"
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
                    try {
                      const swapResult = await MiniKit.sendTransaction(txPayload);
                      const swapHash = typeof swapResult === "object" && swapResult !== null && "transactionHash" in swapResult
                        ? String((swapResult as Record<string, unknown>).transactionHash)
                        : null;
                      if (swapHash) setTxSuccess(swapHash);
                      else alert("Swap transaction failed. Please try again.");
                    } catch {
                      alert("Swap transaction rejected by wallet.");
                    }
                  }
                  setSwapping(false);
                }}
                disabled={swapping}
                className="w-full min-h-[44px] bg-pink-600 hover:bg-pink-500 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl px-4 py-3 min-h-[44px] transition-colors active:scale-[0.98]"
          >
            Submit Proof
          </button>
        )}

        {/* AI Follow-up: claimant can respond and request re-evaluation */}
        {hasFollowUp && isClaimant && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-sm font-semibold text-purple-400">More info needed</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">Reply to the question in the thread below, then tap re-evaluate.</p>
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
              className="w-full min-h-[44px] bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {reEvaluating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Re-evaluating...
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
            <p className="text-xs text-yellow-600 text-center">This proof was flagged. Your call — or request mediation.</p>
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
                className="flex-1 min-h-[44px] bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
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
                className="flex-1 min-h-[44px] bg-red-600/80 hover:bg-red-600 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
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
              className="w-full min-h-[44px] bg-indigo-600/80 hover:bg-indigo-600 text-white py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {disputing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing thread...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                  </svg>
                  Mediate — Request verdict
                </>
              )}
            </button>
          </div>
        )}

        {/* XMTP Thread */}
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Thread</span>
            <span className="flex-1 h-px bg-gray-50" />
            <div className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span className="text-[10px] text-indigo-500">XMTP Encrypted</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-[pulse-dot_2s_ease-in-out_infinite]" />
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-gray-600">No messages yet</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isAiBriefing = msg.sender === "relay-bot" && (msg.text.includes("BRIEFING") && !msg.text.includes("SCOUT"));
              const isAiFollowUp = msg.sender === "relay-bot" && msg.text.includes("FOLLOW-UP");
              const isAiDispute = msg.sender === "relay-bot" && msg.text.includes("DISPUTE RESOLUTION");
              const isAiReEval = msg.sender === "relay-bot" && msg.text.includes("RE-EVALUATION");
              const isAiMessage = isAiBriefing || isAiFollowUp || isAiDispute || isAiReEval;

              return (
                <div
                  key={msg.id}
                  className={`rounded-2xl p-4 ${
                    isAiMessage
                      ? "bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200"
                      : msg.sender === "relay-bot"
                      ? "bg-white border border-gray-200"
                      : msg.sender === userId
                      ? "bg-blue-50 border border-blue-100 ml-4"
                      : "bg-white border border-gray-200 mr-4"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                      isAiMessage ? "text-purple-400" :
                      msg.sender === "relay-bot" ? "text-purple-400" :
                      msg.sender === userId ? "text-blue-400" : "text-gray-400"
                    }`}>
                      {isAiMessage && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
                        </svg>
                      )}
                      {msg.sender === "relay-bot" ? (isAiMessage ? "RELAY AI" : "RELAY") : msg.sender === userId ? "You" : shortId(msg.sender)}
                    </span>
                    <span className="text-[11px] text-gray-600">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed break-words">{typeof msg.text === "string" ? msg.text : String(msg.text)}</p>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Chat input */}
      {isParticipant && currentTask.status !== "completed" && currentTask.status !== "failed" && (
        <div className="sticky bottom-14 bg-white border-t border-gray-100 px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={hasFollowUp && isClaimant ? "Reply to AI's question..." : "Message..."}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              className={`flex-1 min-w-0 bg-gray-50 border rounded-xl px-4 py-2.5 text-sm min-h-[44px] focus:outline-none transition-colors placeholder:text-gray-400 ${
                hasFollowUp && isClaimant ? "border-purple-500/30 focus:border-purple-500/50" : "border-gray-200 focus:border-gray-300"
              }`}
            />
            <button
              onClick={sendMessage}
              disabled={!chatInput.trim() || sending}
              className="bg-black text-white px-4 min-w-[44px] min-h-[44px] rounded-xl text-sm font-medium disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center"
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
