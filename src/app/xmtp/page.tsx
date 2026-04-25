"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

/* ── Types ─────────────────────────────────────────────── */

type XmtpStatus = {
  connected: boolean;
  inboxId: string | null;
  address: string | null;
  error: string | null;
  lastSync: string | null;
  conversationCount: number;
};

type DmMessage = {
  sender: string;
  text: string;
  timestamp: string;
};

type DmConversation = {
  conversationId: string;
  messages: DmMessage[];
  lastActivity: string;
};

type DmData = {
  conversations: DmConversation[];
  totalDmCount: number;
};

/* ── Constants ─────────────────────────────────────────── */

const BOT_ADDRESS = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";

const INTEGRATION_POINTS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Per-Task Groups",
    desc: "Every claimed task creates an encrypted XMTP group. The full lifecycle plays out in the thread.",
    color: "#818cf8",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
        <path d="M20 2a10 10 0 0 1 0 14.14" />
      </svg>
    ),
    title: "Claim Briefing",
    desc: "On claim, the system posts task-specific tips in the thread.",
    color: "#60a5fa",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    title: "Multi-Turn Verification",
    desc: "Medium-confidence proofs trigger follow-up questions. Claimant responds in-thread and the proof is re-evaluated.",
    color: "#a78bfa",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Dispute Resolution",
    desc: "Poster triggers mediation. The system reads the full thread and renders a binding verdict.",
    color: "#c084fc",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "DM Bot",
    desc: 'Message the RELAY inbox directly. Ask about tasks, filter by bounty, check stats. Bot responds with deep links.',
    color: "#6366f1",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    title: "Settlement Notifications",
    desc: "USDC released -> confirmation posted to the thread with amount and World Chain tx link.",
    color: "#8b5cf6",
  },
];

/* ── Example Thread Messages ───────────────────────────── */

const THREAD_MESSAGES: { sender: "bot" | "claimant" | "poster"; label: string; text: string; step: string }[] = [
  {
    sender: "bot",
    label: "RELAY Bot",
    step: "1. Task Posted",
    text: `📋 TASK CLAIMED
━━━━━━━━━━━━━━━━━━
"How long is the queue at the Louvre Pyramid?"
📍 Musee du Louvre, Paris 1er
💰 $0.25 USDC bounty
👤 Claimed by 0x7a3b...demo`,
  },
  {
    sender: "bot",
    label: "RELAY Bot",
    step: "2. Briefing",
    text: `📝 BRIEFING
━━━━━━━━━━━━━━━━━━
Stand at the back of the queue facing the Pyramid. Include the full length of the line in frame. A wide-angle shot works best — try to capture the barriers and the Pyramid in the same photo.

Submit your proof photo when ready. Good luck!`,
  },
  {
    sender: "claimant",
    label: "0x7a3b...demo",
    step: "3. Proof Submitted",
    text: "Here's the queue photo. About 35 people, roughly 20 min wait.",
  },
  {
    sender: "bot",
    label: "RELAY Bot",
    step: "4. Verified",
    text: `✅ VERIFIED — APPROVED
━━━━━━━━━━━━━━━━━━
Reasoning: Photo clearly shows the Louvre Pyramid entrance queue from behind. Approximately 35-40 people visible.
Confidence: 94%`,
  },
  {
    sender: "bot",
    label: "RELAY Bot",
    step: "5. Follow-up (if needed)",
    text: `🔍 FOLLOW-UP
━━━━━━━━━━━━━━━━━━
Confidence: 72% — not enough to auto-verify.

Can you confirm the photo was taken today? The lighting seems inconsistent with current weather.

Reply in this thread, then tap "Re-evaluate" for a new verdict.`,
  },
  {
    sender: "claimant",
    label: "0x7a3b...demo",
    step: "6. Claimant Response",
    text: "Yes, taken 10 minutes ago. It's overcast today which makes it look darker.",
  },
  {
    sender: "bot",
    label: "RELAY Bot",
    step: "7. Settlement",
    text: `🔗 ON-CHAIN SETTLEMENT CONFIRMED
━━━━━━━━━━━━━━━━━━
$0.25 USDC released on World Chain
Tx: 0xdbd446...5f6b406

Task complete. Both parties verified human via World ID.
Proof verified. Settlement on-chain. Chat via XMTP.`,
  },
];

/* ── Helpers ───────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="ml-2 shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
      title="Copy"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── Page Component ────────────────────────────────────── */

export default function XmtpPage() {
  const [status, setStatus] = useState<XmtpStatus | null>(null);
  const [dmData, setDmData] = useState<DmData | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [dmLoading, setDmLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Fetch XMTP status
  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/xmtp-status")
        .then((r) => r.json())
        .then((d) => {
          setStatus(d);
          setStatusLoading(false);
        })
        .catch(() => setStatusLoading(false));
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch DM history
  useEffect(() => {
    fetch("/api/xmtp-dm-history")
      .then((r) => r.json())
      .then((d) => {
        setDmData(d);
        setDmLoading(false);
      })
      .catch(() => setDmLoading(false));
  }, []);

  // Live clock for "last sync" ticker
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const lastSyncAgo = status?.lastSync
    ? `${Math.max(0, Math.round((now - new Date(status.lastSync).getTime()) / 1000))}s ago`
    : "--";

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-[#050505]">
      {/* ── Sticky Header ──────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Feed
          </Link>
          <span className="text-[10px] text-gray-600 uppercase tracking-wider font-medium">
            World Chat Integration
          </span>
        </div>
      </div>

      <div className="flex-1 px-4 py-6 flex flex-col gap-8">
        {/* ════════════════════════════════════════════════
            1. HERO SECTION
        ════════════════════════════════════════════════ */}
        <div className="text-center">
          {/* XMTP brand icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="url(#xmtp-grad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="xmtp-grad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
              </defs>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold tracking-tight mb-2 bg-gradient-to-r from-indigo-400 via-purple-400 to-violet-400 bg-clip-text text-transparent">
            Task Chat
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed max-w-sm mx-auto">
            Every task has its own{" "}
            <span className="text-white font-medium">private encrypted chat</span>.{" "}
            Claim a task, get a briefing, submit proof, get your verdict — all in one thread.
          </p>
        </div>

        {/* ════════════════════════════════════════════════
            2. LIVE STATUS CARD
        ════════════════════════════════════════════════ */}
        <div className="bg-[#0a0a0a] border border-indigo-500/15 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2">
              {statusLoading ? (
                <span className="w-2 h-2 rounded-full bg-gray-600 animate-pulse" />
              ) : status?.connected ? (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-[pulse-dot_2s_ease-in-out_infinite]" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-red-500" />
              )}
              <span className="text-xs font-semibold text-white">
                {statusLoading
                  ? "Connecting..."
                  : status?.connected
                  ? "Connected to XMTP Production Network"
                  : "Disconnected"}
              </span>
            </div>
            <span className="text-[9px] text-gray-600 font-mono">live</span>
          </div>

          <div className="px-4 py-3 flex flex-col gap-2.5">
            {/* Inbox ID */}
            <div>
              <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium mb-1">Inbox ID</p>
              <div className="flex items-center">
                <p className="text-[11px] text-gray-300 font-mono truncate flex-1">
                  {statusLoading ? "..." : status?.inboxId || "unavailable"}
                </p>
                {status?.inboxId && <CopyButton text={status.inboxId} />}
              </div>
            </div>

            {/* Bot Address */}
            <div>
              <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium mb-1">Bot Address</p>
              <div className="flex items-center">
                <p className="text-[11px] text-indigo-400 font-mono truncate flex-1">{BOT_ADDRESS}</p>
                <CopyButton text={BOT_ADDRESS} />
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
              <div className="flex-1 text-center">
                <p className="text-lg font-bold text-white">
                  {statusLoading ? "--" : status?.conversationCount ?? 0}
                </p>
                <p className="text-[8px] text-gray-500">Conversations</p>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div className="flex-1 text-center">
                <p className="text-lg font-bold text-indigo-400">{lastSyncAgo}</p>
                <p className="text-[8px] text-gray-500">Last Sync</p>
              </div>
              <div className="w-px h-8 bg-white/[0.06]" />
              <div className="flex-1 text-center">
                <p className="text-lg font-bold text-purple-400">prod</p>
                <p className="text-[8px] text-gray-500">Network</p>
              </div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            3. 6 INTEGRATION POINTS
        ════════════════════════════════════════════════ */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-3">
            6 Integration Points
          </p>
          <div className="flex flex-col gap-3">
            {INTEGRATION_POINTS.map((point, i) => (
              <div
                key={i}
                className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4 hover:border-indigo-500/20 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${point.color}12` }}
                  >
                    {point.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{point.title}</span>
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ color: point.color, backgroundColor: `${point.color}15` }}
                      >
                        {i + 1}/6
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{point.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            4. DM ACTIVITY
        ════════════════════════════════════════════════ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">
              DM Activity
            </p>
            {dmData && dmData.totalDmCount > 0 && (
              <span className="text-[10px] text-indigo-400 font-medium bg-indigo-500/10 px-2 py-0.5 rounded-full">
                {dmData.totalDmCount} DMs answered
              </span>
            )}
          </div>

          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden">
            {dmLoading ? (
              <div className="px-4 py-8 text-center">
                <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-2" />
                <p className="text-[11px] text-gray-500">Loading DM history...</p>
              </div>
            ) : dmData && dmData.conversations.length > 0 ? (
              <div className="flex flex-col divide-y divide-white/[0.04]">
                {dmData.conversations.slice(0, 5).map((conv) => (
                  <div key={conv.conversationId} className="px-4 py-3">
                    {conv.messages.slice(-4).map((msg, mi) => (
                      <div key={mi} className={`flex gap-2 ${mi > 0 ? "mt-2" : ""}`}>
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                            msg.sender === "relay-bot"
                              ? "bg-indigo-500/15"
                              : "bg-white/5"
                          }`}
                        >
                          {msg.sender === "relay-bot" ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-[10px] leading-relaxed ${
                              msg.sender === "relay-bot" ? "text-gray-300" : "text-gray-500"
                            }`}
                          >
                            {msg.text.length > 200
                              ? msg.text.slice(0, 200) + "..."
                              : msg.text}
                          </p>
                          <p className="text-[8px] text-gray-700 mt-0.5">
                            {timeAgo(msg.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              /* No DMs yet — show example queries */
              <div className="px-4 py-5">
                <p className="text-[11px] text-gray-500 text-center mb-3">
                  No DMs yet. Try messaging the bot on World Chat:
                </p>
                <div className="flex flex-col gap-2">
                  {[
                    { query: "nearby tasks", desc: "Browse tasks near your location" },
                    { query: "high bounty", desc: "Filter by highest USDC payout" },
                    { query: "who built relay", desc: "Learn about the team" },
                    { query: "network stats", desc: "Live metrics and activity" },
                  ].map((ex) => (
                    <div
                      key={ex.query}
                      className="flex items-center gap-3 bg-white/[0.02] border border-white/[0.04] rounded-xl px-3 py-2.5"
                    >
                      <span className="text-[11px] text-indigo-400 font-mono font-medium">
                        &quot;{ex.query}&quot;
                      </span>
                      <span className="text-[9px] text-gray-600 ml-auto">{ex.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            5. EXAMPLE THREAD — Full XMTP Lifecycle
        ════════════════════════════════════════════════ */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-1">
            Full Task Lifecycle
          </p>
          <p className="text-[10px] text-gray-600 mb-3">
            QueueWatch Louvre task — 7 messages, one thread
          </p>

          <div className="bg-[#0a0a0a] border border-indigo-500/10 rounded-2xl overflow-hidden">
            {/* Thread header */}
            <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-white">RELAY: Louvre Pyramid queue...</p>
                <p className="text-[8px] text-gray-600">Task t_louvre01 -- $0.25 USDC at Musee du Louvre</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-[8px] text-green-400">Encrypted</span>
              </div>
            </div>

            {/* Messages */}
            <div className="px-3 py-3 flex flex-col gap-3">
              {THREAD_MESSAGES.map((msg, i) => {
                const isBot = msg.sender === "bot";
                const isPoster = msg.sender === "poster";
                return (
                  <div key={i}>
                    {/* Step label */}
                    <p className="text-[8px] text-gray-700 uppercase tracking-wider font-medium mb-1.5 px-1">
                      {msg.step}
                    </p>
                    <div
                      className={`rounded-xl px-3 py-2.5 ${
                        isBot
                          ? "bg-gradient-to-br from-indigo-500/8 to-purple-500/8 border border-indigo-500/10 ml-0 mr-6"
                          : isPoster
                          ? "bg-yellow-500/5 border border-yellow-500/10 ml-6 mr-0"
                          : "bg-white/[0.03] border border-white/[0.06] ml-6 mr-0"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {isBot ? (
                          <div className="w-4 h-4 rounded-full bg-indigo-500/20 flex items-center justify-center">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="7" r="4" />
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            </svg>
                          </div>
                        )}
                        <span
                          className={`text-[9px] font-bold ${
                            isBot ? "text-indigo-400" : "text-gray-500"
                          }`}
                        >
                          {msg.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-300 leading-relaxed whitespace-pre-line">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Thread footer */}
            <div className="px-4 py-2.5 border-t border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-gray-600">7 messages</span>
                <span className="text-gray-800">|</span>
                <span className="text-[8px] text-green-400">$0.25 USDC settled</span>
              </div>
              <span className="text-[8px] text-gray-700">End-to-end encrypted via XMTP</span>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            6. UNDER THE HOOD (judge-friendly, not dev-focused)
        ════════════════════════════════════════════════ */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-3">
            Under the Hood
          </p>

          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="flex flex-col divide-y divide-white/[0.04]">
              <div className="px-4 py-3 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-white font-medium">Production XMTP network</p>
                  <p className="text-[10px] text-gray-500">Real encrypted messaging, not a testnet or mock</p>
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-white font-medium">One chat per task</p>
                  <p className="text-[10px] text-gray-500">Each claimed task creates its own encrypted group automatically</p>
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-white font-medium">Standalone DM bot</p>
                  <p className="text-[10px] text-gray-500">Message the bot directly from any XMTP client — no web app needed</p>
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-white font-medium">Full lifecycle in-thread</p>
                  <p className="text-[10px] text-gray-500">Claim, briefing, proof, verdict, follow-up, settlement — all in one conversation</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════
            7. "TRY IT" CTA
        ════════════════════════════════════════════════ */}
        <div className="bg-gradient-to-b from-indigo-500/[0.06] to-purple-500/[0.03] border border-indigo-500/15 rounded-2xl p-5 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#cta-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="cta-grad" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
              </defs>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>

          <p className="text-lg font-bold text-white mb-1">Try the Chat Bot</p>
          <p className="text-[11px] text-gray-500 leading-relaxed mb-4 max-w-xs mx-auto">
            Open any XMTP-compatible app and message this address. The bot responds in seconds with available tasks.
          </p>

          <div className="bg-black/30 border border-white/[0.06] rounded-xl px-4 py-3 flex items-center gap-2 mb-4">
            <p className="text-[11px] text-indigo-400 font-mono truncate flex-1">{BOT_ADDRESS}</p>
            <CopyButton text={BOT_ADDRESS} />
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {["nearby tasks", "high bounty", "stats", "help"].map((q) => (
              <span
                key={q}
                className="text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/15 px-2.5 py-1 rounded-full"
              >
                &quot;{q}&quot;
              </span>
            ))}
          </div>
        </div>

        {/* ── Tech stack badges ────────────────────────── */}
        <div className="flex items-center justify-center gap-3 py-2 flex-wrap">
          {[
            { label: "XMTP", color: "#818cf8" },
            { label: "World Chat", color: "#60a5fa" },
            { label: "World ID", color: "#4ade80" },
            { label: "World Chain", color: "#a78bfa" },
            { label: "Verification", color: "#fbbf24" },
          ].map((tech, i) => (
            <span key={tech.label} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-800 mr-1.5">·</span>}
              <span className="w-1 h-1 rounded-full" style={{ backgroundColor: tech.color }} />
              <span className="text-[10px] text-gray-600">{tech.label}</span>
            </span>
          ))}
        </div>

        {/* Bottom spacer */}
        <div className="h-4" />
      </div>
    </div>
  );
}
