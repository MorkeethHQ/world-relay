"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  TopBar as WorldTopBar,
  Typography as WorldTypography,
  Spinner as WorldSpinner,
  Progress as WorldProgress,
} from "@worldcoin/mini-apps-ui-kit-react";

interface LiveEvent {
  id: string;
  type: string;
  taskId: string;
  description: string;
  location: string;
  bountyUsdc: number;
  status: string;
  agentName?: string;
  verdict?: string;
  confidence?: number;
  timestamp: string;
}

interface Stats {
  total: number;
  active: number;
  verified: number;
  totalUsdc: number;
}

interface XmtpStatus {
  connected: boolean;
  inboxId: string;
  address: string;
  lastSync: string | null;
  conversationCount: number;
}

interface DmMessage {
  sender: string;
  text: string;
  timestamp: string;
}

interface DmConversation {
  conversationId: string;
  messages: DmMessage[];
  lastActivity: string;
}

interface DmHistory {
  conversations: DmConversation[];
  totalDmCount: number;
}

const EVENT_ICONS: Record<string, string> = {
  "task:created": "\u{1F195}",
  "task:claimed": "\u{1F91D}",
  "task:proof": "\u{1F4F8}",
  "task:verified": "✅",
  "task:completed": "\u{1F4B0}",
  "task:failed": "❌",
};

function getVerifiedIcon(verdict?: string): string {
  if (verdict === "pass") return "✅";
  if (verdict === "flag") return "⚠️";
  if (verdict === "fail") return "❌";
  return "✅";
}

const EVENT_LABELS: Record<string, string> = {
  "task:created": "NEW TASK",
  "task:claimed": "CLAIMED",
  "task:proof": "PROOF SUBMITTED",
  "task:verified": "VERIFIED",
  "task:completed": "COMPLETED",
  "task:failed": "FAILED",
};

const EVENT_COLORS: Record<string, string> = {
  "task:created": "border-blue-500/20 bg-blue-500/[0.04]",
  "task:claimed": "border-yellow-500/20 bg-yellow-500/[0.04]",
  "task:proof": "border-purple-500/20 bg-purple-500/[0.04]",
  "task:verified": "border-green-500/20 bg-green-500/[0.04]",
  "task:completed": "border-emerald-500/20 bg-emerald-500/[0.04]",
  "task:failed": "border-red-500/20 bg-red-500/[0.04]",
};

const LABEL_COLORS: Record<string, string> = {
  "task:created": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "task:claimed": "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  "task:proof": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "task:verified": "text-green-400 bg-green-500/10 border-green-500/20",
  "task:completed": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "task:failed": "text-red-400 bg-red-500/10 border-red-500/20",
};

const ACCENT_COLORS: Record<string, string> = {
  "task:created": "#3b82f6",
  "task:claimed": "#eab308",
  "task:proof": "#a855f7",
  "task:verified": "#22c55e",
  "task:completed": "#10b981",
  "task:failed": "#ef4444",
};

function relativeTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function VerdictBadge({ verdict, confidence }: { verdict: string; confidence?: number }) {
  const colors: Record<string, string> = {
    pass: "text-green-400 bg-green-500/10 border-green-500/30",
    flag: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    fail: "text-red-400 bg-red-500/10 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${colors[verdict] || colors.flag}`}>
      {verdict === "pass" ? "✅" : verdict === "fail" ? "❌" : "⚠️"}{" "}
      {verdict}
      {confidence !== undefined && (
        <span className="text-white/40 font-mono">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

const MAX_EVENTS = 50;

const BOT_XMTP_ADDRESS = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";

export default function LivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, verified: 0, totalUsdc: 0 });
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [xmtpStatus, setXmtpStatus] = useState<XmtpStatus | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [dmHistory, setDmHistory] = useState<DmHistory | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSyncXmtp = useCallback(async () => {
    setSyncState("syncing");
    try {
      const res = await fetch("/api/xmtp-sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      setSyncState("success");
    } catch {
      setSyncState("error");
    }
    setTimeout(() => setSyncState("idle"), 2000);
  }, []);

  // Fetch initial stats
  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        const tasks = data.tasks || [];
        const total = tasks.length;
        const active = tasks.filter((t: { status: string }) => t.status === "claimed").length;
        const verified = tasks.filter((t: { status: string }) => t.status === "completed").length;
        const totalUsdc = tasks.reduce((sum: number, t: { bountyUsdc: number }) => sum + t.bountyUsdc, 0);
        setStats({ total, active, verified, totalUsdc });
      })
      .catch(console.error);
  }, []);

  // Fetch XMTP / World Chat status
  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/xmtp-status")
        .then((r) => r.json())
        .then((data: XmtpStatus) => setXmtpStatus(data))
        .catch(console.error);
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch DM history
  useEffect(() => {
    const fetchDmHistory = () => {
      fetch("/api/xmtp-dm-history")
        .then((r) => r.json())
        .then((data: DmHistory) => setDmHistory(data))
        .catch(console.error);
    };
    fetchDmHistory();
    const interval = setInterval(fetchDmHistory, 20000);
    return () => clearInterval(interval);
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      eventSourceRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    const eventTypes = [
      "task:created",
      "task:claimed",
      "task:proof",
      "task:verified",
      "task:completed",
      "task:failed",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const event: LiveEvent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            ...data,
          };
          setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));

          if (type === "task:created") {
            setStats((s) => ({ ...s, total: s.total + 1, totalUsdc: s.totalUsdc + (data.bountyUsdc || 0) }));
          } else if (type === "task:claimed") {
            setStats((s) => ({ ...s, active: s.active + 1 }));
          } else if (type === "task:verified" || type === "task:completed") {
            setStats((s) => ({
              ...s,
              active: Math.max(0, s.active - 1),
              verified: s.verified + 1,
            }));
          }
        } catch {
          // Ignore malformed events
        }
      });
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  // Update relative timestamps every 5 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-[family-name:var(--font-geist-sans)] max-w-lg mx-auto">
      {/* World TopBar */}
      <div className="sticky top-0 z-50 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <WorldTopBar
          title="RELAY LIVE"
          startAdornment={
            <a href="/" className="text-white/40 hover:text-white/60 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </a>
          }
          endAdornment={
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  connected
                    ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse"
                    : "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]"
                }`}
              />
              <span className={`text-[10px] font-mono uppercase ${connected ? "text-green-400/60" : "text-red-400/60"}`}>
                {connected ? "live" : "..."}
              </span>
            </div>
          }
          className="!bg-transparent !text-white [&_p]:!text-white !px-4"
        />
      </div>

      {/* Stats Bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06]">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/[0.04] via-green-500/[0.04] to-emerald-500/[0.04]" />
          <div className="relative p-3 grid grid-cols-4 gap-1.5">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Active" value={stats.active} color="text-yellow-400" />
            <StatCard label="Verified" value={stats.verified} color="text-green-400" />
            <StatCard label="USDC" value={`$${stats.totalUsdc}`} color="text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Sync + XMTP Status */}
      <div className="px-4 pb-2">
        <div className="flex gap-2">
          <button
            onClick={handleSyncXmtp}
            disabled={syncState === "syncing"}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wide border transition-all min-h-[44px] ${
              syncState === "syncing"
                ? "border-white/10 bg-white/[0.03] text-white/30 cursor-wait"
                : syncState === "success"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : syncState === "error"
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-white/[0.06] bg-white/[0.03] text-white/50 hover:border-white/[0.12] hover:text-white/70 active:scale-[0.98]"
            }`}
          >
            {syncState === "syncing" ? (
              <WorldSpinner className="!text-white/30 !w-3 !h-3" />
            ) : (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {syncState === "syncing"
              ? "Syncing..."
              : syncState === "success"
              ? "Synced"
              : syncState === "error"
              ? "Failed"
              : "Sync World Chat"}
          </button>
        </div>
      </div>

      {/* World Chat Status */}
      {xmtpStatus && (
        <div className="px-4 pb-2">
          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    xmtpStatus.connected
                      ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                      : "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]"
                  }`}
                />
                <WorldTypography variant="label" level={2} as="span" className="!text-white/60 !text-[11px] uppercase tracking-wider">
                  World Chat
                </WorldTypography>
              </div>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                  xmtpStatus.connected
                    ? "text-green-400/70 border-green-500/20 bg-green-500/8"
                    : "text-red-400/70 border-red-500/20 bg-red-500/8"
                }`}
              >
                {xmtpStatus.connected ? "connected" : "disconnected"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[9px] text-white/25 uppercase tracking-wider">Inbox</p>
                <p className="text-[11px] text-white/50 font-mono mt-0.5 truncate">
                  {xmtpStatus.inboxId
                    ? `${xmtpStatus.inboxId.slice(0, 8)}...${xmtpStatus.inboxId.slice(-6)}`
                    : "---"}
                </p>
              </div>
              <div>
                <p className="text-[9px] text-white/25 uppercase tracking-wider">Conversations</p>
                <WorldTypography variant="number" level={5} as="span" className="!text-white/50 !text-[11px] mt-0.5">
                  {xmtpStatus.conversationCount}
                </WorldTypography>
              </div>
              <div>
                <p className="text-[9px] text-white/25 uppercase tracking-wider">Last Sync</p>
                <p className="text-[11px] text-white/50 font-mono mt-0.5">
                  {xmtpStatus.lastSync
                    ? relativeTime(xmtpStatus.lastSync)
                    : "never"}
                </p>
              </div>
            </div>
            {/* Bot DM address */}
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <p className="text-[9px] text-white/25 uppercase tracking-wider mb-1.5">DM the RELAY Bot</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(BOT_XMTP_ADDRESS).then(() => {
                    setAddressCopied(true);
                    setTimeout(() => setAddressCopied(false), 2000);
                  });
                }}
                className="group flex items-center gap-2 w-full text-left active:scale-[0.99] transition-transform"
              >
                <p className="text-[11px] text-white/50 font-mono truncate group-hover:text-white/70 transition-colors">
                  {BOT_XMTP_ADDRESS}
                </p>
                <span className={`shrink-0 text-[9px] font-bold uppercase px-2 py-1 rounded-full border transition-all ${
                  addressCopied
                    ? "text-green-400 border-green-500/30 bg-green-500/10"
                    : "text-white/30 border-white/[0.06] bg-white/[0.03] group-hover:text-white/50 group-hover:border-white/[0.12]"
                }`}>
                  {addressCopied ? "copied" : "copy"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM Activity */}
      {dmHistory && dmHistory.totalDmCount > 0 && (
        <div className="px-4 pb-2">
          <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.5)]" />
                <span className="text-white/60 text-[11px] uppercase tracking-wider font-bold">
                  DM Activity
                </span>
              </div>
              <span className="text-[10px] font-mono text-purple-400/70 px-2 py-0.5 rounded-full border border-purple-500/20 bg-purple-500/8">
                {dmHistory.totalDmCount} answered
              </span>
            </div>

            {/* Recent DM exchanges */}
            <div className="space-y-2.5">
              {dmHistory.conversations.slice(0, 3).flatMap((conv) => {
                // Pair up user messages with bot responses
                const pairs: Array<{ user: DmMessage; bot: DmMessage }> = [];
                for (let i = 0; i < conv.messages.length - 1; i++) {
                  if (
                    conv.messages[i].sender !== "relay-bot" &&
                    conv.messages[i + 1].sender === "relay-bot"
                  ) {
                    pairs.push({
                      user: conv.messages[i],
                      bot: conv.messages[i + 1],
                    });
                  }
                }
                return pairs.slice(-2);
              }).slice(0, 4).map((pair, idx) => (
                <div
                  key={idx}
                  className="border border-white/[0.04] rounded-lg p-2.5 bg-white/[0.01]"
                >
                  {/* User query */}
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="text-[10px] shrink-0 mt-0.5 w-4 h-4 rounded bg-white/[0.06] flex items-center justify-center text-white/30">
                      Q
                    </span>
                    <p className="text-[11px] text-white/60 leading-snug break-all line-clamp-2">
                      {pair.user.text}
                    </p>
                  </div>
                  {/* Bot response */}
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] shrink-0 mt-0.5 w-4 h-4 rounded bg-purple-500/10 flex items-center justify-center text-purple-400/70">
                      A
                    </span>
                    <p className="text-[11px] text-white/40 leading-snug break-all line-clamp-3">
                      {pair.bot.text.split("\n")[0]}
                      {pair.bot.text.includes("\n") && "..."}
                    </p>
                  </div>
                  <p className="text-[9px] text-white/15 font-mono mt-1.5 text-right">
                    {relativeTime(pair.user.timestamp)}
                  </p>
                </div>
              ))}
            </div>

            {dmHistory.conversations.length === 0 && (
              <p className="text-[11px] text-white/20 text-center py-2">
                DM queries have been answered but no history stored yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Event Feed */}
      <main className="px-4 py-3 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <WorldTypography variant="label" level={2} as="span" className="!text-gray-400 !text-[10px] uppercase tracking-wider">
            Event Feed
          </WorldTypography>
          <span className="text-[10px] text-gray-700 font-mono ml-auto">{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">{"\u{1F4E1}"}</span>
            </div>
            <WorldTypography variant="subtitle" level={2} as="p" className="!text-white/30">
              Waiting for events...
            </WorldTypography>
            <WorldTypography variant="body" level={4} as="p" className="!text-white/15 mt-2">
              Events will appear here in real-time as tasks are created, claimed, and verified.
            </WorldTypography>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event, index) => {
              const accentColor = ACCENT_COLORS[event.type] || "#666";
              return (
                <div
                  key={event.id}
                  className={`rounded-xl border p-3 transition-all ${EVENT_COLORS[event.type] || "border-white/10 bg-white/[0.03]"}`}
                  style={{
                    animation: index === 0 ? "slideDown 0.3s ease-out" : undefined,
                    borderLeftWidth: "3px",
                    borderLeftColor: `${accentColor}40`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="text-lg flex-shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-white/[0.03] flex items-center justify-center">
                      {event.type === "task:verified" ? getVerifiedIcon(event.verdict) : EVENT_ICONS[event.type]}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${LABEL_COLORS[event.type] || "text-white/60 border-white/10"}`}>
                          {EVENT_LABELS[event.type]}
                        </span>
                        {event.verdict && (
                          <VerdictBadge verdict={event.verdict} confidence={event.confidence} />
                        )}
                        {event.agentName && (
                          <span className="text-[10px] text-purple-400/70 font-mono flex items-center gap-1">
                            {"\u{1F916}"} {event.agentName}
                          </span>
                        )}
                      </div>

                      <WorldTypography variant="body" level={3} as="p" className="!text-white/80 truncate">
                        {event.description}
                      </WorldTypography>

                      {/* Confidence bar for verified events */}
                      {event.confidence !== undefined && event.confidence > 0 && (
                        <div className="mt-1.5">
                          <WorldProgress
                            value={Math.round(event.confidence * 100)}
                            className={`!bg-white/[0.04] !h-1 ${
                              event.verdict === "pass" ? "!text-green-400" :
                              event.verdict === "flag" ? "!text-yellow-400" : "!text-red-400"
                            }`}
                          />
                        </div>
                      )}

                      <div className="flex items-center gap-2 sm:gap-3 mt-1.5 text-[10px] sm:text-[11px] text-white/30 flex-wrap">
                        <span className="flex items-center gap-1 truncate max-w-[45%]">
                          {"\u{1F4CD}"} {event.location}
                        </span>
                        <span className="font-mono text-emerald-400/60 shrink-0">
                          ${event.bountyUsdc}
                        </span>
                        <span className="ml-auto font-mono shrink-0">
                          {relativeTime(event.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Animation styles */}
      <style jsx global>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="text-center min-w-0 py-1">
      <WorldTypography variant="number" level={5} as="span" className={`!font-bold ${color || "!text-white"}`}>
        {value}
      </WorldTypography>
      <p className="text-[9px] text-white/30 uppercase tracking-wider mt-0.5 truncate">{label}</p>
    </div>
  );
}
