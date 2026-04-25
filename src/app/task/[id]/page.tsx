"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Task, VerificationResult, AiFollowUp } from "@/lib/types";
import { VerificationBadge, RequiredTierBadge } from "@/components/VerificationBadge";
import { Button as WorldButton, Chip as WorldChip } from "@worldcoin/mini-apps-ui-kit-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Message = {
  id: string;
  taskId: string;
  sender: string;
  text: string;
  timestamp: string;
};

const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0";
const WORLDSCAN_TX = "https://worldscan.org/tx";
const WORLDSCAN_ADDR = "https://worldscan.org/address";

function truncate(addr: string): string {
  if (addr.startsWith("0x") && addr.length > 10)
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  if (addr.startsWith("agent_")) return addr.replace("agent_", "");
  return addr.length > 16 ? `${addr.slice(0, 12)}...` : addr;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CATEGORY_ICONS: Record<string, string> = {
  photo: "\u{1F4F8}",
  delivery: "\u{1F4E6}",
  "check-in": "\u{1F4CD}",
  custom: "\u{2699}️",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Open" },
  claimed: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Claimed" },
  completed: { bg: "bg-green-500/15", text: "text-green-400", label: "Completed" },
  failed: { bg: "bg-red-500/15", text: "text-red-400", label: "Failed" },
  expired: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Expired" },
};

function verdictColor(v: string): string {
  if (v === "pass") return "text-green-400";
  if (v === "flag") return "text-amber-400";
  return "text-red-400";
}

function verdictBg(v: string): string {
  if (v === "pass") return "bg-green-500";
  if (v === "flag") return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const STATUS_CHIP_VARIANT: Record<string, "default" | "success" | "warning" | "error"> = {
  open: "default",
  claimed: "warning",
  completed: "success",
  failed: "error",
  expired: "error",
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.open;
  const chipVariant = STATUS_CHIP_VARIANT[status] || "default";
  return (
    <WorldChip variant={chipVariant} label={s.label} />
  );
}

function TimelineStep({
  done,
  label,
  detail,
  time,
  isLast,
}: {
  done: boolean;
  label: string;
  detail?: string;
  time?: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      {/* Dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3 h-3 rounded-full border-2 shrink-0 ${
            done
              ? "bg-green-400 border-green-400"
              : "bg-transparent border-gray-600"
          }`}
        />
        {!isLast && (
          <div className={`w-px flex-1 min-h-[24px] ${done ? "bg-green-400/30" : "bg-gray-700"}`} />
        )}
      </div>
      {/* Content */}
      <div className="pb-4 -mt-0.5">
        <p className={`text-xs font-medium ${done ? "text-white" : "text-gray-500"}`}>
          {label}
        </p>
        {detail && (
          <p className="text-[10px] text-gray-400 mt-0.5">{detail}</p>
        )}
        {time && (
          <p className="text-[10px] text-gray-600 mt-0.5">{time}</p>
        )}
      </div>
    </div>
  );
}

function ProofImage({ url }: { url: string }) {
  const [enlarged, setEnlarged] = useState(false);

  return (
    <>
      <button onClick={() => setEnlarged(true)} className="w-full">
        <img
          src={url}
          alt="Proof"
          className="w-full rounded-xl border border-white/[0.06] object-cover max-h-64"
        />
      </button>
      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setEnlarged(false)}
        >
          <img
            src={url}
            alt="Proof enlarged"
            className="max-w-full max-h-full rounded-xl"
          />
        </div>
      )}
    </>
  );
}

function AiVerdictCard({ result }: { result: VerificationResult }) {
  const pct = Math.round(result.confidence * 100);
  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">
        AI Verification
      </p>
      <div className="flex items-center gap-3 mb-3">
        <span className={`text-lg font-bold uppercase ${verdictColor(result.verdict)}`}>
          {result.verdict}
        </span>
        <StatusBadge status={result.verdict === "pass" ? "completed" : result.verdict === "flag" ? "claimed" : "failed"} />
      </div>
      <p className="text-xs text-gray-300 italic leading-relaxed mb-3">
        &ldquo;{result.reasoning}&rdquo;
      </p>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Confidence</span>
          <span className={`text-[10px] font-semibold ${verdictColor(result.verdict)}`}>
            {pct}%
          </span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${verdictBg(result.verdict)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function FollowUpCard({ followUp }: { followUp: AiFollowUp }) {
  return (
    <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-amber-400 text-sm">&#9888;&#65039;</span>
        <span className="text-[10px] text-amber-400 uppercase tracking-wider font-medium">
          AI Follow-up &middot; {followUp.status}
        </span>
      </div>
      <p className="text-xs text-gray-300 leading-relaxed">{followUp.question}</p>
      <p className="text-[10px] text-gray-600 mt-2">
        Initial confidence: {Math.round(followUp.initialConfidence * 100)}%
      </p>
    </div>
  );
}

function ChatBubble({
  msg,
  agent,
}: {
  msg: Message;
  agent: { name: string; icon: string; color: string } | null;
}) {
  const isSystem =
    msg.sender === "relay-bot" || msg.sender.startsWith("agent_");
  const senderLabel = isSystem
    ? agent
      ? agent.name
      : msg.sender === "relay-bot"
      ? "Relay"
      : msg.sender.replace("agent_", "").replace(/^\w/, (c) => c.toUpperCase())
    : truncate(msg.sender);
  const agentIcon = isSystem ? (agent ? agent.icon : "\u{1F916}") : null;
  const agentColor = isSystem ? (agent ? agent.color : "#6b7280") : null;

  return (
    <div className={`flex ${isSystem ? "justify-start" : "justify-end"}`}>
      {isSystem && (
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 mr-2 mt-0.5"
          style={{ backgroundColor: `${agentColor}20` }}
        >
          {agentIcon}
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
          isSystem
            ? "bg-white/[0.04] border border-white/[0.08] rounded-tl-sm"
            : "bg-indigo-600/20 border border-indigo-500/20 rounded-tr-sm"
        }`}
      >
        <p
          className="text-[10px] font-semibold mb-0.5"
          style={isSystem && agentColor ? { color: agentColor } : undefined}
        >
          <span className={isSystem ? "" : "text-indigo-400"}>{senderLabel}</span>
        </p>
        <p className="text-[13px] text-gray-200 leading-relaxed whitespace-pre-wrap">
          {msg.text}
        </p>
        <p className="text-[9px] text-gray-600 mt-1.5 font-mono text-right">
          {timeAgo(msg.timestamp)}
        </p>
      </div>
    </div>
  );
}

function WorldChatThread({
  messages,
  agent,
  userId,
  onSend,
}: {
  messages: Message[];
  agent: { name: string; icon: string; color: string } | null;
  userId: string | null;
  onSend: (text: string) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const prevCountRef = useRef(messages.length);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (messages.length !== prevCountRef.current) {
      prevCountRef.current = messages.length;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    }
  }, [messages.length]);

  // Also scroll on initial mount
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      await onSend(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#818cf8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-semibold text-white">World Chat Thread</span>
          {messages.length > 0 && (
            <span className="text-[10px] text-gray-500 font-mono">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
        )}
      </div>

      {/* Message area */}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-4">
          <div className="w-10 h-10 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4b5563"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            No World Chat messages yet.
            <br />
            Messages appear when this task is claimed.
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex flex-col gap-3 px-4 py-4 max-h-[420px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10"
        >
          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} agent={agent} />
          ))}
        </div>
      )}

      {/* Input bar */}
      {userId && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500/40 transition-colors min-h-[40px]"
              disabled={sending}
            />
            <WorldButton
              type="submit"
              variant="primary"
              size="sm"
              disabled={!draft.trim() || sending}
              className="shrink-0 !w-9 !h-9 !min-h-0 !p-0 !rounded-xl"
            >
              {sending ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-white"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </WorldButton>
          </form>
        </div>
      )}
    </div>
  );
}

function OnChainLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-3 py-2.5 hover:border-white/10 transition-colors group"
    >
      <span className="text-xs text-gray-300 group-hover:text-white transition-colors">{label}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-500 group-hover:text-white transition-colors"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, msgsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch(`/api/tasks/${id}/messages`),
      ]);

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        const found = (data.tasks as Task[])?.find((t) => t.id === id);
        if (found) setTask(found);
        else if (!task) setError("Task not found");
      }

      if (msgsRes.ok) {
        const data = await msgsRes.json();
        setMessages(data.messages || []);
      }
    } catch {
      if (!task) setError("Failed to load task");
    } finally {
      setLoading(false);
    }
  }, [id, task]);

  // Send a chat message
  const sendMessage = useCallback(
    async (text: string) => {
      if (!task) return;
      const sender = task.claimant || task.poster;
      const res = await fetch(`/api/tasks/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    },
    [id, task],
  );

  // Initial fetch + polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---- Loading / Error states ----

  if (loading && !task) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
          <p className="text-xs text-gray-500">Loading task...</p>
        </div>
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
          Back to home
        </Link>
      </div>
    );
  }

  if (!task) return null;

  // ---- Derived data ----

  const categoryIcon = CATEGORY_ICONS[task.category] || "\u{2699}️";
  const statusStyle = STATUS_STYLES[task.status] || STATUS_STYLES.open;
  const isTerminal = ["completed", "failed", "expired"].includes(task.status);

  // Timeline steps
  const steps: { done: boolean; label: string; detail?: string; time?: string }[] = [
    {
      done: true,
      label: "Created",
      detail: `Posted by ${truncate(task.poster)}`,
      time: formatDate(task.createdAt),
    },
  ];

  if (task.claimant) {
    steps.push({
      done: true,
      label: "Claimed",
      detail: `By ${truncate(task.claimant)}`,
    });
  } else if (!isTerminal) {
    steps.push({ done: false, label: "Claimed", detail: "Waiting for claimant" });
  }

  if (task.proofImageUrl) {
    steps.push({ done: true, label: "Proof Submitted" });
  } else if (task.claimant && !isTerminal) {
    steps.push({ done: false, label: "Proof Submitted", detail: "Awaiting proof" });
  }

  if (task.verificationResult) {
    steps.push({
      done: true,
      label: "AI Verified",
      detail: `${task.verificationResult.verdict.toUpperCase()} (${Math.round(task.verificationResult.confidence * 100)}%)`,
    });
  } else if (task.proofImageUrl && !isTerminal) {
    steps.push({ done: false, label: "AI Verified", detail: "Processing..." });
  }

  if (task.aiFollowUp) {
    steps.push({
      done: task.aiFollowUp.status === "resolved",
      label: "Follow-up",
      detail: task.aiFollowUp.status === "resolved" ? "Resolved" : "Pending response",
    });
  }

  if (isTerminal) {
    steps.push({
      done: true,
      label: statusStyle.label,
      detail:
        task.status === "completed"
          ? "Bounty released"
          : task.status === "failed"
          ? "Verification failed"
          : "Deadline passed",
    });
  }

  // ---- Render ----

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/">
            <WorldButton variant="tertiary" size="sm" className="!text-gray-400 hover:!text-white">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </WorldButton>
          </Link>
          <h1 className="text-sm font-bold tracking-tight flex items-center gap-1.5">
            <span>{categoryIcon}</span> Task Detail
          </h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="px-3 sm:px-4 py-4 flex flex-col gap-4">
        {/* Restricted badge */}
        {task.claimCode !== null && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="text-sm">{"\u{1F512}"}</span>
            <span className="text-[10px] text-purple-300 font-medium uppercase tracking-wider">
              Restricted Bounty
            </span>
          </div>
        )}

        {/* Task Info Card */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <div className="flex items-start justify-between mb-3">
            <StatusBadge status={task.status} />
            <span className="text-xs text-gray-600 font-mono">{task.id.slice(0, 8)}</span>
          </div>

          <p className="text-sm text-gray-100 leading-relaxed mb-3 break-words">{task.description}</p>

          <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 sm:gap-x-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Location</p>
              <p className="text-xs text-gray-300 mt-0.5">{task.location}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Bounty</p>
              <p className="text-xs text-green-400 font-semibold mt-0.5">
                ${task.bountyUsdc} USDC
              </p>
              <RequiredTierBadge bountyUsdc={task.bountyUsdc} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Category</p>
              <p className="text-xs text-gray-300 mt-0.5 capitalize">
                {categoryIcon} {task.category}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Deadline</p>
              <p className="text-xs text-gray-300 mt-0.5">{formatDate(task.deadline)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Poster</p>
              <p className="text-xs text-gray-300 mt-0.5 font-mono">{truncate(task.poster)}</p>
            </div>
            {task.claimant && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Claimant</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-gray-300 font-mono">
                    {truncate(task.claimant)}
                  </p>
                  <VerificationBadge level={task.claimantVerification} size="sm" />
                </div>
              </div>
            )}
          </div>

          {/* Agent badge */}
          {task.agent && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center text-xs"
                style={{ backgroundColor: `${task.agent.color}15` }}
              >
                {task.agent.icon}
              </div>
              <span className="text-[10px] font-medium" style={{ color: task.agent.color }}>
                {task.agent.name}
              </span>
              <span className="text-[10px] text-gray-600">agent</span>
            </div>
          )}
        </div>

        {/* Lifecycle Timeline */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">
            Lifecycle
          </p>
          {steps.map((step, i) => (
            <TimelineStep
              key={`${step.label}-${i}`}
              done={step.done}
              label={step.label}
              detail={step.detail}
              time={step.time}
              isLast={i === steps.length - 1}
            />
          ))}
        </div>

        {/* World Chat Thread */}
        <WorldChatThread
          messages={messages}
          agent={task.agent}
          userId={task.claimant || task.poster}
          onSend={sendMessage}
        />

        {/* Proof Images */}
        {(task.proofImages || task.proofImageUrl) && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-3 sm:p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">
              Proof {(task.proofImages && task.proofImages.length > 1) ? "Images" : "Image"}
            </p>
            {task.proofImages && task.proofImages.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {task.proofImages.map((url, i) => (
                  <div key={i} className="shrink-0 w-48">
                    <ProofImage url={url} />
                  </div>
                ))}
              </div>
            ) : (
              <ProofImage url={task.proofImages?.[0] || task.proofImageUrl!} />
            )}
            {task.proofNote && (
              <p className="text-[10px] text-gray-400 mt-2 italic">
                &ldquo;{task.proofNote}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* AI Verdict */}
        {task.verificationResult && <AiVerdictCard result={task.verificationResult} />}

        {/* AI Follow-up */}
        {task.aiFollowUp && <FollowUpCard followUp={task.aiFollowUp} />}

        {/* On-Chain Section */}
        {(task.escrowTxHash || task.attestationTxHash || task.onChainId !== null) && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">
              On-Chain
            </p>
            <div className="flex flex-col gap-2">
              {task.escrowTxHash && (
                <OnChainLink
                  label="Escrow Deposit"
                  href={`${WORLDSCAN_TX}/${task.escrowTxHash}`}
                />
              )}
              {task.attestationTxHash && (
                <OnChainLink
                  label="AI Attestation"
                  href={`${WORLDSCAN_TX}/${task.attestationTxHash}`}
                />
              )}
              {task.onChainId !== null && (
                <OnChainLink
                  label={`On-chain Task ID: ${task.onChainId}`}
                  href={`${WORLDSCAN_ADDR}/${ESCROW_ADDRESS}`}
                />
              )}
            </div>
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
