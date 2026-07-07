"use client";

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { MiniKit } from "@worldcoin/minikit-js";
import type { Task, AgentInfo } from "@/lib/types";
import {
  Button,
  Typography,
  Spinner,
  Skeleton,
  SkeletonTypography,
  TopBar,
  Pill,
  TextArea,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
  CircularIcon,
  LiveFeedback,
} from "@worldcoin/mini-apps-ui-kit-react";

function isMiniKit(): boolean {
  try { return typeof window !== "undefined" && MiniKit.isInstalled(); } catch { return false; }
}
import { VerificationBadge, RequiredTierBadge } from "@/components/VerificationBadge";
import { encodeCreateTask, encodeClaimTask, encodeReleasePayment, encodeUniswapSwap, readTaskCount, RELAY_ESCROW_ADDRESS, DOUBLE_OR_NOTHING_ADDRESS, encodeCreateDoubleOrNothing, encodeStakeAndClaimWithApproval, readDonTaskCount, type SwapToken } from "@/lib/contracts";
import { hapticSuccess, hapticError, hapticTap, hapticHeavy, hapticMedium, hapticSelection, shareTask } from "@/lib/minikit-helpers";
import { TASK_TEMPLATES } from "@/lib/agents";
import { POST_TEMPLATES, MIN_DESCRIPTION_LENGTH } from "@/lib/post-templates";
import { useWorldUsers, displayName } from "@/hooks/useWorldUser";
import { getCampaigns, type Campaign } from "@/lib/campaigns";
import { CampaignPage, FeaturedCampaignBanner } from "@/components/CampaignPage";
import { PollsFeed, FeedPolls } from "@/components/Polls";
import {
  isBoardVisible,
  rankBoard,
  curateBoard,
  haversineKm,
  POLL_INSERT_AFTER,
  POLL_CARDS_MAX,
} from "@/lib/board-rank";
import { JuryMode } from "@/components/JuryMode";

function extractTxHash(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Record<string, unknown>;
  if ("userOpHash" in r && r.userOpHash) return String(r.userOpHash);
  if ("transactionHash" in r && r.transactionHash) return String(r.transactionHash);
  return null;
}

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
  return displayName(id);
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

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m away`;
  if (km < 10) return `${km.toFixed(1)}km away`;
  return `${Math.round(km)}km away`;
}

// Delegates to the canonical reward formatter so points/money never drift.
function rewardLabel(task: Task): string {
  return rewardAmountLabel(task);
}

function proofInstructions(task: Task): { short: string; steps: string[]; tip: string } {
  const cat = task.category || "custom";
  const hasLocation = !!(task.lat && task.lng);

  switch (cat) {
    case "review":
      return {
        short: "Try it and share your honest review",
        steps: [
          "Experience the place, product, or service",
          "Take a photo showing you were there",
          "Write your honest review in the proof note",
        ],
        tip: "Real opinions win. Include both what you liked and what could be better.",
      };
    case "social":
      return {
        short: "Post on social media and screenshot it",
        steps: [
          "Read what the poster wants you to share",
          "Create your post on X, Instagram, or TikTok",
          "Screenshot your published post as proof",
        ],
        tip: "Make sure your post is public and the screenshot shows it's live.",
      };
    case "errand":
      return {
        short: "Complete the errand and photo the result",
        steps: [
          "Read exactly what needs to be done",
          hasLocation ? `Head to ${task.location}` : "Go to the specified location",
          "Complete the task and photograph the result",
        ],
        tip: "Photo proof of the completed errand is required. Show the end result clearly.",
      };
    case "photo":
      return {
        short: "Take a photo at the location",
        steps: [
          hasLocation ? `Go to ${task.location}` : "Go to the specified location",
          "Take a clear photo showing what was requested",
          "Submit with any relevant notes",
        ],
        tip: hasLocation ? "Your location is verified. Submit from near the task location." : "Include clear visual proof.",
      };
    case "check-in":
      return {
        short: "Visit and confirm in person",
        steps: [
          hasLocation ? `Go to ${task.location}` : "Go to the specified location",
          "Take a photo proving you were there",
          "Submit with any relevant notes",
        ],
        tip: hasLocation ? "Your location is verified. Be at the spot when you submit." : "Photo proof of your visit is required.",
      };
    case "delivery":
      return {
        short: "Complete delivery and photograph",
        steps: [
          "Pick up or complete the delivery",
          "Take a photo of the completed delivery",
          "Submit proof showing completion",
        ],
        tip: "Include a clear photo of the delivered item at its destination.",
      };
    case "feedback":
      return {
        short: "Share your honest feedback",
        steps: [
          "Read the description carefully",
          "Write detailed, honest feedback",
          "Submit your response",
        ],
        tip: "Be specific. Longer, thoughtful responses score higher.",
      };
    default:
      return {
        short: "Complete the task and submit proof",
        steps: [
          "Read the task description carefully",
          "Complete what's asked and gather proof",
          "Submit a photo or detailed note",
        ],
        tip: hasLocation ? "Submit from near the task location for faster verification." : "Include clear proof of completion.",
      };
  }
}

import { CategoryIcon } from "@/components/CategoryIcon";
import { RewardBadge } from "@/components/RewardBadge";
import { rewardAmountLabel, isRealMoney } from "@/lib/reward";

type TaskTier = "quick" | "medium" | "effort";

function getTaskTier(category: string): TaskTier {
  if (category === "feedback" || category === "social") return "quick";
  if (category === "review" || category === "custom" || category === "check-in") return "medium";
  return "effort";
}

const TIER_CONFIG: Record<TaskTier, { label: string; color: string; bg: string; time: string }> = {
  quick: { label: "Quick", color: "text-green-700", bg: "bg-green-50 border-green-200", time: "~2 min" },
  medium: { label: "Medium", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", time: "~10 min" },
  effort: { label: "Full effort", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", time: "30+ min" },
};

function tierRequiresPhoto(category: string): boolean {
  return ["photo", "delivery", "errand", "check-in"].includes(category);
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 bg-white border border-gray-200">
      <div className="flex items-start gap-1.5">
        <Skeleton width={20} height={20} />
        <div className="flex-1 flex flex-col gap-1.5">
          <SkeletonTypography variant="body" level={2} />
          <SkeletonTypography variant="body" level={2} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton width={12} height={12} />
        <Skeleton width={112} height={12} />
        <Skeleton width={48} height={12} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton width={56} height={24} />
          <Skeleton width={80} height={24} />
        </div>
        <Skeleton width={64} height={40} />
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

type Tab = "available" | "polls" | "mine" | "completed";

const RELAY_BOT_ADDRESS = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";

export function Feed({ userId, verificationLevel, onLogout }: { userId: string | null; verificationLevel?: string | null; onLogout?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<"board" | "post" | "proof" | "detail" | "campaign" | "jury">("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<Tab>("available");
  const [tabDirection, setTabDirection] = useState<"left" | "right">("right");
  // Direction-aware tab switch so content phases in from the correct side (World App style)
  const changeTab = (next: Tab) => {
    const order: Tab[] = ["available", "polls", "completed"];
    setTabDirection(order.indexOf(next) >= order.indexOf(tab) ? "right" : "left");
    setTab(next);
  };
  const [mapMode, setMapMode] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<{ required: string; current: string } | null>(null);
  const [claimTxSuccess, setClaimTxSuccess] = useState<{ hash: string; taskId: string } | null>(null);
  const [claimTxError, setClaimTxError] = useState<{ message: string; taskId: string; retry: () => void } | null>(null);
  const [newTaskToast, setNewTaskToast] = useState<{ count: number; visible: boolean }>({ count: 0, visible: false });
  const [statusToast, setStatusToast] = useState<{ message: string; color: string; visible: boolean }>({ message: "", color: "", visible: false });
  const [changedTaskIds, setChangedTaskIds] = useState<Set<string>>(new Set());
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [claimConfirmTask, setClaimConfirmTask] = useState<Task | null>(null);
  const [claimSuccessTask, setClaimSuccessTask] = useState<Task | null>(null);
  const [claimCodeTask, setClaimCodeTask] = useState<Task | null>(null);
  const [claimCodeInput, setClaimCodeInput] = useState("");
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateNudge, setShowCreateNudge] = useState(false);
  const prevCompletedCount = useRef(0);
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

  const allAddresses = useMemo(() => [...new Set(tasks.flatMap(t => [t.poster, t.claimant].filter(Boolean) as string[]))], [tasks]);
  useWorldUsers(allAddresses);

  const fetchTasks = useCallback(async () => {
    try {
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
              statusMsg = `In progress: "${task.description.slice(0, 40)}${task.description.length > 40 ? "..." : ""}"`;
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
      setFetchError(false);
      setLoading(false);
    } catch {
      setFetchError(true);
      setLoading(false);
    }
  }, []);

  // Debounced fetchTasks: at most once every 2s even if multiple SSE events fire
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchTasks = useCallback(() => {
    if (fetchDebounceRef.current) return;
    fetchTasks();
    fetchDebounceRef.current = setTimeout(() => {
      fetchDebounceRef.current = null;
    }, 2000);
  }, [fetchTasks]);

  useEffect(() => {
    fetchTasks();

    // World App keeps the mini-app webview alive in the background, so without
    // this the board shows whatever was loaded last session until the user
    // pulls to refresh. Refetch every time the app comes back to foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") debouncedFetchTasks();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    };
  }, [fetchTasks, debouncedFetchTasks]);

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
        // Any message (including unnamed events) triggers a debounced refresh
        debouncedFetchTasks();
      };

      // Listen for all named task events as refresh signals
      // Using debouncedFetchTasks so rapid SSE bursts collapse into one fetch
      const eventTypes = ["task:created", "task:claimed", "task:proof", "task:verified", "task:completed", "task:failed"];
      for (const type of eventTypes) {
        es.addEventListener(type, () => {
          debouncedFetchTasks();
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
  }, [view, debouncedFetchTasks]);

  useEffect(() => {
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

  // Board visibility, ranking, and curation are rules, not vibes: the logic and
  // its constants live in src/lib/board-rank.ts (documented in BOARD-RULES.md,
  // guarded by src/__tests__/board-rank.test.ts).
  const filtered = useMemo(() => {
    const now = Date.now();
    if (tab === "available") {
      const visible = tasks.filter((t) => isBoardVisible(t, userId, now));
      return curateBoard(rankBoard(visible, { userId, userLocation, now }), userId);
    }
    return tasks.filter((t) => {
      if (t.status === "expired") return false;
      if (t.status === "cancelled") return false;
      if (t.status === "open" && new Date(t.deadline).getTime() < now) return false;
      if (tab === "mine") return t.poster === userId || t.claimant === userId;
      if (tab === "completed") return t.status === "completed";
      return true;
    });
  }, [tasks, tab, userLocation, userId]);

  // Freshness for returning users: remember when this device last saw the board,
  // then flag open favours posted since then so a returning user immediately sees
  // the app moved while they were away (the main "it's alive" signal). The
  // reference time is captured once on mount and held for the session; the stored
  // value is advanced to now so the NEXT return compares against this visit.
  const freshSince = useRef<number | null>(null);
  const [freshReady, setFreshReady] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("favour_last_visit");
      freshSince.current = stored ? Number(stored) : null;
      localStorage.setItem("favour_last_visit", String(Date.now()));
    } catch {}
    setFreshReady(true);
  }, []);
  const freshIds = useMemo(() => {
    const since = freshSince.current;
    if (!freshReady || !since) return new Set<string>();
    return new Set(
      filtered
        .filter((t) => t.status === "open" && new Date(t.createdAt).getTime() > since)
        .map((t) => t.id)
    );
  }, [filtered, freshReady]);

  const [heroVisible, setHeroVisible] = useState(true);
  const { myTaskCount, completedByClaiming, totalEarned, totalPosted, totalClaimed } = useMemo(() => {
    const myTasks = tasks.filter(t => t.poster === userId || t.claimant === userId);
    const completed = tasks.filter(t => t.claimant === userId && t.status === "completed");
    return {
      myTaskCount: myTasks.length,
      completedByClaiming: completed,
      totalEarned: completed.reduce((sum, t) => sum + (t.rewardType !== "points" && t.escrowTxHash ? t.bountyUsdc : 0), 0),
      totalPosted: tasks.filter(t => t.poster === userId).length,
      totalClaimed: tasks.filter(t => t.claimant === userId).length,
    };
  }, [tasks, userId]);

  // Detect first-time completion and show "create a task" nudge
  useEffect(() => {
    const currentCount = completedByClaiming.length;
    if (prevCompletedCount.current === 0 && currentCount > 0 && totalPosted === 0) {
      setShowCreateNudge(true);
    }
    prevCompletedCount.current = currentCount;
  }, [completedByClaiming.length, totalPosted]);

  const executeClaimTask = useCallback(async (task: Task, claimCode?: string) => {
    try {
      hapticTap();
      setClaimTxError(null);
      setClaimTxSuccess(null);

      try {
        if (task.taskType === "double-or-nothing" && isMiniKit() && DOUBLE_OR_NOTHING_ADDRESS && task.donOnChainId !== null) {
          const txPayload = encodeStakeAndClaimWithApproval(task.donOnChainId, task.bountyUsdc);
          if (txPayload) {
            const txResult = await MiniKit.sendTransaction(txPayload);
            if (!txResult) {
              setClaimTxError({ message: `Staking $${task.bountyUsdc} USDC failed. Please try again.`, taskId: task.id, retry: () => {} });
              hapticError();
              return;
            }
          }
        } else if (isMiniKit() && RELAY_ESCROW_ADDRESS && task.onChainId !== null) {
          const txPayload = encodeClaimTask(task.onChainId);
          if (txPayload) {
            const txResult = await MiniKit.sendTransaction(txPayload);
            if (!txResult) {
              setClaimTxError({ message: "On-chain claim failed. Please try again.", taskId: task.id, retry: () => {} });
              hapticError();
              return;
            }
          }
        }
      } catch (err) {
        if (isMiniKit()) {
          setClaimTxError({ message: err instanceof Error ? err.message : "Transaction failed. Please try again.", taskId: task.id, retry: () => {} });
          hapticError();
          return;
        }
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
        setStatusToast({ message: err.error || "Claim failed. Try again.", color: "text-error-600", visible: true });
        if (statusToastTimer.current) clearTimeout(statusToastTimer.current);
        statusToastTimer.current = setTimeout(() => setStatusToast(prev => ({ ...prev, visible: false })), 4000);
        return;
      }
      hapticSuccess();
      const claimed = await res.json();
      setClaimSuccessTask(claimed.task || task);
      fetchTasks();
    } catch (err) {
      setClaimTxError({ message: err instanceof Error ? err.message : "Claim failed. Try again.", taskId: task.id, retry: () => {} });
    }
  }, [userId, fetchTasks]);

  const campaigns = useMemo(() => getCampaigns(), []);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  // When the post wizard is opened from a campaign page, tasks it creates are
  // tagged with that campaign id (activates strict campaign scoping). Cleared for
  // any normal post so standalone tasks stay unlinked.
  const [postCampaignId, setPostCampaignId] = useState<string | null>(null);

  if (view === "campaign" && selectedCampaign) {
    return (
      <CampaignPage
        campaign={selectedCampaign}
        tasks={tasks}
        userId={userId}
        onBack={() => setView("board")}
        onTaskTap={(task) => { setSelectedTask(task); setView("detail"); }}
        onSubmitProof={(task) => { setSelectedTask(task); setView("proof"); }}
        onPostTask={() => { setPostCampaignId(selectedCampaign.id); setView("post"); }}
      />
    );
  }

  if (view === "jury") {
    return <JuryMode userId={userId} onClose={() => setView("board")} />;
  }

  if (view === "post") {
    return <PostTask userId={userId} campaignId={postCampaignId ?? undefined} onDone={() => { setPostCampaignId(null); setView("board"); fetchTasks(); }} onCancel={() => { setPostCampaignId(null); setView("board"); }} />;
  }

  if (view === "proof" && selectedTask) {
    return <SubmitProof task={selectedTask} userId={userId} onDone={() => { setView("board"); fetchTasks(); }} onCancel={() => setView("board")} onCreateTask={() => { setPostCampaignId(null); setView("post"); }} />;
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
      className="flex flex-col gap-0 max-w-lg mx-auto w-full min-h-screen bg-gray-50"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header - minimal. The top tab bar is GONE (Oscar Jul 5: two
          navigations create confusion) — Polls and History are bottom-nav
          pages now; this screen is only the board. */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-gray-100">
        <div className="flex items-center justify-between px-6 py-3">
          <h1 className="text-[18px] font-bold tracking-tight text-gray-900">FAVOUR</h1>
          {userId && (
            <button
              onClick={() => { hapticTap(); setPostCampaignId(null); setView("post"); }}
              className="bg-gray-900 text-white text-[13px] font-semibold px-4 py-2 rounded-full active:scale-95 transition-transform min-h-[36px]"
            >
              + New
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div
        key={tab}
        className="flex-1 flex flex-col"
      >

      {/* Animated hero - Tasks. The hook leads; the numbers support it. */}
      {tab === "available" && !loading && (
        <div className="px-6 pt-6 pb-2 animate-[fadeSlideIn_0.4s_ease-out]">
          <p className="text-[19px] font-bold text-gray-900 tracking-tight leading-snug">
            Do a favour. Prove it. Get rewarded.
          </p>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-gray-900">{tasks.filter(t => t.status === "open").length}</span>
              <span className="text-[12px] text-gray-400">open now</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-gray-200" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-gray-900">{tasks.filter(t => t.status === "completed").length}</span>
              <span className="text-[12px] text-gray-400">verified</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-gray-200" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-gray-900">${tasks.filter(t => (t.onChainId != null || t.escrowTxHash) && t.settlementTx).reduce((s, t) => s + t.bountyUsdc, 0).toFixed(0)}</span>
              <span className="text-[12px] text-gray-400">paid out</span>
            </div>
          </div>
        </div>
      )}

      {/* Returning-user freshness: activity while you were away. */}
      {tab === "available" && !loading && freshReady && freshIds.size > 0 && (
        <div className="px-6 pb-1 animate-[fadeSlideIn_0.4s_ease-out]">
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-gray-200 pl-2.5 pr-3 py-1.5">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex w-full h-full rounded-full bg-green-400 opacity-70 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-green-500" />
            </span>
            <span className="text-[12px] font-medium text-gray-700">
              {freshIds.size} new since you were here
            </span>
          </div>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      <div
        className="flex items-center justify-center overflow-hidden transition-all duration-200 ease-out"
        style={{ height: pullDistance > 0 || isRefreshing ? `${Math.max(pullDistance, isRefreshing ? 40 : 0)}px` : "0px" }}
        aria-live="polite"
      >
        {isRefreshing ? (
          <svg className="w-5 h-5 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : pullDistance > 0 ? (
          <div className="flex flex-col items-center gap-1">
            <svg
              className="w-4 h-4 text-gray-400 transition-transform duration-150"
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
            <span className="text-xs text-gray-500">
              {pullDistance >= 60 ? "Release to refresh" : "Pull to refresh"}
            </span>
          </div>
        ) : null}
      </div>

      {/* Scroll anchor for "new tasks" toast */}
      <div ref={feedTopRef} />

      {/* New tasks toast */}
      {newTaskToast.visible && newTaskToast.count > 0 && (
        <div className="px-6 pt-4">
          <button
            onClick={() => {
              feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
              setNewTaskToast({ count: 0, visible: false });
            }}
            className="w-full bg-white border border-gray-200 rounded-xl px-5 py-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-sm font-medium text-gray-900">
              {newTaskToast.count} new {newTaskToast.count === 1 ? "favour" : "favours"} available
            </span>
          </button>
        </div>
      )}

      {/* Status change toast */}
      {statusToast.visible && statusToast.message && (
        <div className="px-6 pt-4">
          <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 flex items-center gap-3">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-warning-600" />
            </span>
            <span className={`text-sm font-medium ${statusToast.color}`}>
              {statusToast.message}
            </span>
          </div>
        </div>
      )}

      {/* Hierarchy (Oscar Jul 5 screenshot): ONE hero leads, everything else
          secondary — the second campaign and the game share a compact duo row,
          zero-task campaigns are invisible (no link graveyard), and the task
          list starts inside the first viewport. */}
      {tab === "available" && !loading && campaigns.length > 0 && (() => {
        const openCountFor = (c: Campaign) =>
          tasks.filter((t) => t.campaignId === c.id && t.status === "open").length;
        const live = campaigns
          .filter((c) => openCountFor(c) > 0)
          .sort((a, b) => Number(b.featured) - Number(a.featured));
        const hero = live[0];
        const second = live[1];
        return (
          <div className="px-6 pt-4 flex flex-col gap-2.5">
            {hero && (
              <FeaturedCampaignBanner
                campaign={hero}
                taskCount={tasks.length}
                completedCount={tasks.filter(t => t.status === "completed").length}
                tasks={tasks}
                onTap={() => { hapticTap(); setSelectedCampaign(hero); setView("campaign"); }}
              />
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {second && (
                <button
                  onClick={() => { hapticTap(); setSelectedCampaign(second); setView("campaign"); }}
                  className="relative h-[72px] rounded-xl overflow-hidden active:scale-[0.97] transition-transform text-left"
                >
                  {second.heroImage && (
                    <img src={second.heroImage} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-black/35" />
                  <div className="relative h-full px-3.5 py-2.5 flex flex-col justify-end">
                    <p className="text-[13px] font-bold text-white leading-tight line-clamp-1">{second.name}</p>
                    <p className="text-[10px] text-white/60 mt-0.5">
                      {second.unlock ? `$${second.unlock.unlockAmount} unlock` : `${openCountFor(second)} tasks`}
                    </p>
                  </div>
                </button>
              )}
              <button
                onClick={() => { hapticTap(); setView("jury"); }}
                className={`relative h-[72px] rounded-xl overflow-hidden active:scale-[0.97] transition-transform text-left ${second ? "" : "col-span-2"}`}
              >
                <img src="/hero/cyclist.jpg" alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-black/35" />
                <div className="relative h-full px-3.5 py-2.5 flex flex-col justify-end">
                  <p className="text-[13px] font-black text-white leading-tight tracking-wider">REAL OR NOT</p>
                  <p className="text-[10px] text-white/60 mt-0.5">Swipe proofs, earn points</p>
                </div>
                <span className="absolute top-2 right-2 flex -space-x-1">
                  <span className="w-5 h-5 rounded-full bg-black/50 border border-red-400/60 flex items-center justify-center text-red-400 text-[9px] font-black">✕</span>
                  <span className="w-5 h-5 rounded-full bg-black/50 border border-green-400/60 flex items-center justify-center text-green-400 text-[9px] font-black">✓</span>
                </span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* Polls tab */}
      {tab === "polls" && (
        <div className="flex-1 px-6 py-4">
          <PollsFeed userId={userId} />
        </div>
      )}

      {/* Content */}
      {tab !== "polls" && (
      <div className="flex-1 px-6 py-4">
        {/* Profile summary for "Mine" tab */}
        {tab === "mine" && (
          <div className="mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-gray-900 flex items-center justify-center">
                  <span className="text-sm font-bold text-white">{userId?.slice(-2).toUpperCase()}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{userId ? shortId(userId) : ""}</p>
                  <VerificationBadge level={verificationLevel} size="md" />
                </div>
                <button onClick={onLogout} className="text-[11px] text-gray-400 min-h-[44px] flex items-center">
                  Sign out
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-bold text-gray-900">${totalEarned.toFixed(0)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Earned</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{completedByClaiming.length}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Done</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{totalPosted}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Posted</p>
                </div>
              </div>
            </div>
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
        ) : fetchError && tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-400 font-medium">Failed to load favours</p>
              <p className="text-xs text-gray-500 mt-1">Check your connection and try again.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoading(true);
                setFetchError(false);
                fetchTasks();
              }}
            >
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <>
            <div className="flex flex-col items-center justify-center py-20 gap-2 animate-[fadeSlideIn_0.4s_ease-out]">
              <p className="text-[28px] font-bold text-gray-200 tracking-tight">
                {tab === "available" ? "No tasks yet" : tab === "mine" ? "Nothing yet" : "No history"}
              </p>
              <p className="text-[14px] text-gray-400">
                {tab === "available" ? "Check back soon or post one" : "Complete a task to see it here"}
              </p>
            </div>
            {tab === "available" && <FeedPolls userId={userId} limit={POLL_CARDS_MAX} />}
          </>
        ) : tab === "completed" ? (
          <div className="flex flex-col gap-2.5">
            {filtered.map((task) => (
              <div
                key={task.id}
                className="rounded-2xl overflow-hidden bg-white border border-gray-200 cursor-pointer active:scale-[0.98] transition-all"
                onClick={() => { setSelectedTask(task); setView("detail"); }}
              >
                {task.proofImageUrl && (
                  <div className="relative">
                    <img src={task.proofImageUrl} alt="Proof" className="w-full h-40 object-cover" loading="lazy" />
                    <div className="absolute bottom-2 left-2">
                      <span className="text-[11px] font-bold text-white bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1">{rewardLabel(task)}</span>
                    </div>
                  </div>
                )}
                <div className="p-4">
                  <p className="text-[14px] font-medium leading-snug break-words text-gray-900">{task.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-400 truncate max-w-[140px]">{task.location}</span>
                    <span className="text-xs text-gray-300">&middot;</span>
                    <span className="text-xs text-gray-400">{timeAgo(task.createdAt)}</span>
                    {!task.proofImageUrl && <span className="text-xs text-success-600 font-medium ml-auto">{rewardLabel(task)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((task, i) => (
              <Fragment key={task.id}>
                {/* R2 (BOARD-RULES.md): polls never lead the board — they render
                    after the first POLL_INSERT_AFTER task cards. */}
                {tab === "available" && i === POLL_INSERT_AFTER && (
                  <FeedPolls userId={userId} limit={POLL_CARDS_MAX} />
                )}
                <div
                  style={{ animationDelay: `${i * 50}ms` }}
                  className="rounded-2xl"
                >
                  <TaskCard
                    task={task}
                    userId={userId}
                    userLocation={userLocation}
                    verificationLevel={verificationLevel}
                    isNew={tab === "available" && freshIds.has(task.id)}
                    onTap={() => {
                      setSelectedTask(task);
                      setView("detail");
                    }}
                    onClaim={() => {}}
                    onSubmitProof={() => {
                      setSelectedTask(task);
                      setView("proof");
                    }}
                  />
                </div>
              </Fragment>
            ))}
            {tab === "available" && filtered.length <= POLL_INSERT_AFTER && (
              <FeedPolls userId={userId} limit={POLL_CARDS_MAX} />
            )}
          </div>
        )}
      </div>
      )}

      {/* Claim transaction success banner */}
      {claimTxSuccess && (
        <div className="mx-4 mb-2 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-green-600 font-medium">Confirmed on World Chain</p>
            <p className="text-xs text-gray-400 font-mono truncate">{claimTxSuccess.hash}</p>
          </div>
          <a
            href={`https://worldscan.org/tx/${claimTxSuccess.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-900 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
          >
            Explorer
          </a>
          <button
            onClick={() => setClaimTxSuccess(null)}
            className="text-gray-400 hover:text-gray-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
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
            className="text-xs text-gray-900 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center font-medium"
          >
            Retry
          </button>
          <button
            onClick={() => setClaimTxError(null)}
            className="text-gray-400 hover:text-gray-500 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Dismiss error"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center py-6">
        <span className="text-[10px] text-gray-300 tracking-wide">RELAY &middot; World Chain</span>
      </div>

      </div>
      {/* End tab content */}

      {/* Upgrade prompt modal */}
      <AlertDialog open={!!upgradePrompt} onOpenChange={() => setUpgradePrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            }
          >
            <AlertDialogTitle>Verification Required</AlertDialogTitle>
            <AlertDialogDescription>World ID upgrade needed</AlertDialogDescription>
          </AlertDialogHeader>

          {upgradePrompt && (
            <div className="px-6 pb-4">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider">Required level</Typography>
                  <Typography variant="body" level={3} className="font-semibold">
                    {upgradePrompt.required === "orb" ? "Orb Verified" : upgradePrompt.required === "device" ? "Device Verified" : "Wallet Verified"}
                  </Typography>
                </div>
                <div className="flex items-center justify-between">
                  <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider">Your level</Typography>
                  <Typography variant="body" level={3} className="font-medium">
                    {upgradePrompt.current === "orb" ? "Orb" : upgradePrompt.current === "device" ? "Device" : upgradePrompt.current === "wallet" ? "Wallet" : "None"}
                  </Typography>
                </div>
              </div>

              <Typography variant="body" level={4} className="text-gray-400 leading-relaxed">
                Verify your identity in World App to unlock higher-paying bounties.
              </Typography>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogClose asChild>
              <Button fullWidth variant="primary" size="lg">Got it</Button>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Post-claim guidance dialog */}
      <AlertDialog open={!!claimSuccessTask} onOpenChange={() => { setClaimSuccessTask(null); changeTab("mine"); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--success-600))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <AlertDialogTitle>Favour accepted!</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {claimSuccessTask ? `Here's how to earn ${rewardLabel(claimSuccessTask)}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {claimSuccessTask && (() => {
            const info = proofInstructions(claimSuccessTask);
            return (
              <div className="px-6 pb-4 flex flex-col gap-3">
                {info.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-gray-500">{i + 1}</span>
                    </span>
                    <Typography variant="body" level={3} className="text-gray-700">{step}</Typography>
                  </div>
                ))}
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mt-1">
                  <Typography variant="body" level={4} className="text-gray-500">{info.tip}</Typography>
                </div>
              </div>
            );
          })()}

          <AlertDialogFooter>
            <Button
              fullWidth
              variant="primary"
              size="lg"
              onClick={() => {
                setClaimSuccessTask(null);
                changeTab("mine");
              }}
            >
              Got it
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "Create a task" nudge after first completion */}
      <AlertDialog open={showCreateNudge} onOpenChange={() => setShowCreateNudge(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <AlertDialogTitle>Nice work!</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              You just completed your first favour. Now create one for someone else. Post a task and let others help you out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose asChild>
              <Button fullWidth variant="secondary" size="lg">Maybe later</Button>
            </AlertDialogClose>
            <Button
              fullWidth
              variant="primary"
              size="lg"
              onClick={() => {
                setShowCreateNudge(false);
                hapticTap();
                setPostCampaignId(null);
                setView("post");
              }}
            >
              + Create a Favour
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getAgentReason(agentId: string): string {
  const reasons: Record<string, string> = {
    shelfwatch: "Brands need real shelf data. No API for that.",
    freshmap: "Local data goes stale fast. Humans keep it fresh.",
    queuepulse: "No API for real-time queues. Only a human can check.",
    propertycheck: "Listings lie. Someone needs to walk by.",
    dropscout: "Eyes on drops and pop-ups, before anyone else.",
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
  isNew,
}: {
  task: Task;
  userId: string | null;
  userLocation?: { lat: number; lng: number } | null;
  verificationLevel?: string | null;
  onTap: () => void;
  onClaim: () => void;
  onSubmitProof: () => void;
  isNew?: boolean;
}) {
  const isOwnTask = task.poster === userId;
  const isClaimant = task.claimant === userId;
  const distance = userLocation && task.lat && task.lng
    ? haversineKm(userLocation.lat, userLocation.lng, task.lat, task.lng)
    : null;

  const hoursLeft = (new Date(task.deadline).getTime() - Date.now()) / 3600_000;
  const isUrgent = task.status === "open" && (hoursLeft < 4 || task.bountyUsdc >= 15);
  const isAgentTask = !!(task.agent || task.poster?.startsWith("agent_"));
  const taskAgeDays = (Date.now() - new Date(task.createdAt).getTime()) / (24 * 3600_000);
  const isStale = task.status === "open" && !task.claimant && taskAgeDays >= 7;

  return (
    <div
      onClick={onTap}
      className="rounded-2xl p-4 flex flex-col gap-3 cursor-pointer active:scale-[0.98] transition-all bg-white border border-gray-200"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 shrink-0 mt-0.5">
          <CategoryIcon category={task.category} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium leading-snug break-words text-gray-900 line-clamp-2">{task.description}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {isNew && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-900 bg-gray-100 rounded px-1.5 py-0.5 shrink-0">New</span>
            )}
            <span className="text-xs text-gray-400 truncate max-w-[140px]">{task.location}</span>
            {distance !== null && (
              <>
                <span className="text-xs text-gray-300">&middot;</span>
                <span className="text-xs text-gray-500 font-medium">{formatDistance(distance)}</span>
              </>
            )}
            <span className="text-xs text-gray-300">&middot;</span>
            <span className="text-xs text-gray-400">{timeAgo(task.createdAt)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <RewardBadge task={task} hero />
        </div>
      </div>

      {task.status === "open" && userId && !isOwnTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="w-full bg-gray-900 text-white text-[13px] font-semibold py-3 rounded-xl active:scale-[0.98] transition-transform min-h-[44px]"
        >
          Do it
        </button>
      )}

      {task.status === "claimed" && isClaimant && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="w-full border border-gray-200 text-gray-900 text-[13px] font-semibold py-3 rounded-xl active:scale-[0.98] transition-transform min-h-[44px]"
        >
          Submit Proof
        </button>
      )}

      {isOwnTask && task.status === "open" && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400">You posted</span>
          {task.rewardType !== "points" && !task.escrowTxHash && <span className="text-[11px] text-warning-600">&middot; Not funded yet</span>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    open: "Open",
    claimed: "In progress",
    completed: "Done",
    failed: "Failed",
    expired: "Expired",
  };

  return (
    <Pill checked={status === "completed"}>
      {labels[status] || status}
    </Pill>
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
      <span className="text-xs font-bold tracking-wide" style={{ color: agent.color }}>
        {agent.name}
      </span>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={agent.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    </div>
  );
}

// VerificationBadge and RequiredTierBadge are imported from @/components/VerificationBadge

// Shared with the tasks API, which rejects verbatim template copy — templates
// are hints shown as the placeholder, never submitted text.

// Minimal stroke icons for the post templates (design system: SVG, not emoji).
function TemplateIcon({ index }: { index: number }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (index) {
    case 0: return <svg {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
    case 1: return <svg {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>;
    case 2: return <svg {...p}><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>;
    case 3: return <svg {...p}><rect width="14" height="20" x="5" y="2" rx="2" /><path d="M12 18h.01" /></svg>;
    case 4: return <svg {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>;
    default: return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
  }
}

// Guided create-favour wizard. One decision per screen, tap to advance,
// micro-animated step transitions. State + submit logic are unchanged from the
// old single-screen form: only the render/flow is rebuilt into a step machine.
// Steps: 0 pick type -> 1 describe -> 2 reward + fund (goes live) -> 3 confirmation.
type WizardStep = 0 | 1 | 2 | 3;

function PostTask({
  userId,
  onDone,
  onCancel,
  campaignId,
}: {
  userId: string | null;
  onDone: () => void;
  onCancel: () => void;
  campaignId?: string;
}) {
  const [description, setDescription] = useState("");
  const [locationMode, setLocationMode] = useState<"online" | "inperson">("online");
  const [location, setLocation] = useState("Online");
  const [bounty, setBounty] = useState("");
  const [rewardType, setRewardType] = useState<"usdc" | "points">("points");
  const [category, setCategory] = useState<"photo" | "delivery" | "check-in" | "custom" | "feedback" | "review" | "social" | "errand">("review");
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [escrowSuccess, setEscrowSuccess] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  // Step machine + transition direction (drives the left/right micro-animation).
  const [step, setStep] = useState<WizardStep>(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");

  const goTo = (next: WizardStep, direction: "fwd" | "back" = "fwd") => {
    hapticTap();
    setDir(direction);
    setStep(next);
  };

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleTemplate = (idx: number) => {
    const t = POST_TEMPLATES[idx];
    hapticSelection();
    setSelectedTemplate(idx);
    // The template text is only a placeholder hint; the user writes their own
    // description (the API rejects verbatim template copy).
    setDescription("");
    setBounty(t.bounty);
    setCategory(t.category);
    // One tap on a type advances straight to Describe.
    setDir("fwd");
    setStep(1);
  };

  const handleBack = () => {
    if (step === 0) { hapticTap(); onCancel(); return; }
    goTo((step - 1) as WizardStep, "back");
  };

  const handleSubmit = async () => {
    if (!description || !location || !bounty || !userId) return;
    setSubmitting(true);

    let onChainId: number | null = null;
    let escrowTxHash: string | null = null;

    if (rewardType === "usdc" && isMiniKit() && RELAY_ESCROW_ADDRESS) {
      const txPayload = encodeCreateTask(description, parseFloat(bounty), 24);
      if (txPayload) {
        try {
          const countBefore = await readTaskCount().catch(() => 0);
          const txResult = await MiniKit.sendTransaction(txPayload);
          if (txResult) {
            onChainId = countBefore;
            escrowTxHash = extractTxHash(txResult);
            if (escrowTxHash) {
              hapticSuccess();
              setEscrowSuccess(escrowTxHash);
            }
          } else {
            hapticError();
            setTxError("Transaction was rejected. Your USDC was not charged.");
            setSubmitting(false);
            return;
          }
        } catch (err) {
          hapticError();
          setTxError(err instanceof Error ? err.message : "Transaction failed. Your USDC was not charged.");
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      const res = await fetch("/api/tasks", {
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
          rewardType,
          campaignId,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        hapticError();
        setTxError(errData.error || "Failed to create task.");
        setSubmitting(false);
        return;
      }
      hapticSuccess();
    } catch {
      hapticError();
      setTxError("Network error. Please try again.");
      setSubmitting(false);
      return;
    }
    // Live: advance to the confirmation screen instead of leaving immediately.
    setSubmitting(false);
    setDir("fwd");
    setStep(3);
  };

  const isInWorld = isMiniKit();
  const isValid = description && location && bounty && parseFloat(bounty) >= (rewardType === "points" ? 1 : 0.5);
  const canDescribe = description.trim().length >= MIN_DESCRIPTION_LENGTH && !!location.trim();

  // Reward-shaped object so RewardBadge / reward.ts stay the single source of truth
  // for the points-vs-money distinction on the confirmation screen.
  const rewardPreview = { rewardType, bountyUsdc: parseFloat(bounty) || 0, escrowTxHash: escrowSuccess };

  const stepTitle = step === 0 ? "Pick a type" : step === 1 ? "Describe it" : step === 2 ? "Set the reward" : "You're live";
  const stepAnim = dir === "back" ? "tab-slide-left" : "tab-slide-right";

  const presets = rewardType === "points" ? ["1", "5", "10"] : ["5", "15", "25"];

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-gray-50">
      <TopBar
        title={stepTitle}
        startAdornment={
          step === 3
            ? <span />
            : <Button variant="tertiary" size="sm" onClick={handleBack} aria-label={step === 0 ? "Cancel" : "Back"}>{step === 0 ? "Cancel" : "Back"}</Button>
        }
      />

      {/* Progress dots (3 build steps; hidden on the terminal confirmation) */}
      {step < 3 && (
        <div className="flex items-center justify-center gap-2 pt-3 pb-1">
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                d === step ? "w-6 bg-gray-900" : d < step ? "w-1.5 bg-gray-900" : "w-1.5 bg-gray-200"
              }`}
            />
          ))}
        </div>
      )}

      {/* Re-keyed so each step phases in with a micro-animation */}
      <div key={step} className={`flex-1 flex flex-col ${stepAnim}`}>

        {/* STEP 0 - Pick type */}
        {step === 0 && (
          // One airy column, example text as the hook, zero system metadata —
          // the old 2-col grid with uppercase tier labels read "typed, not
          // breathing" (Oscar Jul 5 review).
          <div className="flex-1 px-6 py-6 flex flex-col gap-3">
            <Typography variant="body" level={3} className="text-gray-400 mb-1">What do you need?</Typography>
            {POST_TEMPLATES.map((t, i) => (
              <button
                key={i}
                onClick={() => handleTemplate(i)}
                className="flex items-start gap-3.5 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-left transition-all active:scale-[0.98] hover:border-gray-300"
              >
                <span className="text-gray-900 shrink-0 mt-0.5"><TemplateIcon index={i} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-gray-900 leading-tight">{t.label}</span>
                  <span className="block text-[12px] text-gray-400 mt-1 leading-relaxed line-clamp-2">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* STEP 1 - Describe */}
        {step === 1 && (
          <div className="flex-1 px-6 py-5 flex flex-col gap-6">
            <div>
              <Typography variant="label" level={2} className="text-gray-400 mb-2">Description</Typography>
              <textarea
                placeholder={selectedTemplate !== null ? `e.g. ${POST_TEMPLATES[selectedTemplate].desc}` : "Describe exactly what you need done..."}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                autoFocus
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400"
              />
              <Typography variant="body" level={4} className="text-gray-400 mt-1.5">In your own words — be specific about what counts as done.</Typography>
            </div>

            <div>
              <Typography variant="label" level={2} className="text-gray-400 mb-2">Where?</Typography>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { hapticSelection(); setLocationMode("online"); setLocation("Online"); }}
                  className={`flex-1 rounded-xl border py-3 text-center transition-all min-h-[44px] active:scale-[0.98] ${
                    locationMode === "online" ? "border-gray-900 bg-white" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <Typography variant="body" level={3} className={locationMode === "online" ? "text-gray-900 font-semibold" : "text-gray-500"}>Online</Typography>
                </button>
                <button
                  onClick={() => { hapticSelection(); setLocationMode("inperson"); setLocation(""); }}
                  className={`flex-1 rounded-xl border py-3 text-center transition-all min-h-[44px] active:scale-[0.98] ${
                    locationMode === "inperson" ? "border-gray-900 bg-white" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <Typography variant="body" level={3} className={locationMode === "inperson" ? "text-gray-900 font-semibold" : "text-gray-500"}>In person</Typography>
                </button>
              </div>
              {locationMode === "inperson" && (
                <input
                  type="text"
                  placeholder="Address, venue name, or area"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="mt-2 w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400 min-h-[44px] animate-[slideDown_0.25s_ease-out]"
                />
              )}
            </div>
          </div>
        )}

        {/* STEP 2 - Reward + fund */}
        {step === 2 && (
          <div className="flex-1 px-6 py-6 flex flex-col gap-8">
            <div>
              <Typography variant="label" level={2} className="text-gray-400 mb-2">Reward type</Typography>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { hapticSelection(); setRewardType("points"); }}
                  className={`flex-1 rounded-xl border py-4 text-center transition-all min-h-[52px] active:scale-[0.98] ${
                    rewardType === "points" ? "border-gray-900 bg-white" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <Typography variant="body" level={3} className={rewardType === "points" ? "text-gray-900 font-semibold" : "text-gray-500"}>Points</Typography>
                  <Typography variant="body" level={4} className="text-gray-400 mt-0.5">Free to post</Typography>
                </button>
                <button
                  onClick={() => { hapticSelection(); setRewardType("usdc"); }}
                  className={`flex-1 rounded-xl border py-4 text-center transition-all min-h-[52px] active:scale-[0.98] ${
                    rewardType === "usdc" ? "border-gray-900 bg-white" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <Typography variant="body" level={3} className={rewardType === "usdc" ? "text-gray-900 font-semibold" : "text-gray-500"}>USDC</Typography>
                  <Typography variant="body" level={4} className="text-gray-400 mt-0.5">On-chain escrow</Typography>
                </button>
              </div>
            </div>

            <div>
              <Typography variant="label" level={2} className="text-gray-400 mb-2">{rewardType === "points" ? "Points amount" : "Reward"}</Typography>
              <div className="flex items-center gap-3">
                {presets.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => { hapticSelection(); setBounty(amt); }}
                    className={`flex-1 rounded-xl border py-4 text-center transition-all min-h-[52px] active:scale-[0.98] ${
                      bounty === amt ? "border-gray-900 bg-white" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <Typography variant="number" level={3} className={`whitespace-nowrap ${bounty === amt ? "text-gray-900" : "text-gray-500"}`}>{rewardType === "points" ? `${amt} pts` : `$${amt}`}</Typography>
                  </button>
                ))}
                <div className="flex-1 flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-3 py-4 min-h-[52px]">
                  {rewardType === "usdc" && <span className="text-sm text-gray-400">$</span>}
                  <input
                    type="number"
                    placeholder="Other"
                    min={rewardType === "points" ? "1" : "0.50"}
                    max={rewardType === "points" ? "10" : undefined}
                    step={rewardType === "points" ? "1" : "0.50"}
                    value={!presets.includes(bounty) ? bounty : ""}
                    onChange={(e) => setBounty(e.target.value)}
                    className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-gray-400 w-12"
                  />
                  {rewardType === "points" && <span className="text-sm text-gray-400">pts</span>}
                </div>
              </div>
              {rewardType === "points" && <Typography variant="body" level={4} className="text-gray-400 mt-1.5">Points run from 1 to 10.</Typography>}
            </div>

            {/* Reward + escrow explainer */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-gray-900 mt-0.5">
                  {rewardType === "points" ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                  ) : isInWorld ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  )}
                </span>
                <div>
                  {rewardType === "points" ? (
                    <>
                      <Typography variant="body" level={3} className="text-gray-700 font-medium">Points reward</Typography>
                      <Typography variant="body" level={4} className="text-gray-400 mt-0.5">
                        No USDC needed. The runner earns points when AI verifies their proof. Great for low-stakes tasks and feedback.
                      </Typography>
                    </>
                  ) : isInWorld ? (
                    <>
                      <Typography variant="body" level={3} className="text-gray-700 font-medium">Your USDC goes to escrow</Typography>
                      <Typography variant="body" level={4} className="text-gray-400 mt-0.5">
                        Held in a smart contract. Released to the runner when AI verifies their proof. Returned to you if no one completes it in 24h.
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="body" level={3} className="text-gray-700 font-medium">Funding requires World App</Typography>
                      <Typography variant="body" level={4} className="text-gray-400 mt-0.5">
                        Your task will be posted but unfunded. Open it in World App to deposit USDC and make it live.
                      </Typography>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3 - Confirmation / live */}
        {step === 3 && (
          <div className="flex-1 px-6 py-5 flex flex-col items-center justify-center gap-5 text-center">
            <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center animate-[checkPop_0.5s_ease-out]">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--success-600))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Typography variant="heading" level={3} className="text-gray-900">Your favour is live</Typography>
              <Typography variant="body" level={3} className="text-gray-400 max-w-[260px]">
                {rewardType !== "points" && !escrowSuccess
                  ? "Posted unfunded. Open it in World App to deposit USDC and activate it."
                  : "Runners can pick it up now. You'll be notified when someone completes it."}
              </Typography>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 w-full max-w-[320px] flex items-center justify-between">
              <Typography variant="body" level={3} className="text-gray-700 text-left flex-1 pr-3 line-clamp-2">{description}</Typography>
              <RewardBadge task={rewardPreview} />
            </div>
            {escrowSuccess && (
              <a
                href={`https://worldscan.org/tx/${escrowSuccess}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-900 underline underline-offset-2"
              >
                View escrow transaction
              </a>
            )}
          </div>
        )}
      </div>

      {/* Footer action bar (per step) */}
      <div className="px-6 pb-8 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
        {txError && (
          <div className="mb-4 bg-error-100 border border-error-200 rounded-xl p-4 flex items-center justify-between">
            <Typography variant="body" level={3} className="text-error-700 font-medium">{txError}</Typography>
            <button onClick={() => setTxError(null)} className="min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Dismiss error">
              <Typography variant="body" level={3} className="text-error-400">&#x2715;</Typography>
            </button>
          </div>
        )}

        {step === 1 && (
          <Button onClick={() => goTo(2)} disabled={!canDescribe} variant="primary" fullWidth size="lg">
            Continue
          </Button>
        )}

        {step === 2 && (
          <LiveFeedback state={submitting ? "pending" : undefined}>
            <Button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              variant="primary"
              fullWidth
              size="lg"
            >
              {submitting ? "Posting..." : rewardType === "points" ? `Post - ${bounty || "0"} pts` : isInWorld ? `Post & Fund $${bounty || "0"} USDC` : "Post Favour"}
            </Button>
          </LiveFeedback>
        )}

        {step === 3 && (
          <Button onClick={onDone} variant="primary" fullWidth size="lg">
            Back to feed
          </Button>
        )}
      </div>
    </div>
  );
}

function SubmitProof({
  task,
  userId,
  onDone,
  onCancel,
  onCreateTask,
}: {
  task: Task;
  userId: string | null;
  onDone: () => void;
  onCancel: () => void;
  onCreateTask?: () => void;
}) {
  const MAX_PHOTOS = 3;
  const [proofNote, setProofNote] = useState("");
  const [images, setImages] = useState<{ base64: string; preview: string; isVideo: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ verdict: string; reasoning: string; locationVerified?: boolean; distanceKm?: number; escrowReleaseTxHash?: string | null } | null>(null);
  const [proofCoords, setProofCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [preCheck, setPreCheck] = useState<{ assessment: string; likely: "pass" | "marginal" | "retake" } | null>(null);
  const [preChecking, setPreChecking] = useState(false);
  const hasAutoChecked = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setProofCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    if (images.length > 0 && !hasAutoChecked.current && !result && !submitting) {
      hasAutoChecked.current = true;
      setPreChecking(true);
      setPreCheck(null);
      fetch("/api/proof-precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: images[0].base64,
          taskDescription: task.description,
        }),
      })
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => setPreCheck({ assessment: data.assessment, likely: data.likely }))
        .catch(() => {})
        .finally(() => setPreChecking(false));
    }
    if (images.length === 0) {
      hasAutoChecked.current = false;
      setPreCheck(null);
    }
  }, [images, result, submitting, task.description]);

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
          submitter: userId || task.claimant,
          proofImageBase64: proofImages[0] || null,
          proofImages: proofImages.length > 0 ? proofImages : [],
          proofNote: proofNote || null,
          lat: proofCoords?.lat || null,
          lng: proofCoords?.lng || null,
        }),
      });

      if (!res.ok) {
        // The server writes actionable rejections (daily cap with reset info,
        // verification-tier requirements, already-claimed). Show them verbatim —
        // a generic "try again" tells users to retry actions that fail forever.
        const err = await res.json().catch(() => ({} as Record<string, unknown>));
        const serverMsg =
          (typeof err.message === "string" && err.message) ||
          (typeof err.error === "string" && err.error) ||
          "We couldn't process your submission just now. Your proof wasn't judged. Please try again.";
        setResult({ verdict: "error", reasoning: serverMsg });
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
        escrowReleaseTxHash: data.escrowReleaseTxHash || null,
      });
      setSubmitting(false);

      if (data.verification.verdict === "pass") {
        hapticSuccess();
        // No auto-navigate: the pass panel is the reward moment and carries the
        // Share CTA — let the user leave when they're done reading it.
      } else if (data.verification.verdict === "fail") {
        hapticError();
      } else {
        hapticSelection();
      }
    } catch {
      setResult({ verdict: "error", reasoning: "Network hiccup. Your proof wasn't judged. Please try again." });
      setSubmitting(false);
      hapticError();
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto w-full">
      <TopBar
        title="Submit proof"
        startAdornment={
          <Button variant="tertiary" size="sm" onClick={onCancel}>Cancel</Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] flex flex-col gap-5">
        {/* Task context with tier badge */}
        {(() => {
          const tier = getTaskTier(task.category);
          const tc = TIER_CONFIG[tier];
          const instructions = proofInstructions(task);
          const needsPhoto = tierRequiresPhoto(task.category);
          return (
            <>
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${tc.bg} ${tc.color}`}>
                    {tc.label} · {tc.time}
                  </span>
                  <span className="text-xs font-medium text-gray-900">{rewardLabel(task)}</span>
                </div>
                <p className="text-sm font-medium leading-snug text-gray-900">{task.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9BA3AE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span className="text-xs text-gray-500">{task.location}</span>
                </div>
              </div>

              {/* Steps checklist */}
              <div className="bg-gray-50 rounded-xl p-3.5">
                <p className="text-xs font-semibold text-gray-700 mb-2">{instructions.short}</p>
                <ol className="space-y-1.5">
                  {instructions.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-500">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500 mt-0.5">{i + 1}</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="text-[10px] text-gray-400 mt-2 italic">{instructions.tip}</p>
              </div>

              {/* LOW-FRICTION: text first, photo optional */}
              {!needsPhoto && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">
                      Your response {task.category === "social" ? "(or paste link)" : ""}
                    </label>
                    <textarea
                      placeholder={task.category === "feedback" ? "Type your feedback here..." : task.category === "social" ? "Paste your post link or describe what you shared..." : "Write your response..."}
                      value={proofNote}
                      onChange={(e) => setProofNote(e.target.value)}
                      rows={4}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">
                      {task.category === "social" ? "Screenshot (recommended)" : "Photo (optional)"}
                    </label>
                    {images.length > 0 ? (
                      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                        {images.map((img, i) => (
                          <div key={i} className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-gray-200">
                            <img src={img.preview} alt={`Proof ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                            <button
                              onClick={() => removeImage(i)}
                              className="absolute -top-1 -right-1 w-6 h-6 bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            >
                              x
                            </button>
                          </div>
                        ))}
                        {images.length < MAX_PHOTOS && (
                          <label className="shrink-0 w-20 h-20 rounded-xl border border-dashed border-gray-200 flex items-center justify-center cursor-pointer bg-gray-50">
                            <span className="text-gray-400 text-lg">+</span>
                            <input type="file" accept="image/*,video/*" capture="environment" onChange={handleFileChange} className="hidden" />
                          </label>
                        )}
                      </div>
                    ) : (
                      <label className="flex items-center gap-3 border border-dashed border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-400 transition-all bg-gray-50 active:scale-[0.99]">
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9BA3AE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                        </div>
                        <span className="text-sm text-gray-400">Add a screenshot</span>
                        <input type="file" accept="image/*,video/*" capture="environment" onChange={handleFileChange} className="hidden" />
                      </label>
                    )}
                  </div>
                </>
              )}

              {/* HIGH-FRICTION: photo first, note secondary */}
              {needsPhoto && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wider block mb-2">
                      Photo proof ({images.length}/{MAX_PHOTOS}) — required
                    </label>
                    {images.length > 0 && (
                      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
                        {images.map((img, i) => (
                          <div key={i} className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-200">
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
                      <label className="flex flex-col items-center justify-center border border-dashed border-gray-200 rounded-2xl p-8 cursor-pointer hover:border-gray-400 transition-all bg-gray-50 active:scale-[0.99]">
                        <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9BA3AE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                        </div>
                        <span className="text-sm text-gray-400">
                          {images.length === 0 ? "Take photo or choose from library" : "Add another"}
                        </span>
                        <input type="file" accept="image/*,video/*" capture="environment" onChange={handleFileChange} className="hidden" />
                      </label>
                    )}
                  </div>

                  <input
                    type="text"
                    placeholder="Add a note (optional)"
                    value={proofNote}
                    onChange={(e) => setProofNote(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400"
                  />
                </>
              )}

              {/* Location warning */}
              {proofCoords && task.lat && task.lng && (() => {
                const dist = haversineKm(proofCoords.lat, proofCoords.lng, task.lat!, task.lng!);
                if (dist <= 2) return null;
                return (
                  <div className="bg-warning-50 border border-warning-200 rounded-xl p-3 flex items-start gap-2.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div>
                      <p className="text-xs font-medium text-warning-700">You&apos;re {formatDistance(dist)} from this task</p>
                      <p className="text-xs text-warning-600">Location is verified during review. Go to {task.location} before submitting.</p>
                    </div>
                  </div>
                );
              })()}
            </>
          );
        })()}

        {/* AI Pre-Check (auto-triggered) */}
        {!result && !submitting && (preChecking || preCheck) && (
          <div className="flex flex-col gap-2">
            {preChecking && (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-400">AI is checking your photo...</span>
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
                      ? "Looks good"
                      : preCheck.likely === "marginal"
                      ? "May need improvement"
                      : "Retake recommended"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{preCheck.assessment}</p>
              </div>
            )}
          </div>
        )}

        {/* Verification spinner */}
        {submitting && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Spinner />
            <div className="text-center">
              <Typography variant="body" level={2}>Verifying proof...</Typography>
              <Typography variant="body" level={4} className="text-gray-400 mt-1">
                {images.length > 0 ? `Analyzing your photo${images.length > 1 ? "s" : ""}` : "Reviewing your response"}
              </Typography>
            </div>
          </div>
        )}

        {/* Verdict result */}
        {result && (
          <div className={`p-5 rounded-2xl text-sm border ${
            result.verdict === "pass" ? "bg-green-50 border-green-200" :
            result.verdict === "flag" ? "bg-yellow-50 border-yellow-200" :
            result.verdict === "error" ? "bg-gray-50 border-gray-200" :
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
              ) : result.verdict === "error" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
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
                result.verdict === "error" ? "text-gray-600" :
                "text-red-600"
              }`}>
                {result.verdict === "pass" ? "VERIFIED" : result.verdict === "flag" ? "FLAGGED" : result.verdict === "error" ? "TRY AGAIN" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{String(result.reasoning)}</p>
            {result.locationVerified !== undefined && result.locationVerified !== null && (
              <div className="flex items-center gap-1.5 mt-2">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={result.locationVerified ? "#4ade80" : "#f59e0b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className={`text-xs font-medium ${result.locationVerified ? "text-green-600" : "text-yellow-600"}`}>
                  {result.locationVerified ? "Location verified" : "Location not confirmed"}
                  {result.distanceKm !== undefined && result.distanceKm !== null && (
                    <span className="text-gray-400 font-normal"> · {result.distanceKm < 1 ? `${Math.round(result.distanceKm * 1000)}m` : `${result.distanceKm.toFixed(1)}km`} from task</span>
                  )}
                </span>
              </div>
            )}
            {result.verdict === "pass" && (
              <div className="mt-3 pt-3 border-t border-green-200 flex flex-col gap-2">
                {task.rewardType === "points" ? (
                  <p className="font-semibold text-sm text-amber-600">+{Math.round(task.bountyUsdc)} pts earned</p>
                ) : result.escrowReleaseTxHash ? (
                  <a
                    href={`https://worldscan.org/tx/${result.escrowReleaseTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm font-semibold text-green-600 underline underline-offset-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    ${task.bountyUsdc} USDC sent! View transaction
                  </a>
                ) : task.escrowTxHash ? (
                  <p className="text-sm font-semibold text-warning-600 flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-warning-500 border-t-transparent rounded-full animate-spin" />
                    Payment processing...
                  </p>
                ) : (
                  <p className="font-semibold text-sm text-green-600">{rewardAmountLabel(task)}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      hapticTap();
                      shareTask({
                        taskDescription: task.description,
                        bountyUsdc: task.bountyUsdc,
                        verdict: "pass",
                        taskId: task.id,
                        rewardType: task.rewardType,
                        funded: task.onChainId !== null || !!task.escrowTxHash,
                      });
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100 transition-all text-xs text-green-600 active:scale-[0.98]"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                    Share
                  </button>
                  <button
                    onClick={() => { hapticTap(); onCreateTask ? onCreateTask() : onDone(); }}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-900 bg-gray-900 hover:bg-gray-800 transition-all text-xs text-white font-semibold active:scale-[0.98]"
                  >
                    + Post a favour
                  </button>
                </div>
                <button
                  onClick={() => { hapticTap(); onDone(); }}
                  className="w-full py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 font-semibold active:scale-[0.98] transition-all"
                >
                  Back to favours
                </button>
              </div>
            )}
            {result.verdict === "flag" && (
              <div className="mt-2">
                <p className="text-xs text-yellow-600">Under review. You'll be notified of the result.</p>
              </div>
            )}
            {result.verdict === "error" && (
              <button
                onClick={() => { setResult(null); hasAutoChecked.current = false; }}
                className="mt-3 w-full py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-gray-700 font-medium active:scale-[0.98] transition-all"
              >
                Try Again
              </button>
            )}
            {result.verdict === "fail" && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-red-600 font-medium">How to improve:</p>
                <ul className="text-xs text-gray-500 list-disc pl-4 space-y-0.5">
                  <li>Make sure you're at the exact location</li>
                  <li>Take a clearer photo showing the requested detail</li>
                  <li>Add a note explaining what you found</li>
                </ul>
                <button
                  onClick={() => { setResult(null); setPreCheck(null); hasAutoChecked.current = false; }}
                  className="mt-1 w-full py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700 font-medium active:scale-[0.98] transition-all"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!result && !submitting && (
        <div className="px-6 pb-8 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}>
          {(() => {
            const needsPhoto = tierRequiresPhoto(task.category);
            const hasContent = images.length > 0 || proofNote.trim().length > 0;
            const disabled = needsPhoto ? images.length === 0 : !hasContent;
            const label = needsPhoto
              ? (images.length > 0 ? "Submit for Verification" : "Add a photo to submit")
              : (proofNote.trim() ? "Submit Response" : "Write your response to submit");
            return (
              <Button onClick={handleSubmit} disabled={disabled} variant="primary" fullWidth size="lg">
                {label}
              </Button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function TaskTimeline({ task }: { task: Task }) {
  const steps = [
    { label: "Posted", done: true },
    { label: "Accepted", done: !!task.claimant },
    { label: "Proof", done: !!task.proofImageUrl },
    {
      label: task.verificationResult?.verdict === "pass" ? "Verified" :
             task.verificationResult?.verdict === "flag" ? "Flagged" :
             task.verificationResult ? "Rejected" : "Review",
      done: !!task.verificationResult,
    },
    { label: "Paid", done: task.status === "completed" },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const progress = (doneCount / steps.length) * 100;
  const isFlagged = steps[3].label === "Flagged";
  const isRejected = steps[3].label === "Rejected";
  const barColor = isRejected ? "bg-red-500" : isFlagged ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        {steps.map((step, i) => (
          <span key={i} className={`text-[10px] font-medium ${step.done ? (isRejected && i === 3 ? "text-red-600" : isFlagged && i === 3 ? "text-yellow-600" : "text-green-600") : "text-gray-300"}`}>
            {step.label}
          </span>
        ))}
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} />
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
    const res = await fetch(`/api/tasks/${task.id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.task) setCurrentTask(data.task);
    }
  }, [task.id]);

  useEffect(() => {
    fetchMessages();
    fetchTask();
    const interval = setInterval(() => { fetchMessages(); fetchTask(); }, 30_000); // 30s — was 5s
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
      <TopBar
        title="Favour Detail"
        startAdornment={
          <Button variant="tertiary" size="sm" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </Button>
        }
        endAdornment={<StatusBadge status={currentTask.status} />}
      />

      <div className="flex-1 px-6 py-6 flex flex-col gap-5 overflow-y-auto">
        {/* Task info */}
        <div className="min-w-0">
          <p className="font-semibold text-lg leading-snug break-words">{currentTask.description}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9BA3AE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-400 truncate max-w-[140px]">{currentTask.location}</span>
            <span className="text-xs text-gray-500 mx-0.5">·</span>
            <span className="text-xs font-semibold text-gray-900">{rewardLabel(currentTask)}</span>
            <span className="text-xs text-gray-500 mx-0.5">·</span>
            <span className="text-xs text-gray-400">{timeLeft(currentTask.deadline)}</span>
          </div>
        </div>

        {/* What to do */}
        {(currentTask.status === "open" || (currentTask.status === "claimed" && isClaimant)) && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">What to do</p>
            <div className="flex flex-col gap-2">
              {proofInstructions(currentTask).steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-gray-400">{i + 1}</span>
                  </span>
                  <span className="text-sm text-gray-600">{step}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">{proofInstructions(currentTask).tip}</p>
          </div>
        )}

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
                <p className="text-xs text-gray-400 font-mono truncate">{txSuccess}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-green-200">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-green-600 font-semibold">{rewardLabel(currentTask)}</span>
                <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">Powered by World Chain</span>
              </div>
              <a
                href={`https://worldscan.org/tx/${txSuccess}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-900 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
              >
                View on Explorer
              </a>
            </div>
          </div>
        )}

        {/* Escrow transaction link */}
        {currentTask.escrowTxHash && !txSuccess && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 font-medium">Escrow deposit</p>
              <p className="text-xs text-gray-400 font-mono truncate">{currentTask.escrowTxHash}</p>
            </div>
            <a
              href={`https://worldscan.org/tx/${currentTask.escrowTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-900 underline underline-offset-2 shrink-0 min-h-[44px] flex items-center"
            >
              View on Explorer
            </a>
          </div>
        )}

        {/* Fund with USDC — anyone can fund an unfunded agent task, poster can fund their own */}
        {currentTask.status === "open" && (isPoster || currentTask.agent) && !currentTask.escrowTxHash && isMiniKit() && RELAY_ESCROW_ADDRESS && (
          <button
            disabled={funding}
            onClick={async () => {
              setFunding(true);
              try {
                const countBefore = await readTaskCount().catch(() => 0);
                const txPayload = encodeCreateTask(currentTask.description, currentTask.bountyUsdc, 24);
                if (!txPayload) { setFunding(false); return; }
                const result = await MiniKit.sendTransaction(txPayload);
                const hash = extractTxHash(result);
                if (hash) {
                  const onChainId = countBefore;
                  await fetch(`/api/tasks/${currentTask.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ poster: userId, onChainId, escrowTxHash: hash }),
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
            className="w-full bg-gray-900 hover:bg-gray-900 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[44px]"
          >
            {funding ? "Funding..." : `Fund $${currentTask.bountyUsdc} USDC`}
          </button>
        )}

        {/* People */}
        <div className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-200">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              {currentTask.agent ? (
                <span className="text-sm">{currentTask.agent.icon}</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Posted by</p>
              <p className="text-sm font-medium truncate">
                {currentTask.agent ? currentTask.agent.name : shortId(currentTask.poster)}
              </p>
            </div>
          </div>
          {currentTask.claimant && (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">Doing it</p>
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium truncate">{shortId(currentTask.claimant)}</p>
                    <VerificationBadge level={currentTask.claimantVerification} size="sm" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Proof image */}
        {currentTask.proofImageUrl && (
          <div>
            <button
              onClick={() => setShowProofImage(!showProofImage)}
              className="flex items-center gap-2 text-xs text-gray-400 font-medium min-h-[44px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {showProofImage ? "Hide proof photo" : "View proof photo"}
            </button>
            {showProofImage && (
              <div className="mt-2 rounded-2xl overflow-hidden border border-gray-200">
                <img src={currentTask.proofImageUrl} alt="Proof" className="w-full max-h-80 object-cover" loading="lazy" />
                {currentTask.proofNote && (
                  <div className="bg-white px-4 py-2 border-t border-gray-200">
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
                <span className={`text-xs px-2 py-0.5 rounded-full border ml-1 ${
                  currentTask.claimantVerification === "orb" ? "text-gray-900 border-cyan-200 bg-cyan-50" :
                  currentTask.claimantVerification === "device" ? "text-gray-900 border-gray-200 bg-gray-100" :
                  "text-green-600 border-green-200 bg-green-50"
                }`}>
                  {currentTask.claimantVerification === "orb" ? "Orb-verified human" : currentTask.claimantVerification === "device" ? "Device-verified" : "Wallet-level"}
                </span>
              )}
              {currentTask.verificationResult.confidence !== undefined && (
                <span className="text-xs text-gray-400 ml-auto">{Math.round(currentTask.verificationResult.confidence * 100)}% confidence</span>
              )}
            </div>
            <p className="text-xs text-gray-400 leading-relaxed break-words">{String(currentTask.verificationResult.reasoning)}</p>
            {currentTask.verificationResult.verdict === "pass" && (
              <div className="mt-2 pt-2 border-t border-green-200">
                <p className="text-xs text-green-600 font-semibold">
                  {isRealMoney(currentTask) ? `$${currentTask.bountyUsdc} USDC released` : rewardAmountLabel(currentTask)}
                </p>
              </div>
            )}
            {currentTask.attestationTxHash && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <a
                  href={`https://worldscan.org/tx/${currentTask.attestationTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-gray-900 underline underline-offset-2 min-h-[44px]"
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

        {/* Payment auto-releases via server - no manual release needed */}

        {/* Uniswap swap — claimant can convert received USDC */}
        {currentTask.status === "completed" && isClaimant && isMiniKit() && (
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <span className="text-xs font-semibold text-gray-900">Swap Earnings</span>
              <span className="text-xs text-gray-500 ml-auto">via Uniswap V3</span>
            </div>
            <div className="flex gap-2 mb-3">
              {(["USDC", "WETH", "WLD"] as SwapToken[]).map((token) => (
                <button
                  key={token}
                  onClick={() => setSwapToken(token)}
                  className={`flex-1 min-h-[44px] py-2 rounded-xl text-xs font-medium transition-all ${
                    swapToken === token
                      ? "bg-black text-white"
                      : "bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100"
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
                      const swapHash = extractTxHash(swapResult);
                      if (swapHash) setTxSuccess(swapHash);
                      else alert("Swap transaction failed. Please try again.");
                    } catch (err) {
                      alert(err instanceof Error ? err.message : "Swap transaction rejected by wallet.");
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
              <p className="text-xs text-gray-400 text-center py-1">Select a token to swap your USDC earnings</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        {currentTask.status === "open" && userId && !isPoster && (
          <button
            onClick={onSubmitProof}
            className="w-full bg-gray-900 hover:bg-gray-900 text-white font-semibold rounded-xl px-4 py-3 min-h-[44px] transition-colors active:scale-[0.98]"
          >
            {currentTask.escrowTxHash ? `Do it — earn $${currentTask.bountyUsdc} USDC` : "Do it"}
          </button>
        )}
        {currentTask.status === "claimed" && isClaimant && !isFlagged && !hasFollowUp && (
          <button
            onClick={onSubmitProof}
            className="w-full bg-gray-900 hover:bg-gray-900 text-white font-medium rounded-xl px-4 py-3 min-h-[44px] transition-colors active:scale-[0.98]"
          >
            Submit Proof
          </button>
        )}

        {/* AI Follow-up: claimant can respond and request re-evaluation */}
        {hasFollowUp && isClaimant && (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-sm font-semibold text-gray-500">More info needed</span>
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
              className="w-full min-h-[44px] bg-gray-900 hover:bg-gray-900 text-white py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
              className="w-full min-h-[44px] bg-gray-900 hover:bg-gray-900 text-white py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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

        {/* Cancel task - poster can cancel open/claimed tasks */}
        {isPoster && (currentTask.status === "open" || currentTask.status === "claimed") && (
          <button
            onClick={async () => {
              if (!confirm("Cancel this favour? If funded, your USDC will be refunded.")) return;
              const res = await fetch(`/api/tasks/${currentTask.id}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ poster: userId }),
              });
              if (res.ok) {
                const data = await res.json();
                if (data.task) setCurrentTask(data.task);
              }
            }}
            className="w-full min-h-[44px] border border-red-200 text-red-600 px-4 py-3 rounded-2xl text-sm font-medium active:scale-[0.98] transition-all hover:bg-red-50"
          >
            Cancel favour
          </button>
        )}

      </div>

      {/* Chat input - only show when there are messages */}
      {isParticipant && messages.length > 0 && currentTask.status !== "completed" && currentTask.status !== "failed" && (
        <div className="sticky bottom-14 bg-white border-t border-gray-200 px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={hasFollowUp && isClaimant ? "Reply to AI's question..." : "Message..."}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              className={`flex-1 min-w-0 bg-gray-50 border rounded-xl px-4 py-2.5 text-sm min-h-[44px] focus:outline-none transition-colors placeholder:text-gray-400 ${
                hasFollowUp && isClaimant ? "border-gray-200 focus:border-gray-400" : "border-gray-200 focus:border-gray-400"
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
