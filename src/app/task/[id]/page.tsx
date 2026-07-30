"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Task, VerificationResult, AiFollowUp } from "@/lib/types";
import { VerificationBadge, RequiredTierBadge } from "@/components/VerificationBadge";
import { hapticTap, hapticSuccess, hapticError, shareTask } from "@/lib/minikit-helpers";
import { MiniKit } from "@worldcoin/minikit-js";
import { rewardAmountLabel, isPointsReward, isRealMoney } from "@/lib/reward";
import { useWorldUsers, displayName } from "@/hooks/useWorldUser";
import { TopBar, Button, Typography, Spinner, Pill, Input, CircularIcon } from "@worldcoin/mini-apps-ui-kit-react";

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

const ESCROW_ADDRESS = "0x274C38eA9944f57D24A59fbEf558bba2264f9351";
const WORLDSCAN_TX = "https://worldscan.org/tx";
const WORLDSCAN_ADDR = "https://worldscan.org/address";

function truncate(addr: string): string {
  return displayName(addr);
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
  feedback: "\u{1F4AC}",
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: "bg-gray-900/15", text: "text-gray-500", label: "Open" },
  claimed: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Claimed" },
  completed: { bg: "bg-green-500/15", text: "text-green-400", label: "Completed" },
  failed: { bg: "bg-red-500/15", text: "text-red-400", label: "Failed" },
  expired: { bg: "bg-gray-500/15", text: "text-gray-400", label: "Expired" },
};

function verdictColor(v: string): string {
  if (v === "pass") return "text-green-400";
  if (v === "flag") return "text-warning-600";
  return "text-red-400";
}

function verdictBg(v: string): string {
  if (v === "pass") return "bg-green-500";
  if (v === "flag") return "bg-warning-600";
  return "bg-red-500";
}

function verdictBgLight(v: string): string {
  if (v === "pass") return "bg-green-500/10";
  if (v === "flag") return "bg-warning-100";
  return "bg-red-500/10";
}

function verdictBorder(v: string): string {
  if (v === "pass") return "border-green-500/20";
  if (v === "flag") return "border-warning-300";
  return "border-red-500/20";
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3.5 min-h-[44px] flex items-center gap-3 hover:bg-gray-50 transition-colors"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="text-xs text-gray-400 uppercase tracking-wider font-medium flex-1 text-left">
          {title}
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-gray-400 transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-gray-200">
          {children}
        </div>
      )}
    </div>
  );
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
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
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
    ? "bg-green-400 border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.3)]"
    : step.current
    ? "bg-gray-500 border-gray-400 shadow-[0_0_8px_rgba(155,163,174,0.3)] animate-pulse"
    : "bg-transparent border-gray-400";

  const lineColor = step.done
    ? "bg-gradient-to-b from-green-400/30 to-green-400/5"
    : "bg-gray-200";

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
            <div className="absolute -inset-1 rounded-full bg-gray-500/20 animate-ping" />
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
                ? "text-gray-900"
                : step.current
                ? "text-gray-900"
                : "text-gray-400"
            }`}
          >
            {step.label}
          </p>
        </div>
        {step.detail && (
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
            {step.detail}
          </p>
        )}
        {step.time && (
          <p className="text-xs text-gray-400 mt-1 font-mono">
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
          className="w-full rounded-xl border border-gray-200 object-cover max-h-72 transition-transform duration-200 group-hover:scale-[1.01]"
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
            className="absolute top-4 right-4 w-11 h-11 min-h-[44px] rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-10"
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

function VerdictIcon({ verdict, size = 16 }: { verdict: string; size?: number }) {
  if (verdict === "pass") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (verdict === "flag") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ConfidenceRing({ pct, verdict, size = 48 }: { pct: number; verdict: string; size?: number }) {
  const r = size * 0.417; // radius proportional to size
  const circumference = 2 * Math.PI * r;
  const strokeColor = verdict === "pass" ? "#4ade80" : verdict === "flag" ? "#fbbf24" : "#f87171";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="rgba(0,0,0,0.06)"
          strokeWidth={size * 0.083}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={size * 0.083}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference - (pct / 100) * circumference}`}
          className="transition-all duration-1000"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-bold ${verdictColor(verdict)}`} style={{ fontSize: size * 0.23 }}>
        {pct}%
      </span>
    </div>
  );
}

function ConsensusLine({ models, consensusMethod, overallVerdict }: { models: import("@/lib/types").ModelVerdict[]; consensusMethod?: "majority" | "unanimous"; overallVerdict: string }) {
  const passCount = models.filter((m) => m.verdict === "pass").length;
  const flagCount = models.filter((m) => m.verdict === "flag").length;
  const failCount = models.filter((m) => m.verdict === "fail").length;
  const total = models.length;
  const allAgree = passCount === total || failCount === total || flagCount === total;

  let label: string;
  let sublabel: string;

  if (allAgree && overallVerdict === "pass") {
    label = "Consensus: Verified";
    sublabel = `${total}/${total} agree`;
  } else if (allAgree && overallVerdict === "fail") {
    label = "Consensus: Rejected";
    sublabel = `${total}/${total} agree`;
  } else if (allAgree && overallVerdict === "flag") {
    label = "Consensus: Flagged";
    sublabel = `${total}/${total} agree`;
  } else if (consensusMethod === "unanimous") {
    label = "Consensus: Flagged";
    sublabel = "models disagree";
  } else {
    // majority
    const majorityVerdict = passCount >= flagCount && passCount >= failCount ? "pass" : failCount >= passCount && failCount >= flagCount ? "fail" : "flag";
    const majorityCount = Math.max(passCount, flagCount, failCount);
    const majorityLabel = majorityVerdict === "pass" ? "Pass" : majorityVerdict === "fail" ? "Fail" : "Flag";
    label = `Majority verdict: ${majorityLabel}`;
    sublabel = `${majorityCount}/${total}`;
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${verdictBorder(overallVerdict)} ${verdictBgLight(overallVerdict)}`}>
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${verdictBg(overallVerdict)}`}>
        <VerdictIcon verdict={overallVerdict} size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-bold ${verdictColor(overallVerdict)}`}>{label}</p>
      </div>
      <span className="text-xs text-gray-400 font-mono shrink-0">({sublabel})</span>
    </div>
  );
}

function AiVerdictCard({ result }: { result: VerificationResult }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(result.confidence * 100);
  const verdictLabel = result.verdict.toUpperCase();
  const hasModels = result.models && result.models.length > 0;

  return (
    <div className={`border rounded-2xl overflow-hidden ${verdictBorder(result.verdict)} ${verdictBgLight(result.verdict)}`}>
      {/* Header row */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${verdictBg(result.verdict)}`}>
              <VerdictIcon verdict={result.verdict} />
            </div>
            <div>
              <p className={`text-sm font-bold ${verdictColor(result.verdict)}`}>
                {verdictLabel}
              </p>
              <p className="text-xs text-gray-400">
                {hasModels ? `${result.models!.length}-Model Panel` : "Verification"}
              </p>
            </div>
          </div>

          {/* Confidence ring */}
          <ConfidenceRing pct={pct} verdict={result.verdict} size={48} />
        </div>

        {/* Confidence bar */}
        <div className="mb-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-gray-400 uppercase tracking-wider">
              {hasModels ? "Aggregate Confidence" : "Confidence"}
            </span>
            <span className={`text-xs font-semibold ${verdictColor(result.verdict)}`}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out ${verdictBg(result.verdict)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* ===== Multi-model panel (always visible when models exist) ===== */}
      {hasModels && (
        <div className="px-4 pb-4">
          {/* Section label */}
          <div className="flex items-center gap-2 mb-3 pt-3 border-t border-gray-200">
            <div className="w-4 h-4 rounded bg-gray-100 flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
              AI Judge Panel
            </span>
            <span className="ml-auto text-xs text-gray-400 font-mono">
              {result.consensusMethod === "unanimous" ? "Unanimous" : "Majority"} rule
            </span>
          </div>

          {/* Individual model verdicts */}
          <div className="flex flex-col gap-2 mb-3">
            {result.models!.map((m, i) => {
              const mPct = Math.round(m.confidence * 100);
              return (
                <div
                  key={i}
                  className={`relative bg-white border rounded-xl px-3 py-2.5 transition-all shadow-sm ${
                    m.verdict === "pass"
                      ? "border-green-500/15"
                      : m.verdict === "flag"
                      ? "border-warning-300"
                      : "border-red-500/15"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Model verdict icon */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        m.verdict === "pass"
                          ? "bg-green-500/15"
                          : m.verdict === "flag"
                          ? "bg-warning-100"
                          : "bg-red-500/15"
                      }`}
                    >
                      {m.verdict === "pass" ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : m.verdict === "flag" ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                    </div>

                    {/* Model name + verdict */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{m.name}</p>
                      <p className={`text-xs font-medium ${verdictColor(m.verdict)}`}>
                        {m.verdict.toUpperCase()}
                      </p>
                    </div>

                    {/* Mini confidence ring */}
                    <ConfidenceRing pct={mPct} verdict={m.verdict} size={36} />
                  </div>

                  {/* Per-model confidence bar */}
                  <div className="mt-2">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${verdictBg(m.verdict)}`}
                        style={{ width: `${mPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Reasoning snippet */}
                  {m.reasoning && (
                    <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2 italic">
                      {m.reasoning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Consensus summary line */}
          <ConsensusLine
            models={result.models!}
            consensusMethod={result.consensusMethod}
            overallVerdict={result.verdict}
          />
        </div>
      )}

      {/* Expandable reasoning */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 min-h-[44px] border-t border-gray-200 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
          {hasModels ? "Overall Reasoning" : "Reasoning"}
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
          className={`text-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-200">
          <p className="text-xs text-gray-500 italic leading-relaxed pt-3">
            &ldquo;{result.reasoning}&rdquo;
          </p>
          <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-gray-200">
            <div className="w-4 h-4 rounded bg-gray-100 flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-xs text-gray-400 font-medium">
              {hasModels ? `${result.models!.length}-model consensus verification` : "Verified automatically"}
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
    <div className="bg-warning-100 border border-warning-300 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-warning-600 text-sm">&#9888;&#65039;</span>
        <span className="text-xs text-warning-600 uppercase tracking-wider font-medium">
          Follow-up &middot; {followUp.status}
        </span>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{followUp.question}</p>
      <p className="text-xs text-gray-400 mt-2">
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
      ? "FAVOUR Bot"
      : msg.sender.replace("agent_", "").replace(/^\w/, (c) => c.toUpperCase())
    : "Runner";
  const agentIcon = isSystem ? (agent ? agent.icon : "\u{1F916}") : null;
  const agentColor = isSystem ? (agent ? agent.color : "#657080") : null;

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
        className={`max-w-[80%] rounded-xl px-3 py-2 ${
          isSystem
            ? "bg-gray-50 border border-gray-200 rounded-tl-sm"
            : "bg-gray-100 border border-gray-200 rounded-tr-sm"
        }`}
      >
        <p
          className="text-xs font-bold mb-0.5 uppercase tracking-wide"
          style={isSystem && agentColor ? { color: agentColor } : undefined}
        >
          <span className={isSystem ? "" : "text-gray-500"}>{senderLabel}</span>
        </p>
        <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">
          {msg.text}
        </p>
        <p className="text-xs text-gray-400 mt-1 font-mono text-right">
          {formatTimestamp(msg.timestamp)} &middot; {timeAgo(msg.timestamp)}
        </p>
      </div>
      {!isSystem && (
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 ml-2 mt-0.5 bg-gray-100">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-gray-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor" className="text-gray-400"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm font-semibold text-gray-900">XMTP Thread</span>
          {messages.length > 0 && (
            <span className="text-xs text-gray-400 font-mono ml-1">
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
          <div className="mb-3">
            <Spinner />
          </div>
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            Waiting for XMTP thread...
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
        <div className="border-t border-gray-200 px-3 py-2.5">
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
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500 placeholder-gray-400 outline-none focus:border-gray-400 transition-colors min-h-[44px]"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="shrink-0 w-11 h-11 min-h-[44px] rounded-xl bg-black flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
            >
              {sending ? (
                <Spinner className="w-3.5 h-3.5" />
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
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
      className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3 min-h-[44px] hover:border-gray-400 transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
        {value && (
          <p className={`text-xs text-gray-500 group-hover:text-gray-900 transition-colors truncate ${mono ? "font-mono" : ""}`}>
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
        className="text-gray-400 group-hover:text-gray-900 transition-colors ml-3 shrink-0"
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
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
          Posted by Agent
        </p>
        <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
          Task reward
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
            <p className="text-xs text-gray-400 mt-0.5 italic leading-relaxed">
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
  shelfwatch: "Retail intelligence at scale. Brands pay for real shelf data.",
  freshmap: "Local business intelligence. Keeps local data fresh with real human visits.",
  queuepulse: "Real-time wait time intelligence. Data no API provides.",
  propertycheck: "Listing verification at scale. Confirms what photos don't show.",
  dropscout: "Ground intel for brands. Eyes on the scene before anyone else.",
};

// ---------------------------------------------------------------------------
// Escrow V2 panel (rewardType "usdc-v2") — the demand-gated USDC flow.
//
// Poster: fund at claimant-accept -> confirm & release -> (post-deadline) refund.
// Claimant: honest status of the on-chain escrow.
// Every state change goes through /api/escrow-v2, which verifies the chain
// before touching the task record — this panel only signs and reports.
// ---------------------------------------------------------------------------

type EscrowV2ChainState = {
  disclosure?: string;
  record: {
    funder: string;
    recipient: string;
    amount: string;
    deadline: string;
    status: number; // 0 None, 1 Funded, 2 Released, 3 Refunded
    refundable: boolean;
  } | null;
};

/**
 * Pull whatever identifier MiniKit returned. v2 resolves with
 * { executedWith, data: { userOpHash, ... } } as soon as the user operation is
 * SUBMITTED — a userOpHash is NOT a transaction hash and NOT proof of mining
 * (docs.world.org/mini-apps/commands/send-transaction, "Confirming the User
 * Operation"). It is only ever used as (a) a fallback the server still
 * re-verifies against the chain's own logs and (b) a handle to poll the
 * userop status endpoint for early failure detection.
 */
function extractV2TxHash(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Record<string, unknown>;
  if ("transactionHash" in r && r.transactionHash) return String(r.transactionHash);
  if ("userOpHash" in r && r.userOpHash) return String(r.userOpHash);
  const data = (r as { data?: unknown }).data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (d.transactionHash) return String(d.transactionHash);
    if (d.userOpHash) return String(d.userOpHash);
  }
  const fp = (r as { finalPayload?: unknown }).finalPayload;
  if (typeof fp === "object" && fp !== null) {
    const f = fp as Record<string, unknown>;
    if (f.transaction_id) return String(f.transaction_id);
  }
  return null;
}

/**
 * Best-effort check of the World App user-operation status. The success
 * animation in World App only proves SUBMISSION — the op can still fail
 * afterwards (`transaction_failed` class). Returns "failed" | "success" |
 * "unknown"; any network/CORS hiccup is "unknown" and never blocks the
 * chain-truth polling loop, which remains the sole authority for FUNDED.
 */
async function checkUserOpStatus(userOpHash: string): Promise<"failed" | "success" | "unknown"> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) return "unknown";
  try {
    const res = await fetch(`https://developer.world.org/api/v2/minikit/userop/${userOpHash}`);
    if (!res.ok) return "unknown";
    const d = await res.json().catch(() => null);
    if (d && typeof d.status === "string") {
      if (d.status === "failed" || d.status === "reverted") return "failed";
      if (d.status === "success") return "success";
    }
  } catch { /* opaque network failure — chain polling decides */ }
  return "unknown";
}

function EscrowV2Panel({ task, onAction }: { task: Task; onAction: () => void }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [chain, setChain] = useState<EscrowV2ChainState | null>(null);
  const [railOpen, setRailOpen] = useState<boolean>(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    try { setUserId(localStorage.getItem("relay_user_id")); } catch { /* no storage */ }
  }, []);

  const loadChain = useCallback(() => {
    fetch(`/api/escrow-v2?taskId=${task.id}`)
      .then((r) => {
        if (r.status === 404) { setRailOpen(false); return null; }
        return r.json();
      })
      .then((d) => { if (d) setChain(d); })
      .catch(() => {});
  }, [task.id]);

  useEffect(() => { loadChain(); }, [loadChain]);

  if (!railOpen) return null;

  const isPoster = !!userId && userId === task.poster;
  const isClaimant = !!userId && userId === task.claimant;
  const funded = !!task.escrowTxHash;
  const released = !!task.settlementTx;
  const refunded = !!task.escrowV2RefundTx;
  const refundable = !!chain?.record?.refundable;
  const disclosure = chain?.disclosure || "Released when you confirm completion. Auto-refundable to you after the deadline.";

  // Sign a prepared payload, then loop the matching verify action until the
  // server corroborates the chain (a few seconds of block time).
  const signAndVerify = async (
    prepareAction: string,
    verifyAction: string,
    doneKey: "funded" | "released" | "refunded"
  ) => {
    setBusy(prepareAction);
    setNote(null);
    try {
      const prep = await fetch("/api/escrow-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: prepareAction, taskId: task.id, poster: userId }),
      });
      const prepData = await prep.json();
      if (!prep.ok || !prepData.payload) {
        setNote({ type: "error", text: prepData.error || "Could not prepare the transaction." });
        hapticError();
        return;
      }
      if (!MiniKit.isInstalled()) {
        setNote({ type: "error", text: "Open FAVOUR inside World App to sign this transaction." });
        return;
      }
      const result = await MiniKit.sendTransaction(prepData.payload);
      const txHash = extractV2TxHash(result);
      if (!result) {
        setNote({ type: "error", text: "Transaction was rejected. Nothing was charged." });
        hapticError();
        return;
      }
      // NEVER mirror World App's optimism: its success animation only means the
      // user operation was SUBMITTED (INCIDENT 2026-07-31). From here on, the
      // only thing that may flip state to FUNDED is the server corroborating
      // the chain's own escrow record + event log.
      setNote({ type: "info", text: "Signed — not confirmed yet. Waiting for the chain..." });
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const ver = await fetch("/api/escrow-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: verifyAction, taskId: task.id, txHash }),
        });
        const verData = await ver.json().catch(() => ({}));
        if (ver.ok && verData[doneKey]) {
          hapticSuccess();
          setNote({ type: "success", text: doneKey === "funded" ? "Escrow funded and verified on-chain." : doneKey === "released" ? "Payment released on-chain." : "Refund confirmed on-chain." });
          loadChain();
          onAction();
          return;
        }
        // Early failure surfacing: if World App reports the submitted user op
        // as failed, say so plainly instead of letting the user wait out the
        // loop believing the success animation.
        if (i === 3 && txHash) {
          const opStatus = await checkUserOpStatus(txHash);
          if (opStatus === "failed") {
            hapticError();
            setNote({ type: "error", text: "World App reports the transaction failed after signing — nothing moved on-chain and nothing was charged. Please try again." });
            return;
          }
        }
      }
      setNote({ type: "error", text: "Not confirmed on-chain yet. Nothing shows as funded until the chain says so — pull to refresh in a minute. If this repeats, the transaction likely failed silently in World App; try again." });
    } catch (err) {
      hapticError();
      setNote({ type: "error", text: err instanceof Error ? err.message : "Transaction failed." });
    } finally {
      setBusy(null);
    }
  };

  const chip = (text: string, tone: "green" | "amber" | "gray") => (
    <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${
      tone === "green" ? "text-success-700 bg-success-100" : tone === "amber" ? "text-warning-700 bg-warning-100" : "text-gray-500 bg-gray-100"
    }`}>{text}</span>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">USDC escrow</p>
        {released ? chip("Paid", "green")
          : refunded ? chip("Refunded", "gray")
          : funded ? chip("Funded on-chain", "green")
          : task.status === "claimed" ? chip("Awaiting funding", "amber")
          : chip("Funds on accept", "amber")}
      </div>

      {/* POSTER: fund step — appears the moment a claimant accepts. */}
      {isPoster && task.status === "claimed" && !funded && (
        <>
          <p className="text-xs text-gray-500">
            Someone accepted your favour. Lock ${task.bountyUsdc} USDC in the verified escrow so they can start — {disclosure.charAt(0).toLowerCase() + disclosure.slice(1)}
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full min-h-[48px]"
            onClick={() => signAndVerify("prepare-fund", "verify-funded", "funded")}
            disabled={busy !== null}
          >
            {busy === "prepare-fund" ? "Confirm in World App..." : `Fund $${task.bountyUsdc} USDC`}
          </Button>
        </>
      )}

      {/* POSTER: confirm & release. */}
      {isPoster && funded && !released && !refunded && (
        <>
          <p className="text-xs text-gray-500">
            {task.pendingRelease
              ? "The proof passed verification. Confirm completion to pay the runner — the contract can only ever pay the wallet bound at funding."
              : "When the favour is done, confirm to release the payment. The contract can only ever pay the wallet bound at funding."}
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full min-h-[48px]"
            onClick={() => signAndVerify("prepare-release", "verify-released", "released")}
            disabled={busy !== null}
          >
            {busy === "prepare-release" ? "Confirm in World App..." : `Confirm & release $${task.bountyUsdc}`}
          </Button>
          {refundable && (
            <Button
              variant="tertiary"
              size="lg"
              className="w-full min-h-[44px]"
              onClick={() => signAndVerify("prepare-refund", "verify-refunded", "refunded")}
              disabled={busy !== null}
            >
              {busy === "prepare-refund" ? "Confirm in World App..." : "Deadline passed — reclaim your USDC"}
            </Button>
          )}
        </>
      )}

      {/* CLAIMANT: honest status. */}
      {isClaimant && !released && !refunded && (
        <p className="text-xs text-gray-500">
          {funded
            ? `$${task.bountyUsdc} USDC is locked on-chain for you. It releases when the poster confirms completion.`
            : "The poster hasn't funded the escrow yet. Wait for the \"funded\" notification before doing the work — proof can't be submitted until the money is locked."}
        </p>
      )}

      {task.escrowTxHash && (
        <a
          href={`${WORLDSCAN_TX}/${task.escrowTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-400 underline underline-offset-2"
        >
          View escrow transaction
        </a>
      )}

      {note && (
        <p className={`text-xs ${note.type === "success" ? "text-success-700" : note.type === "error" ? "text-red-500" : "text-gray-500"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispute Actions
// ---------------------------------------------------------------------------

type UmaState = {
  umaEnabled: boolean;
  dispute: {
    assertionId: string;
    status: string;
    asserter: string;
    disputer: string | null;
    bondUsdc: number;
    expirationTime: number;
  } | null;
};

function DisputeActions({ task, onAction }: { task: Task; onAction: () => void }) {
  const [acting, setActing] = useState<string | null>(null);
  const [umaState, setUmaState] = useState<UmaState | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${task.id}/escalate`)
      .then((r) => r.json())
      .then(setUmaState)
      .catch(() => null);
  }, [task.id]);

  const handleConfirm = async (approved: boolean) => {
    setActing(approved ? "approve" : "reject");
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: task.poster, approved }),
      });
      if (res.ok) {
        setResult({ type: "success", message: approved ? "Proof approved — USDC released" : "Proof rejected" });
        onAction();
      } else {
        const data = await res.json();
        setResult({ type: "error", message: data.error || "Failed" });
      }
    } catch {
      setResult({ type: "error", message: "Network error" });
    } finally {
      setActing(null);
    }
  };

  const handleMediation = async () => {
    setActing("mediate");
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poster: task.poster }),
      });
      if (res.ok) {
        const data = await res.json();
        const verdict = data.dispute?.approved ? "Approved" : "Rejected";
        setResult({ type: "success", message: `AI Mediation: ${verdict} (${Math.round((data.dispute?.confidence || 0) * 100)}% confidence)` });
        onAction();
      } else {
        const data = await res.json();
        setResult({ type: "error", message: data.error || "Mediation failed" });
      }
    } catch {
      setResult({ type: "error", message: "Network error" });
    } finally {
      setActing(null);
    }
  };

  const handleUmaEscalate = async () => {
    if (!task.claimant) return;
    setActing("uma");
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assert", address: task.claimant }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult({ type: "success", message: `Escalated to UMA Oracle. Challenge window: ${data.challengeWindow}` });
        setUmaState((prev) => prev ? { ...prev, dispute: { assertionId: data.assertionId, status: "asserted", asserter: task.claimant!, disputer: null, bondUsdc: 5, expirationTime: Math.floor(Date.now() / 1000) + 7200 } } : prev);
      } else {
        const data = await res.json();
        setResult({ type: "error", message: data.error || "Escalation failed" });
      }
    } catch {
      setResult({ type: "error", message: "Network error" });
    } finally {
      setActing(null);
    }
  };

  const confidence = task.verificationResult?.confidence || 0;
  const pct = Math.round(confidence * 100);

  return (
    <div className="bg-warning-100 border border-warning-300 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-lg bg-warning-600 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-warning-600">Proof Flagged</p>
            <p className="text-xs text-gray-400">AI confidence: {pct}% — resolve this dispute</p>
          </div>
        </div>
      </div>

      {/* UMA Status (if active) */}
      {umaState?.dispute && (
        <div className="mx-4 mb-3 bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">UMA Oracle</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
              umaState.dispute.status === "asserted" ? "bg-gray-900/15 text-gray-500" :
              umaState.dispute.status === "disputed" ? "bg-red-500/15 text-red-400" :
              umaState.dispute.status === "settled_true" ? "bg-green-500/15 text-green-400" :
              "bg-gray-500/15 text-gray-400"
            }`}>
              {umaState.dispute.status.replace("_", " ").toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-gray-400">Bond: ${umaState.dispute.bondUsdc} USDC</p>
          {umaState.dispute.status === "asserted" && (
            <p className="text-xs text-gray-400">
              Challenge window ends: {new Date(umaState.dispute.expirationTime * 1000).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="px-4 pb-4 flex flex-col gap-2">
        {/* Poster actions: Approve / Reject */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={() => handleConfirm(true)}
            disabled={!!acting}
            className="flex-1 min-h-[44px] !bg-green-500"
          >
            {acting === "approve" ? (
              <Spinner className="w-3.5 h-3.5" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            Approve
          </Button>
          <Button
            variant="secondary"
            fullWidth
            size="lg"
            onClick={() => handleConfirm(false)}
            disabled={!!acting}
            className="flex-1 min-h-[44px] !bg-red-500 !text-white !border-red-500"
          >
            {acting === "reject" ? (
              <Spinner className="w-3.5 h-3.5" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            Reject
          </Button>
        </div>

        {/* AI Mediation */}
        <Button
          variant="tertiary"
          fullWidth
          size="lg"
          onClick={handleMediation}
          disabled={!!acting}
          className="min-h-[44px]"
        >
          {acting === "mediate" ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          )}
          AI Mediation (Claude Opus)
        </Button>

        {/* UMA Escalation */}
        {umaState?.umaEnabled && !umaState.dispute && (
          <Button
            variant="tertiary"
            fullWidth
            size="lg"
            onClick={handleUmaEscalate}
            disabled={!!acting}
            className="min-h-[44px]"
          >
            {acting === "uma" ? (
              <Spinner className="w-3.5 h-3.5" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            )}
            Escalate to UMA Oracle ($5 bond)
          </Button>
        )}

        {/* Chainlink badge */}
        <div className="flex items-center justify-center gap-2 pt-1">
          <span className="text-xs text-gray-400">Dispute resolution powered by</span>
          <span className="text-xs font-bold text-gray-400">AI + UMA + Chainlink</span>
        </div>
      </div>

      {/* Result feedback */}
      {result && (
        <div className={`mx-4 mb-4 px-3 py-2 rounded-xl text-xs font-medium ${
          result.type === "success" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
        }`}>
          {result.message}
        </div>
      )}
    </div>
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

  const addressesToResolve = task ? [task.poster, task.claimant].filter(Boolean) as string[] : [];
  useWorldUsers(addressesToResolve);

  const fetchData = useCallback(async () => {
    try {
      const [taskRes, msgsRes] = await Promise.all([
        fetch(`/api/tasks/${id}`),
        fetch(`/api/tasks/${id}/messages`),
      ]);

      if (taskRes.ok) {
        const data = await taskRes.json();
        if (data.task) setTask(data.task as Task);
        else if (!task) setError("Task not found");
      } else if (!task) {
        setError("Task not found");
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
    const interval = setInterval(fetchData, 30_000); // 30s — was 5s, SSE handles real-time
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---- Loading state ----
  if (loading && !task) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner />
          <div className="text-center">
            <p className="text-xs text-gray-400 font-medium">Loading task</p>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{id?.slice(0, 16)}...</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && !task) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <p className="text-sm text-red-400 font-medium">{error}</p>
        <Link href="/">
          <Button variant="tertiary" size="lg" className="min-h-[44px]">
            Back to feed
          </Button>
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
      label: `Verified — ${task.verificationResult.verdict.toUpperCase()} ${pct}%`,
      detail: `Proof analyzed and verified`,
      time: timeAgo(verifyTime),
      icon: "\u{1F916}",
    });
  } else if (task.proofImageUrl && !isTerminal) {
    steps.push({
      done: false,
      current: true,
      label: "Verification",
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
          ? (task.rewardType === "points" ? "Points Awarded" : "USDC Released")
          : task.status === "failed"
          ? "Verification Failed"
          : "Deadline Passed",
      detail:
        task.status === "completed"
          ? (task.rewardType === "points" ? `${Math.round(task.bountyUsdc)} pts awarded to runner` : `$${task.bountyUsdc} USDC sent to runner`)
          : task.status === "failed"
          ? "Proof did not meet requirements"
          : "Task expired without completion",
      time: timeAgo(terminalTime),
      icon: task.status === "completed" ? "\u{1F4B0}" : task.status === "failed" ? "\u{274C}" : "\u{23F0}",
    });
  }

  // ---- Render ----

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 max-w-lg mx-auto">
      {/* Sticky Header */}
      <TopBar
        title={`${categoryIcon} Task Detail`}
        startAdornment={
          <Link href="/" aria-label="Back to feed">
            <Button variant="tertiary" size="sm" className="min-h-[44px]" aria-label="Back to feed">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Button>
          </Link>
        }
        endAdornment={
          <Button
            variant="tertiary"
            size="sm"
            className="min-h-[44px]"
            onClick={() => {
              hapticTap();
              shareTask({
                taskDescription: task.description,
                bountyUsdc: task.bountyUsdc,
                verdict: task.verificationResult?.verdict,
                taskId: task.id,
                rewardType: task.rewardType,
                funded: task.onChainId !== null || !!task.escrowTxHash,
              });
            }}
            aria-label="Share task"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </Button>
        }
      />

      <div className="px-6 py-4 flex flex-col gap-4">

        {/* ===== STATUS HERO ===== */}
        <div className={`rounded-2xl p-4 border ${
          task.status === "completed"
            ? "bg-green-500/5 border-green-500/15"
            : task.status === "failed"
            ? "bg-red-500/5 border-red-500/15"
            : task.status === "claimed"
            ? "bg-yellow-500/5 border-yellow-500/15"
            : "bg-gray-900/5 border-gray-200"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <StatusBadge status={task.status} />
              {task.taskType === "double-or-nothing" && (
                <span className="flex items-center gap-0.5 text-xs text-warning-600 font-bold bg-warning-100 border border-warning-300 rounded-full px-1.5 py-0.5">
                  &#x1f3b2; Double-or-Nothing
                </span>
              )}
              {task.status === "completed" && (
                <span className="text-xs text-green-400 font-medium">
                  Task Complete
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400 font-mono">{task.id.slice(0, 16)}</span>
          </div>
          {task.status === "completed" && task.verificationResult?.verdict === "pass" && (
            <Button
              variant="primary"
              fullWidth
              size="lg"
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
              className="mt-3 min-h-[44px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              Share Verified Completion
            </Button>
          )}
        </div>

        {/* Restricted badge */}
        {task.claimCode !== null && (
          <div className="bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="text-sm">{"\u{1F512}"}</span>
            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
              Access Code Required
            </span>
          </div>
        )}

        {/* ===== AGENT CARD ===== */}
        {task.agent && (
          <AgentCard agent={task.agent} personality={agentPersonality} />
        )}

        {/* ===== TASK INFO CARD ===== */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">
            Task Details
          </p>

          <p className="text-sm text-gray-900 leading-relaxed mb-4 break-words">{task.description}</p>

          <div className="grid grid-cols-2 gap-y-3 gap-x-3 sm:gap-x-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Location</p>
              <p className="text-xs text-gray-500 mt-0.5">{task.location}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">
                {task.taskType === "double-or-nothing" ? "Double-or-Nothing" : "Bounty"}
              </p>
              {task.taskType === "double-or-nothing" ? (
                <>
                  <p className="text-sm text-warning-600 font-bold mt-0.5">
                    ${task.bountyUsdc * 2} USDC
                  </p>
                  <p className="text-xs text-warning-600/60">
                    ${task.bountyUsdc} poster + ${task.bountyUsdc} runner stake
                  </p>
                </>
              ) : (
                <p className="text-sm text-green-400 font-bold mt-0.5">
                  {rewardAmountLabel(task)}
                </p>
              )}
              <RequiredTierBadge bountyUsdc={task.bountyUsdc} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Category</p>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">
                {categoryIcon} {task.category}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Deadline</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatDate(task.deadline)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Poster</p>
              <p className="text-xs text-gray-500 mt-0.5 font-mono">{truncate(task.poster)}</p>
            </div>
            {task.claimant && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">Runner</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-gray-500 font-mono">
                    {truncate(task.claimant)}
                  </p>
                  <VerificationBadge level={task.claimantVerification} size="sm" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== LIFECYCLE TIMELINE ===== */}
        <CollapsibleSection
          title="Lifecycle Timeline"
          badge={
            <span className="text-xs text-gray-400 font-mono">
              {steps.filter((s) => s.done).length}/{steps.length}
            </span>
          }
        >
          <div className="p-4">
            {steps.map((step, i) => (
              <TimelineStep
                key={`${step.label}-${i}`}
                step={step}
                isLast={i === steps.length - 1}
                index={i}
              />
            ))}
          </div>
        </CollapsibleSection>

        {/* ===== PROOF PHOTO SECTION ===== */}
        {(task.proofImages || task.proofImageUrl) && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 pt-4 pb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">
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
                <p className="text-xs text-gray-400 italic leading-relaxed">
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
                <span className="text-xs text-gray-400">
                  {Math.round(task.verificationResult.confidence * 100)}% confidence
                </span>
                <span className="text-xs text-gray-400 ml-auto">Verification engine</span>
              </div>
            )}
          </div>
        )}

        {/* ===== AI VERDICT (collapsible) ===== */}
        {task.verificationResult && (
          <CollapsibleSection
            title="AI Verification"
            badge={
              <span className={`text-xs font-bold ${verdictColor(task.verificationResult.verdict)}`}>
                {task.verificationResult.verdict.toUpperCase()} {Math.round(task.verificationResult.confidence * 100)}%
              </span>
            }
          >
            <div className="p-4">
              <AiVerdictCard result={task.verificationResult} />
            </div>
          </CollapsibleSection>
        )}

        {/* ===== AI FOLLOW-UP ===== */}
        {task.aiFollowUp && <FollowUpCard followUp={task.aiFollowUp} />}

        {/* ===== ESCROW V2 (usdc-v2 tasks: fund / release / refund) ===== */}
        {task.rewardType === "usdc-v2" && !["cancelled", "failed"].includes(task.status) && (
          <EscrowV2Panel task={task} onAction={fetchData} />
        )}

        {/* ===== DISPUTE ACTIONS (flagged tasks - always visible, actionable) ===== */}
        {task.verificationResult?.verdict === "flag" && task.status !== "completed" && task.status !== "failed" && (
          <DisputeActions
            task={task}
            onAction={fetchData}
          />
        )}

        {/* ===== WORLD CHAT THREAD (collapsible) ===== */}
        <CollapsibleSection
          title="XMTP Chat"
          badge={
            messages.length > 0 ? (
              <span className="text-xs text-gray-400 font-mono">
                {messages.length} message{messages.length !== 1 ? "s" : ""}
              </span>
            ) : undefined
          }
        >
          <WorldChatThread
            messages={messages}
            agent={task.agent}
            userId={task.claimant || task.poster}
            onSend={sendMessage}
          />
        </CollapsibleSection>

        {/* ===== PAYMENT RECORD (collapsible) ===== */}
        {(task.escrowTxHash || task.attestationTxHash || task.onChainId !== null) && (
          <CollapsibleSection
            title="Payment Record"
            badge={
              isPointsReward(task) ? (
                <span className="text-xs text-gray-400">{rewardAmountLabel(task)}</span>
              ) : isRealMoney(task) && task.status === "completed" ? (
                <span className="text-xs font-bold text-success-700">Paid</span>
              ) : (
                <span className="text-xs text-gray-400">${task.bountyUsdc}</span>
              )
            }
          >
            <div className="p-4 flex flex-col gap-2">
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Amount</p>
                <p className="text-sm text-success-600 font-bold">{rewardAmountLabel(task)}</p>
              </div>

              {task.escrowTxHash && (
                <OnChainLink
                  label="Payment Transaction"
                  value={`${task.escrowTxHash.slice(0, 10)}...${task.escrowTxHash.slice(-8)}`}
                  href={`${WORLDSCAN_TX}/${task.escrowTxHash}`}
                  mono
                />
              )}

              <OnChainLink
                label="Payment Contract"
                value={`${ESCROW_ADDRESS.slice(0, 10)}...${ESCROW_ADDRESS.slice(-8)}`}
                href={`${WORLDSCAN_ADDR}/${ESCROW_ADDRESS}`}
                mono
              />

              {task.attestationTxHash && (
                <OnChainLink
                  label="Attestation TX"
                  value={`${task.attestationTxHash.slice(0, 10)}...${task.attestationTxHash.slice(-8)}`}
                  href={`${WORLDSCAN_TX}/${task.attestationTxHash}`}
                  mono
                />
              )}

              {task.onChainId !== null && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">On-Chain Task ID</p>
                  <p className="text-xs text-gray-500 font-mono">#{task.onChainId}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Bottom spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
