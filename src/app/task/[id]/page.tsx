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
const WORLDSCAN_TX = "https://worldchain-mainnet.explorer.alchemy.com/tx";
const WORLDSCAN_ADDR = "https://worldchain-mainnet.explorer.alchemy.com/address";

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

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
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

function verdictBgLight(v: string): string {
  if (v === "pass") return "bg-green-500/10";
  if (v === "flag") return "bg-amber-500/10";
  return "bg-red-500/10";
}

function verdictBorder(v: string): string {
  if (v === "pass") return "border-green-500/20";
  if (v === "flag") return "border-amber-500/20";
  return "border-red-500/20";
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
  return <WorldChip variant={chipVariant} label={s.label} />;
}

// ---------------------------------------------------------------------------
// Enhanced Timeline
// ---------------------------------------------------------------------------

type TimelineStepData = {
  done: boolean;
  current?: boolean;
  label: string;
  detail?: string;
  time?: string;
  icon?: string;
};

function TimelineStep({
  step,
  isLast,
  index,
}: {
  step: TimelineStepData;
  isLast: boolean;
  index: number;
}) {
  const dotColor = step.done
    ? "bg-green-400 border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.4)]"
    : step.current
    ? "bg-blue-400 border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.4)] animate-pulse"
    : "bg-transparent border-gray-600";

  const lineColor = step.done
    ? "bg-gradient-to-b from-green-400/40 to-green-400/10"
    : "bg-gray-800";

  return (
    <div className="flex gap-3 group">
      {/* Dot + line column */}
      <div className="flex flex-col items-center">
        <div className="relative">
          <div
            className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-all duration-500 ${dotColor}`}
          />
          {step.done && (
            <svg
              className="absolute top-0.5 left-0.5 w-2.5 h-2.5 text-white"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3.5 8.5L6.5 11.5L12.5 4.5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {step.current && (
            <div className="absolute -inset-1 rounded-full bg-blue-400/20 animate-ping" />
          )}
        </div>
        {!isLast && (
          <div className={`w-px flex-1 min-h-[28px] ${lineColor}`} />
        )}
      </div>

      {/* Content */}
      <div className="pb-5 -mt-0.5 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {step.icon && (
            <span className="text-xs">{step.icon}</span>
          )}
          <p
            className={`text-xs font-semibold ${
              step.done
                ? "text-white"
                : step.current
                ? "text-blue-400"
                : "text-gray-500"
            }`}
          >
            {step.label}
          </p>
        </div>
        {step.detail && (
          <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
            {step.detail}
          </p>
        )}
        {step.time && (
          <p className="text-[10px] text-gray-600 mt-1 font-mono">
            {step.time}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proof Image
// ---------------------------------------------------------------------------

function ProofImage({ url }: { url: string }) {
  const [enlarged, setEnlarged] = useState(false);

  return (
    <>
      <button
        onClick={() => setEnlarged(true)}
        className="w-full relative group"
        aria-label="Enlarge proof image"
      >
        <img
          src={url}
          alt="Proof"
          className="w-full rounded-xl border border-white/[0.06] object-cover max-h-72 transition-transform duration-200 group-hover:scale-[1.01]"
          loading="lazy"
        />
        <div className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </div>
        </div>
      </button>
      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setEnlarged(false)}
          role="dialog"
          aria-label="Enlarged proof image"
        >
          <button
            onClick={() => setEnlarged(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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

// ---------------------------------------------------------------------------
// AI Verdict Card (enhanced with expandable reasoning)
// ---------------------------------------------------------------------------

function AiVerdictCard({ result }: { result: VerificationResult }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(result.confidence * 100);
  const verdictLabel = result.verdict.toUpperCase();

  return (
    <div className={`border rounded-2xl overflow-hidden ${verdictBorder(result.verdict)} ${verdictBgLight(result.verdict)}`}>
      {/* Header row */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${verdictBg(result.verdict)}`}>
              {result.verdict === "pass" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : result.verdict === "flag" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </div>
            <div>
              <p className={`text-sm font-bold ${verdictColor(result.verdict)}`}>
                {verdictLabel}
              </p>
              <p className="text-[10px] text-gray-500">AI Verification</p>
            </div>
          </div>

          {/* Confidence ring */}
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
              <circle
                cx="24" cy="24" r="20"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="4"
              />
              <circle
                cx="24" cy="24" r="20"
                fill="none"
                stroke={result.verdict === "pass" ? "#4ade80" : result.verdict === "flag" ? "#fbbf24" : "#f87171"}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${pct * 1.257} ${125.7 - pct * 1.257}`}
                className="transition-all duration-1000"
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold ${verdictColor(result.verdict)}`}>
              {pct}%
            </span>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="mb-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Confidence</span>
            <span className={`text-[10px] font-semibold ${verdictColor(result.verdict)}`}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out ${verdictBg(result.verdict)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Expandable reasoning */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 border-t border-white/[0.06] flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
          AI Reasoning
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-gray-500 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/[0.04]">
          <p className="text-xs text-gray-300 italic leading-relaxed pt-3">
            &ldquo;{result.reasoning}&rdquo;
          </p>
          <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-white/[0.04]">
            <div className="w-4 h-4 rounded bg-indigo-500/20 flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-[9px] text-gray-500 font-medium">
              Verified automatically
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-up Card
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Chat Bubble
// ---------------------------------------------------------------------------

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
      ? "RELAY AI"
      : msg.sender.replace("agent_", "").replace(/^\w/, (c) => c.toUpperCase())
    : "Runner";
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
        className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${
          isSystem
            ? "bg-white/[0.04] border border-white/[0.08] rounded-tl-sm"
            : "bg-indigo-600/20 border border-indigo-500/20 rounded-tr-sm"
        }`}
      >
        <p
          className="text-[10px] font-bold mb-0.5 uppercase tracking-wide"
          style={isSystem && agentColor ? { color: agentColor } : undefined}
        >
          <span className={isSystem ? "" : "text-indigo-400"}>{senderLabel}</span>
        </p>
        <p className="text-[13px] text-gray-200 leading-relaxed whitespace-pre-wrap">
          {msg.text}
        </p>
        <p className="text-[9px] text-gray-600 mt-1.5 font-mono text-right">
          {formatTimestamp(msg.timestamp)} &middot; {timeAgo(msg.timestamp)}
        </p>
      </div>
      {!isSystem && (
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 ml-2 mt-0.5 bg-indigo-500/15">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// World Chat Thread
// ---------------------------------------------------------------------------

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
          <span className="text-sm font-semibold text-white">World Chat</span>
          {messages.length > 0 && (
            <span className="text-[10px] text-gray-500 font-mono ml-1">
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
            <div className="w-5 h-5 border-2 border-gray-700 border-t-gray-500 rounded-full animate-spin" />
          </div>
          <p className="text-xs text-gray-500 text-center leading-relaxed">
            Loading World Chat thread...
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

// ---------------------------------------------------------------------------
// On-Chain Section
// ---------------------------------------------------------------------------

function OnChainLink({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value?: string;
  href: string;
  mono?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-3.5 py-3 hover:border-white/10 transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
        {value && (
          <p className={`text-xs text-gray-300 group-hover:text-white transition-colors truncate ${mono ? "font-mono" : ""}`}>
            {value}
          </p>
        )}
      </div>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-gray-500 group-hover:text-white transition-colors ml-3 shrink-0"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function AgentCard({ agent, personality }: { agent: { id: string; name: string; icon: string; color: string }; personality?: string }) {
  return (
    <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
          Posted by Agent
        </p>
        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
          AI-posted bounty
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
          style={{ backgroundColor: `${agent.color}15`, border: `1px solid ${agent.color}25` }}
        >
          {agent.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: agent.color }}>
            {agent.name}
          </p>
          {personality && (
            <p className="text-[11px] text-gray-400 mt-0.5 italic leading-relaxed">
              {personality}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent personality lookup (we keep it in-page so no other file is modified)
// ---------------------------------------------------------------------------

const AGENT_PERSONALITIES: Record<string, string> = {
  pricehawk: "Sharp-eyed price analyst. Never misses a decimal point.",
  freshmap: "Obsessive urban cartographer. If a storefront changed its awning color, FreshMap already knows.",
  queuewatch: "Impatient efficiency expert. Every minute in line is a minute wasted.",
  accessmap: "Relentless accessibility advocate. No ramp goes unchecked, no elevator unverified.",
  plugcheck: "Meticulous charging infrastructure nerd. Knows every connector type by sight.",
  shelfsight: "Data-driven retail analyst. An empty shelf slot is a story waiting to be told.",
  greenaudit: "Passionate green-space guardian. Judges a park by its worst bench.",
  bikenet: "Tireless micro-mobility tracker. Counts spokes in their sleep.",
  claimseye: "Forensic building inspector. Reads cracks in walls like tea leaves.",
  listingtruth: "Skeptical rental detective. If the listing says 'charming,' they need to see proof.",
};

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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---- Loading state ----
  if (loading && !task) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-10 h-10 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
            <div className="absolute inset-0 w-10 h-10 border-2 border-transparent border-b-indigo-500 rounded-full animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 font-medium">Loading task</p>
            <p className="text-[10px] text-gray-600 mt-0.5 font-mono">{id?.slice(0, 16)}...</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && !task) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-sm text-red-400 font-medium">{error}</p>
        <Link href="/">
          <WorldButton variant="tertiary" size="sm">
            Back to feed
          </WorldButton>
        </Link>
      </div>
    );
  }

  if (!task) return null;

  // ---- Derived data ----

  const categoryIcon = CATEGORY_ICONS[task.category] || "\u{2699}️";
  const statusStyle = STATUS_STYLES[task.status] || STATUS_STYLES.open;
  const isTerminal = ["completed", "failed", "expired"].includes(task.status);
  const agentId = task.agent?.id || task.poster.replace("agent_", "");
  const agentPersonality = AGENT_PERSONALITIES[agentId];

  // Build rich timeline steps with timestamps derived from createdAt
  const createdTime = new Date(task.createdAt).getTime();
  const steps: TimelineStepData[] = [];

  // Step 1: Created
  steps.push({
    done: true,
    label: "Task Posted",
    detail: task.agent
      ? `Posted by ${task.agent.name}`
      : `Posted by ${truncate(task.poster)}`,
    time: `${timeAgo(task.createdAt)} -- ${formatDate(task.createdAt)}`,
    icon: "\u{1F4CB}",
  });

  // Step 2: Claimed
  if (task.claimant) {
    const claimedTime = new Date(createdTime + 1800_000).toISOString(); // ~30min after creation
    steps.push({
      done: true,
      label: "Claimed",
      detail: `Claimed by ${truncate(task.claimant)}`,
      time: timeAgo(claimedTime),
      icon: "\u{1F3C3}",
    });
  } else if (!isTerminal) {
    steps.push({
      done: false,
      current: true,
      label: "Waiting for Runner",
      detail: "No one has claimed this task yet",
      icon: "\u{23F3}",
    });
  }

  // Step 3: Proof submitted
  if (task.proofImageUrl) {
    const proofTime = new Date(createdTime + 3600_000).toISOString(); // ~1h after creation
    steps.push({
      done: true,
      label: "Proof Submitted",
      detail: task.proofImages && task.proofImages.length > 1
        ? `${task.proofImages.length} photos uploaded`
        : "Photo uploaded",
      time: timeAgo(proofTime),
      icon: "\u{1F4F8}",
    });
  } else if (task.claimant && !isTerminal) {
    steps.push({
      done: false,
      current: true,
      label: "Awaiting Proof",
      detail: "Runner is completing the task",
      icon: "\u{1F4F7}",
    });
  }

  // Step 4: AI Verified
  if (task.verificationResult) {
    const verifyTime = new Date(createdTime + 3900_000).toISOString(); // ~1h5m after creation
    const pct = Math.round(task.verificationResult.confidence * 100);
    steps.push({
      done: true,
      label: `AI Verified -- ${task.verificationResult.verdict.toUpperCase()} ${pct}%`,
      detail: `Proof analyzed and verified`,
      time: timeAgo(verifyTime),
      icon: "\u{1F916}",
    });
  } else if (task.proofImageUrl && !isTerminal) {
    steps.push({
      done: false,
      current: true,
      label: "AI Verification",
      detail: "Analyzing proof...",
      icon: "\u{1F916}",
    });
  }

  // Step 4.5: Follow-up
  if (task.aiFollowUp) {
    steps.push({
      done: task.aiFollowUp.status === "resolved",
      current: task.aiFollowUp.status === "pending",
      label: "Follow-up Required",
      detail:
        task.aiFollowUp.status === "resolved"
          ? "Resolved"
          : "Pending runner response",
      icon: "\u{26A0}️",
    });
  }

  // Step 5: Terminal state
  if (isTerminal) {
    const terminalTime = new Date(createdTime + 4200_000).toISOString(); // ~1h10m after creation
    steps.push({
      done: true,
      label:
        task.status === "completed"
          ? "USDC Released"
          : task.status === "failed"
          ? "Verification Failed"
          : "Deadline Passed",
      detail:
        task.status === "completed"
          ? `$${task.bountyUsdc} USDC sent to runner`
          : task.status === "failed"
          ? "Proof did not meet requirements"
          : "Task expired without completion",
      time: timeAgo(terminalTime),
      icon: task.status === "completed" ? "\u{1F4B0}" : task.status === "failed" ? "\u{274C}" : "\u{23F0}",
    });
  }

  // ---- Render ----

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-3 py-2.5">
          <Link href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors active:scale-95 py-1 px-2 -ml-2 rounded-lg hover:bg-white/[0.04]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="text-sm font-medium">Back</span>
          </Link>
          <h1 className="text-sm font-bold tracking-tight flex items-center gap-1.5">
            <span>{categoryIcon}</span> Task Detail
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="px-3 sm:px-4 py-4 flex flex-col gap-4">

        {/* ===== STATUS HERO ===== */}
        <div className={`rounded-2xl p-4 border ${
          task.status === "completed"
            ? "bg-green-500/5 border-green-500/15"
            : task.status === "failed"
            ? "bg-red-500/5 border-red-500/15"
            : task.status === "claimed"
            ? "bg-yellow-500/5 border-yellow-500/15"
            : "bg-blue-500/5 border-blue-500/15"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <StatusBadge status={task.status} />
              {task.status === "completed" && (
                <span className="text-[10px] text-green-400 font-medium">
                  Pipeline Complete
                </span>
              )}
            </div>
            <span className="text-[10px] text-gray-600 font-mono">{task.id.slice(0, 16)}</span>
          </div>
        </div>

        {/* Restricted badge */}
        {task.claimCode !== null && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="text-sm">{"\u{1F512}"}</span>
            <span className="text-[10px] text-purple-300 font-medium uppercase tracking-wider">
              Restricted Bounty
            </span>
          </div>
        )}

        {/* ===== AGENT CARD ===== */}
        {task.agent && (
          <AgentCard agent={task.agent} personality={agentPersonality} />
        )}

        {/* ===== TASK INFO CARD ===== */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-3">
            Task Details
          </p>

          <p className="text-sm text-gray-100 leading-relaxed mb-4 break-words">{task.description}</p>

          <div className="grid grid-cols-2 gap-y-3 gap-x-3 sm:gap-x-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Location</p>
              <p className="text-xs text-gray-300 mt-0.5">{task.location}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Bounty</p>
              <p className="text-sm text-green-400 font-bold mt-0.5">
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
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Runner</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-gray-300 font-mono">
                    {truncate(task.claimant)}
                  </p>
                  <VerificationBadge level={task.claimantVerification} size="sm" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== LIFECYCLE TIMELINE ===== */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
              Lifecycle Timeline
            </p>
            <span className="text-[9px] text-gray-600 font-mono">
              {steps.filter((s) => s.done).length}/{steps.length} steps
            </span>
          </div>
          {steps.map((step, i) => (
            <TimelineStep
              key={`${step.label}-${i}`}
              step={step}
              isLast={i === steps.length - 1}
              index={i}
            />
          ))}
        </div>

        {/* ===== PROOF PHOTO SECTION ===== */}
        {(task.proofImages || task.proofImageUrl) && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-4 pt-4 pb-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                Submitted Proof
              </p>
            </div>

            {/* Image(s) */}
            <div className="px-3 sm:px-4">
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
            </div>

            {/* Proof note */}
            {task.proofNote && (
              <div className="px-4 pt-2">
                <p className="text-[11px] text-gray-400 italic leading-relaxed">
                  &ldquo;{task.proofNote}&rdquo;
                </p>
              </div>
            )}

            {/* Inline verdict summary below the photo */}
            {task.verificationResult && (
              <div className="mx-4 mt-3 mb-4 flex items-center gap-2">
                <div className={`w-5 h-5 rounded-md flex items-center justify-center ${verdictBg(task.verificationResult.verdict)}`}>
                  {task.verificationResult.verdict === "pass" ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
                <span className={`text-xs font-bold ${verdictColor(task.verificationResult.verdict)}`}>
                  {task.verificationResult.verdict.toUpperCase()}
                </span>
                <span className="text-[10px] text-gray-500">
                  {Math.round(task.verificationResult.confidence * 100)}% confidence
                </span>
                <span className="text-[9px] text-gray-600 ml-auto">Verification engine</span>
              </div>
            )}
          </div>
        )}

        {/* ===== AI VERDICT (full card) ===== */}
        {task.verificationResult && <AiVerdictCard result={task.verificationResult} />}

        {/* ===== AI FOLLOW-UP ===== */}
        {task.aiFollowUp && <FollowUpCard followUp={task.aiFollowUp} />}

        {/* ===== WORLD CHAT THREAD ===== */}
        <WorldChatThread
          messages={messages}
          agent={task.agent}
          userId={task.claimant || task.poster}
          onSend={sendMessage}
        />

        {/* ===== ON-CHAIN SETTLEMENT ===== */}
        {(task.escrowTxHash || task.attestationTxHash || task.onChainId !== null) && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                </div>
                <p className="text-xs font-semibold text-white">
                  On-Chain Settlement
                </p>
              </div>
              {task.status === "completed" && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  Settled on World Chain
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {/* Amount */}
              <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-3.5 py-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Amount</p>
                <p className="text-sm text-green-400 font-bold">${task.bountyUsdc} USDC</p>
              </div>

              {/* Escrow TX */}
              {task.escrowTxHash && (
                <OnChainLink
                  label="Escrow Transaction"
                  value={`${task.escrowTxHash.slice(0, 10)}...${task.escrowTxHash.slice(-8)}`}
                  href={`${WORLDSCAN_TX}/${task.escrowTxHash}`}
                  mono
                />
              )}

              {/* Contract address */}
              <OnChainLink
                label="Escrow Contract"
                value={`${ESCROW_ADDRESS.slice(0, 10)}...${ESCROW_ADDRESS.slice(-8)}`}
                href={`${WORLDSCAN_ADDR}/${ESCROW_ADDRESS}`}
                mono
              />

              {/* Attestation */}
              {task.attestationTxHash && (
                <OnChainLink
                  label="AI Attestation TX"
                  value={`${task.attestationTxHash.slice(0, 10)}...${task.attestationTxHash.slice(-8)}`}
                  href={`${WORLDSCAN_TX}/${task.attestationTxHash}`}
                  mono
                />
              )}

              {/* On-chain task ID */}
              {task.onChainId !== null && (
                <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-3.5 py-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">On-Chain Task ID</p>
                  <p className="text-xs text-gray-300 font-mono">#{task.onChainId}</p>
                </div>
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
