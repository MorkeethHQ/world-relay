"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { AGENT_REGISTRY, SEED_TASKS } from "@/lib/agents";
import type { Task, TaskCategory } from "@/lib/types";

/* ── Agent option builder ─────────────────────────────────── */

type AgentOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultDescription: string;
  defaultLocation: string;
  defaultBounty: number;
  defaultCategory: TaskCategory;
};

function buildAgentOptions(): AgentOption[] {
  return Object.values(AGENT_REGISTRY).map((agent) => {
    const seed = SEED_TASKS.find((s) => s.agentId === agent.id);
    return {
      ...agent,
      defaultDescription: seed?.description || "",
      defaultLocation: seed?.location || "Paris",
      defaultBounty: seed?.bountyUsdc || 2.5,
      defaultCategory: seed?.category || "photo",
    };
  });
}

const AGENTS = buildAgentOptions();
const CATEGORIES: { value: TaskCategory; label: string; icon: string }[] = [
  { value: "photo", label: "Photo", icon: "📸" },
  { value: "check-in", label: "Check-in", icon: "📍" },
  { value: "delivery", label: "Delivery", icon: "📦" },
  { value: "custom", label: "Custom", icon: "🔧" },
];

/* ── Helpers ────────────────────────────────────────────────── */

function statusColor(status: string): string {
  switch (status) {
    case "open":
      return "#3b82f6";
    case "claimed":
      return "#f59e0b";
    case "completed":
      return "#22c55e";
    case "failed":
    case "expired":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

function timeStr(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Syntax-highlighted JSON ────────────────────────────────── */

function JsonHighlight({ data }: { data: unknown }) {
  const raw = JSON.stringify(data, null, 2);
  const lines = raw.split("\n");

  return (
    <pre className="font-mono text-[10px] sm:text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
      {lines.map((line, i) => (
        <div key={i}>
          {line.split(/("(?:[^"\\]|\\.)*")\s*(:?)/g).map((part, j) => {
            if (j % 3 === 1) {
              // It is a quoted string
              const isKey = line.indexOf(part) < line.indexOf(":");
              return (
                <span
                  key={j}
                  className={isKey ? "text-blue-400" : "text-yellow-300"}
                >
                  {part}
                </span>
              );
            }
            // Numbers, booleans, null
            const numPart = part.replace(
              /\b(true|false|null|\d+\.?\d*)\b/g,
              '<NUM>$1</NUM>'
            );
            if (numPart.includes("<NUM>")) {
              return (
                <span key={j}>
                  {part.split(/\b(true|false|null|\d+\.?\d*)\b/).map((seg, k) =>
                    k % 2 === 1 ? (
                      <span key={k} className="text-purple-400">
                        {seg}
                      </span>
                    ) : (
                      <span key={k} className="text-gray-500">
                        {seg}
                      </span>
                    )
                  )}
                </span>
              );
            }
            return (
              <span key={j} className="text-gray-500">
                {part}
              </span>
            );
          })}
        </div>
      ))}
    </pre>
  );
}

/* ── Confetti burst (pure CSS, no deps) ─────────────────────── */

function ConfettiBurst() {
  const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];
  return (
    <div className="fixed inset-0 pointer-events-none z-50" aria-hidden>
      {Array.from({ length: 40 }).map((_, i) => {
        const color = colors[i % colors.length];
        const left = Math.random() * 100;
        const delay = Math.random() * 0.4;
        const size = 4 + Math.random() * 6;
        const drift = (Math.random() - 0.5) * 200;
        return (
          <span
            key={i}
            className="absolute rounded-sm"
            style={{
              left: `${left}%`,
              top: "-10px",
              width: size,
              height: size,
              backgroundColor: color,
              animation: `confettiFall 1.4s ${delay}s ease-out forwards`,
              transform: `translateX(${drift}px) rotate(${Math.random() * 360}deg)`,
              opacity: 0,
            }}
          />
        );
      })}
      <style>{`
        @keyframes confettiFall {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          100% { opacity: 0; transform: translateY(100vh) rotate(720deg); }
        }
      `}</style>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */

type StatusEntry = {
  time: string;
  label: string;
  color: string;
};

type RecentTask = {
  id: string;
  description: string;
  location: string;
  bountyUsdc: number;
  status: string;
  createdAt: string;
};

export default function PlaygroundPage() {
  // Form state
  const [selectedAgent, setSelectedAgent] = useState<AgentOption>(AGENTS[0]);
  const [description, setDescription] = useState(AGENTS[0].defaultDescription);
  const [location, setLocation] = useState(AGENTS[0].defaultLocation);
  const [bounty, setBounty] = useState(AGENTS[0].defaultBounty);
  const [category, setCategory] = useState<TaskCategory>(AGENTS[0].defaultCategory);
  const [deadlineHours, setDeadlineHours] = useState("24");

  // Post state
  const [posting, setPosting] = useState(false);
  const [requestBody, setRequestBody] = useState<Record<string, unknown> | null>(null);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Live status feed
  const [feed, setFeed] = useState<StatusEntry[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recent activity
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // Tab state for request/response viewer
  const [viewerTab, setViewerTab] = useState<"request" | "response">("response");

  // Curl command section open/closed
  const [curlOpen, setCurlOpen] = useState(true);

  /* ── Build payload (for curl + actual post) ──────────────── */

  const buildPayload = useCallback((): Record<string, unknown> => {
    return {
      agent_id: selectedAgent.id,
      description,
      location,
      bounty_usdc: bounty,
      category,
      deadline_hours: Number(deadlineHours),
    };
  }, [selectedAgent.id, description, location, bounty, category, deadlineHours]);

  /* ── Build curl command ──────────────────────────────────── */

  const curlCommand = (() => {
    const payload = buildPayload();
    const json = JSON.stringify(payload, null, 2);
    return `curl -X POST https://world-relay.vercel.app/api/agent/tasks \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  })();

  /* ── Fetch recent tasks ──────────────────────────────────── */

  const fetchRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await fetch("/api/agent/tasks");
      if (res.ok) {
        const data = await res.json();
        setRecentTasks((data.tasks || []).slice(0, 5));
      }
    } catch {
      // silent
    }
    setRecentLoading(false);
  }, []);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  /* ── Agent selection ─────────────────────────────────────── */

  function selectAgent(agent: AgentOption) {
    setSelectedAgent(agent);
    setDescription(agent.defaultDescription);
    setLocation(agent.defaultLocation);
    setBounty(agent.defaultBounty);
    setCategory(agent.defaultCategory);
    setResponse(null);
    setRequestBody(null);
    setError(null);
    setTaskId(null);
    setFeed([]);
    setCurrentTask(null);
    setShowConfetti(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  /* ── Poll task status ────────────────────────────────────── */

  useEffect(() => {
    if (!taskId) return;

    let lastStatus = "";

    const poll = () => {
      fetch("/api/tasks")
        .then((r) => r.json())
        .then((data) => {
          const task = (data.tasks as Task[])?.find((t) => t.id === taskId);
          if (!task) return;
          setCurrentTask(task);

          if (task.status !== lastStatus) {
            lastStatus = task.status;
            setFeed((prev) => [
              ...prev,
              {
                time: timeStr(),
                label:
                  task.status === "completed"
                    ? `Verified (${Math.round((task.verificationResult?.confidence || 0) * 100)}% confidence)`
                    : task.status === "claimed"
                      ? `Claimed by ${task.claimant?.slice(0, 10) || "human"}...`
                      : task.status.charAt(0).toUpperCase() + task.status.slice(1),
                color: statusColor(task.status),
              },
            ]);

            if (
              task.status === "completed" ||
              task.status === "failed" ||
              task.status === "expired"
            ) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
            }
          }
        })
        .catch(() => {});
    };

    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [taskId]);

  /* ── Post task ───────────────────────────────────────────── */

  async function handlePost() {
    setPosting(true);
    setError(null);
    setResponse(null);
    setRequestBody(null);
    setTaskId(null);
    setFeed([]);
    setCurrentTask(null);
    setShowConfetti(false);

    const body = buildPayload();
    setRequestBody(body);

    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        setResponse(data);
        setViewerTab("response");
        setPosting(false);
        return;
      }

      setResponse(data);
      setViewerTab("response");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 2000);

      const id = data.task?.id;
      if (id) {
        setTaskId(id);
        setFeed([
          {
            time: timeStr(),
            label: "Task posted — awaiting human claim",
            color: "#3b82f6",
          },
        ]);
      }

      // Refresh recent
      fetchRecent();
    } catch {
      setError("Network error — is the dev server running?");
    }
    setPosting(false);
  }

  /* ── Copy to clipboard helper ────────────────────────────── */

  const [copied, setCopied] = useState(false);
  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {showConfetti && <ConfettiBurst />}

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-lg mx-auto flex items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
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
            Feed
          </Link>
          <h1 className="text-sm font-bold tracking-tight font-mono">
            Agent API Playground
          </h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-3 sm:px-4 py-4 flex flex-col gap-4">
        {/* ── Agent Picker ──────────────────────────────────── */}
        <section>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium font-mono mb-2">
            &gt; select agent
          </p>
          <div className="grid grid-cols-2 gap-2">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => selectAgent(agent)}
                className="text-left rounded-xl p-2.5 sm:p-3 border transition-all min-h-[48px]"
                style={{
                  backgroundColor:
                    selectedAgent.id === agent.id ? `${agent.color}12` : "#111",
                  borderColor:
                    selectedAgent.id === agent.id
                      ? `${agent.color}40`
                      : "rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ backgroundColor: `${agent.color}15` }}
                  >
                    {agent.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-semibold truncate"
                      style={{
                        color:
                          selectedAgent.id === agent.id ? agent.color : "#fff",
                      }}
                    >
                      {agent.name}
                    </p>
                    <p className="text-[9px] text-gray-600 font-mono truncate">
                      {agent.id}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── Task Form ────────────────────────────────────── */}
        <section className="bg-[#111] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ backgroundColor: `${selectedAgent.color}15` }}
            >
              {selectedAgent.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: selectedAgent.color }}>
                {selectedAgent.name}
              </p>
              <p className="text-[10px] text-gray-600 font-mono">
                agent_id: &quot;{selectedAgent.id}&quot;
              </p>
            </div>
          </div>

          {/* Category picker */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider font-mono block mb-1.5">
              category
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className="rounded-lg py-2 px-1 text-center border transition-all"
                  style={{
                    backgroundColor:
                      category === cat.value
                        ? `${selectedAgent.color}15`
                        : "rgba(0,0,0,0.3)",
                    borderColor:
                      category === cat.value
                        ? `${selectedAgent.color}40`
                        : "rgba(255,255,255,0.04)",
                  }}
                >
                  <span className="text-sm block">{cat.icon}</span>
                  <span
                    className="text-[9px] font-medium font-mono block mt-0.5"
                    style={{
                      color:
                        category === cat.value ? selectedAgent.color : "#6b7280",
                    }}
                  >
                    {cat.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider font-mono block mb-1">
              description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 resize-none font-mono"
              placeholder="Describe the task..."
            />
          </div>

          {/* Location */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider font-mono block mb-1">
              location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 font-mono"
              placeholder="Paris"
            />
          </div>

          {/* Bounty slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-gray-600 uppercase tracking-wider font-mono">
                bounty_usdc
              </label>
              <span
                className="text-sm font-bold font-mono tabular-nums"
                style={{ color: selectedAgent.color }}
              >
                ${bounty.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.25"
              max="10"
              step="0.25"
              value={bounty}
              onChange={(e) => setBounty(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${selectedAgent.color} ${((bounty - 0.25) / 9.75) * 100}%, rgba(255,255,255,0.08) ${((bounty - 0.25) / 9.75) * 100}%)`,
              }}
            />
            <div className="flex justify-between text-[9px] text-gray-700 font-mono mt-0.5">
              <span>$0.25</span>
              <span>$10.00</span>
            </div>
          </div>

          {/* Deadline */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider font-mono block mb-1">
              deadline_hours
            </label>
            <input
              type="number"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              min="1"
              max="168"
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 font-mono"
            />
          </div>
        </section>

        {/* ── Live Curl Command ─────────────────────────────── */}
        <section className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden">
          <button
            onClick={() => setCurlOpen(!curlOpen)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-[10px] font-mono font-bold">
                POST
              </span>
              <span className="text-[11px] text-gray-400 font-mono">
                /api/agent/tasks
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(curlCommand);
                }}
                className="text-[10px] text-gray-600 hover:text-gray-300 font-mono transition-colors px-2 py-0.5 rounded border border-white/[0.06] hover:border-white/10"
              >
                {copied ? "copied!" : "copy"}
              </button>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6b7280"
                strokeWidth="2"
                className={`transition-transform ${curlOpen ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>
          {curlOpen && (
            <div className="px-4 pb-3">
              <div className="bg-black/60 rounded-xl p-3 font-mono text-[10px] sm:text-[11px] leading-relaxed overflow-x-auto">
                <span className="text-yellow-300">curl</span>{" "}
                <span className="text-gray-400">-X</span>{" "}
                <span className="text-green-400">POST</span>{" "}
                <span className="text-blue-400">
                  https://world-relay.vercel.app/api/agent/tasks
                </span>{" "}
                <span className="text-gray-600">\</span>
                <br />
                {"  "}
                <span className="text-gray-400">-H</span>{" "}
                <span className="text-yellow-300">
                  &quot;Content-Type: application/json&quot;
                </span>{" "}
                <span className="text-gray-600">\</span>
                <br />
                {"  "}
                <span className="text-gray-400">-d</span>{" "}
                <span className="text-gray-500">&apos;</span>
                <JsonHighlight data={buildPayload()} />
                <span className="text-gray-500">&apos;</span>
              </div>
            </div>
          )}
        </section>

        {/* ── Fire Button ──────────────────────────────────── */}
        <button
          onClick={handlePost}
          disabled={posting || !description || !location || bounty < 0.25}
          className="w-full py-3.5 min-h-[48px] rounded-xl text-sm font-bold font-mono active:scale-[0.98] transition-all disabled:opacity-30"
          style={{
            backgroundColor: selectedAgent.color,
            color: "#000",
          }}
        >
          {posting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              posting...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              {selectedAgent.icon} POST task as {selectedAgent.name}
            </span>
          )}
        </button>

        {/* ── Error ────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-red-400 text-[10px] font-mono font-bold">
                ERROR
              </span>
              <span className="text-red-400/60 text-[10px] font-mono">
                {response ? "400 Bad Request" : "Network"}
              </span>
            </div>
            <p className="text-xs text-red-400 font-mono">{error}</p>
          </div>
        )}

        {/* ── Success Banner ───────────────────────────────── */}
        {response && !error && taskId && (
          <div
            className="rounded-xl p-4 border animate-[fadeIn_0.3s_ease-out]"
            style={{
              backgroundColor: `${selectedAgent.color}08`,
              borderColor: `${selectedAgent.color}25`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#22c55e"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span className="text-sm font-bold text-green-400 font-mono">
                201 Created
              </span>
            </div>
            <p className="text-[11px] text-gray-400 font-mono mb-2">
              Task <span className="text-white">{taskId.slice(0, 12)}...</span>{" "}
              posted successfully.
            </p>
            <Link
              href={`/task/${taskId}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium font-mono px-3 py-1.5 rounded-lg transition-colors"
              style={{
                backgroundColor: `${selectedAgent.color}20`,
                color: selectedAgent.color,
              }}
            >
              View in feed
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}

        {/* ── Request / Response Viewer ─────────────────────── */}
        {(requestBody || response) && (
          <section className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl overflow-hidden animate-[fadeIn_0.3s_ease-out]">
            {/* Tabs */}
            <div className="flex border-b border-white/[0.04]">
              <button
                onClick={() => setViewerTab("request")}
                className={`flex-1 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${
                  viewerTab === "request"
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-gray-600 hover:text-gray-400"
                }`}
              >
                Request
              </button>
              <button
                onClick={() => setViewerTab("response")}
                className={`flex-1 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${
                  viewerTab === "response"
                    ? "text-green-400 border-b-2 border-green-400"
                    : "text-gray-600 hover:text-gray-400"
                }`}
              >
                Response
                {response && !error && (
                  <span className="ml-1.5 text-[9px] text-green-500">201</span>
                )}
                {error && (
                  <span className="ml-1.5 text-[9px] text-red-500">ERR</span>
                )}
              </button>
            </div>
            <div className="p-3">
              <div className="bg-black/40 rounded-xl p-3 overflow-x-auto max-h-[320px] overflow-y-auto">
                {viewerTab === "request" && requestBody && (
                  <JsonHighlight data={requestBody} />
                )}
                {viewerTab === "response" && response && (
                  <JsonHighlight data={response} />
                )}
                {viewerTab === "request" && !requestBody && (
                  <p className="text-[11px] text-gray-600 font-mono italic">
                    Submit a task to see the request body.
                  </p>
                )}
                {viewerTab === "response" && !response && (
                  <p className="text-[11px] text-gray-600 font-mono italic">
                    Submit a task to see the response.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Live Status Feed ──────────────────────────────── */}
        {feed.length > 0 && (
          <section className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden animate-[fadeIn_0.3s_ease-out]">
            <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor:
                    currentTask?.status === "completed" ||
                    currentTask?.status === "failed" ||
                    currentTask?.status === "expired"
                      ? "#6b7280"
                      : "#22c55e",
                }}
              />
              <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium font-mono">
                live status
              </span>
              {taskId && (
                <span className="text-[10px] text-gray-700 font-mono ml-auto">
                  {taskId.slice(0, 8)}...
                </span>
              )}
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              {feed.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 animate-[fadeIn_0.2s_ease-out]"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-[10px] text-gray-600 font-mono shrink-0">
                    {entry.time}
                  </span>
                  <span className="text-xs text-gray-300 font-mono">
                    {entry.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Verification result */}
            {currentTask && currentTask.verificationResult && (
              <div className="px-4 pb-3">
                <div
                  className="rounded-xl p-3 border"
                  style={{
                    backgroundColor:
                      currentTask.verificationResult.verdict === "pass"
                        ? "rgba(34,197,94,0.06)"
                        : currentTask.verificationResult.verdict === "flag"
                          ? "rgba(245,158,11,0.06)"
                          : "rgba(239,68,68,0.06)",
                    borderColor:
                      currentTask.verificationResult.verdict === "pass"
                        ? "rgba(34,197,94,0.15)"
                        : currentTask.verificationResult.verdict === "flag"
                          ? "rgba(245,158,11,0.15)"
                          : "rgba(239,68,68,0.15)",
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium font-mono">
                      Verification
                    </span>
                    <span
                      className="text-xs font-bold font-mono"
                      style={{
                        color:
                          currentTask.verificationResult.verdict === "pass"
                            ? "#22c55e"
                            : currentTask.verificationResult.verdict === "flag"
                              ? "#f59e0b"
                              : "#ef4444",
                      }}
                    >
                      {currentTask.verificationResult.verdict.toUpperCase()}{" "}
                      {Math.round(currentTask.verificationResult.confidence * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 italic leading-relaxed">
                    &ldquo;{currentTask.verificationResult.reasoning}&rdquo;
                  </p>
                  {currentTask.attestationTxHash && (
                    <a
                      href={`https://worldscan.org/tx/${currentTask.attestationTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-400 font-medium font-mono mt-2 inline-block"
                    >
                      View on-chain attestation
                    </a>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Recent API Activity ──────────────────────────── */}
        <section className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium font-mono">
                recent api activity
              </span>
            </div>
            <button
              onClick={fetchRecent}
              disabled={recentLoading}
              className="text-[10px] text-gray-600 hover:text-gray-300 font-mono transition-colors px-2 py-0.5 rounded border border-white/[0.06] hover:border-white/10"
            >
              {recentLoading ? "..." : "refresh"}
            </button>
          </div>
          {recentTasks.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[11px] text-gray-600 font-mono">
                {recentLoading
                  ? "Loading..."
                  : "No open tasks found. Post one above!"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {recentTasks.map((task) => (
                <div
                  key={task.id}
                  className="px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: statusColor(task.status) }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-gray-300 font-mono truncate leading-tight">
                      {task.description.slice(0, 80)}
                      {task.description.length > 80 ? "..." : ""}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-gray-600 font-mono">
                        {task.id.slice(0, 8)}
                      </span>
                      <span className="text-[9px] text-gray-700">|</span>
                      <span className="text-[9px] text-gray-600 font-mono">
                        {task.location}
                      </span>
                      <span className="text-[9px] text-gray-700">|</span>
                      <span className="text-[9px] font-mono text-green-500/70">
                        ${task.bountyUsdc}
                      </span>
                      {task.createdAt && (
                        <>
                          <span className="text-[9px] text-gray-700">|</span>
                          <span className="text-[9px] text-gray-600 font-mono">
                            {timeAgo(task.createdAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── API Reference ────────────────────────────────── */}
        <section className="bg-[#0a0a0a] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium font-mono mb-3">
            &gt; api reference
          </p>

          <div className="flex flex-col gap-3">
            {/* POST endpoint */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-mono font-bold bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded">
                  POST
                </span>
                <span className="text-[11px] text-gray-400 font-mono">
                  /api/agent/tasks
                </span>
              </div>
              <div className="bg-black/40 rounded-lg p-2.5 font-mono text-[10px] text-gray-500 leading-relaxed">
                <span className="text-gray-600">Required:</span>{" "}
                <span className="text-blue-400">description</span>,{" "}
                <span className="text-blue-400">location</span>,{" "}
                <span className="text-blue-400">bounty_usdc</span>
                <br />
                <span className="text-gray-600">Optional:</span>{" "}
                <span className="text-gray-500">
                  agent_id, lat, lng, deadline_hours, callback_url, recurring_hours,
                  recurring_count
                </span>
              </div>
            </div>

            {/* GET endpoint */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9px] font-mono font-bold bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded">
                  GET
                </span>
                <span className="text-[11px] text-gray-400 font-mono">
                  /api/agent/tasks
                </span>
              </div>
              <div className="bg-black/40 rounded-lg p-2.5 font-mono text-[10px] text-gray-500 leading-relaxed">
                Returns open tasks. Response:{" "}
                <span className="text-yellow-300">
                  {"{ tasks: [{ id, description, location, bountyUsdc, ... }] }"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer spacer */}
        <div className="h-8" />
      </div>

      {/* Global slider thumb styles */}
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid rgba(255,255,255,0.2);
          box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid rgba(255,255,255,0.2);
          box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
