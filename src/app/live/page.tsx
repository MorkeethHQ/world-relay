"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  "task:created": "border-blue-500/30 bg-blue-500/5",
  "task:claimed": "border-yellow-500/30 bg-yellow-500/5",
  "task:proof": "border-purple-500/30 bg-purple-500/5",
  "task:verified": "border-green-500/30 bg-green-500/5",
  "task:completed": "border-emerald-500/30 bg-emerald-500/5",
  "task:failed": "border-red-500/30 bg-red-500/5",
};

const LABEL_COLORS: Record<string, string> = {
  "task:created": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "task:claimed": "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  "task:proof": "text-purple-400 bg-purple-500/10 border-purple-500/20",
  "task:verified": "text-green-400 bg-green-500/10 border-green-500/20",
  "task:completed": "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "task:failed": "text-red-400 bg-red-500/10 border-red-500/20",
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
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${colors[verdict] || colors.flag}`}>
      {verdict === "pass" ? "✅" : verdict === "fail" ? "❌" : "⚠️"}{" "}
      {verdict}
      {confidence !== undefined && (
        <span className="text-white/40 font-mono">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

const MAX_EVENTS = 50;

export default function LivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, verified: 0, totalUsdc: 0 });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Auto-reconnect after 3 seconds
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

          // Update stats on relevant events
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
    <div className="min-h-screen bg-[#050505] text-white font-[family-name:var(--font-geist-sans)]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-white/40 hover:text-white/60 transition-colors text-sm">&larr;</a>
            <h1 className="text-lg font-bold tracking-tight">RELAY LIVE</h1>
            <div className="flex items-center gap-1.5 ml-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  connected
                    ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-pulse"
                    : "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]"
                }`}
              />
              <span className={`text-[10px] font-mono uppercase ${connected ? "text-green-400/60" : "text-red-400/60"}`}>
                {connected ? "live" : "reconnecting"}
              </span>
            </div>
          </div>
          <a
            href="/"
            className="text-xs text-white/30 hover:text-white/50 transition-colors"
          >
            relay.world
          </a>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-white/5 bg-white/[0.02]">
        <div className="max-w-3xl mx-auto px-4 py-3 grid grid-cols-4 gap-3">
          <StatCard label="Total Tasks" value={stats.total} />
          <StatCard label="Active" value={stats.active} color="text-yellow-400" />
          <StatCard label="Verified" value={stats.verified} color="text-green-400" />
          <StatCard label="USDC Pool" value={`$${stats.totalUsdc}`} color="text-emerald-400" />
        </div>
      </div>

      {/* Event Feed */}
      <main className="max-w-3xl mx-auto px-4 py-4">
        {events.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">{"\u{1F4E1}"}</div>
            <p className="text-white/30 text-sm">Waiting for events...</p>
            <p className="text-white/15 text-xs mt-2">Events will appear here in real-time as tasks are created, claimed, and verified.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event, index) => (
              <div
                key={event.id}
                className={`rounded-xl border p-3 transition-all ${EVENT_COLORS[event.type] || "border-white/10 bg-white/5"}`}
                style={{
                  animation: index === 0 ? "slideDown 0.3s ease-out" : undefined,
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="text-xl flex-shrink-0 mt-0.5">
                    {event.type === "task:verified" ? getVerifiedIcon(event.verdict) : EVENT_ICONS[event.type]}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${LABEL_COLORS[event.type] || "text-white/60 border-white/10"}`}>
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

                    <p className="text-sm text-white/80 truncate">{event.description}</p>

                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-white/30">
                      <span className="flex items-center gap-1">
                        {"\u{1F4CD}"} {event.location}
                      </span>
                      <span className="font-mono text-emerald-400/60">
                        ${event.bountyUsdc}
                      </span>
                      <span className="ml-auto font-mono">
                        {relativeTime(event.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
    <div className="text-center">
      <div className={`text-lg font-bold font-mono ${color || "text-white"}`}>{value}</div>
      <div className="text-[10px] text-white/30 uppercase tracking-wider">{label}</div>
    </div>
  );
}
