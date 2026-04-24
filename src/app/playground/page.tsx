"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AGENT_REGISTRY, SEED_TASKS } from "@/lib/agents";
import type { Task } from "@/lib/types";

type AgentOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultDescription: string;
  defaultLocation: string;
  defaultBounty: number;
};

function buildAgentOptions(): AgentOption[] {
  return Object.values(AGENT_REGISTRY).map((agent) => {
    const seed = SEED_TASKS.find((s) => s.agentId === agent.id);
    return {
      ...agent,
      defaultDescription: seed?.description || "",
      defaultLocation: seed?.location || "",
      defaultBounty: seed?.bountyUsdc || 5,
    };
  });
}

const AGENTS = buildAgentOptions();

type StatusEntry = {
  time: string;
  label: string;
  color: string;
};

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

export default function PlaygroundPage() {
  const [selectedAgent, setSelectedAgent] = useState<AgentOption>(AGENTS[0]);
  const [description, setDescription] = useState(AGENTS[0].defaultDescription);
  const [location, setLocation] = useState(AGENTS[0].defaultLocation);
  const [bounty, setBounty] = useState(String(AGENTS[0].defaultBounty));
  const [deadlineHours, setDeadlineHours] = useState("24");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringHours, setRecurringHours] = useState("24");
  const [recurringCount, setRecurringCount] = useState("7");
  const [posting, setPosting] = useState(false);
  const [response, setResponse] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [feed, setFeed] = useState<StatusEntry[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update form when agent changes
  function selectAgent(agent: AgentOption) {
    setSelectedAgent(agent);
    setDescription(agent.defaultDescription);
    setLocation(agent.defaultLocation);
    setBounty(String(agent.defaultBounty));
    setResponse(null);
    setError(null);
    setTaskId(null);
    setFeed([]);
    setCurrentTask(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Poll for task status
  useEffect(() => {
    if (!taskId) return;

    let lastStatus = "";

    const poll = () => {
      fetch(`/api/tasks`)
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

            // Stop polling on terminal states
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

  async function handlePost() {
    setPosting(true);
    setError(null);
    setResponse(null);
    setTaskId(null);
    setFeed([]);
    setCurrentTask(null);

    try {
      const body: Record<string, unknown> = {
        agent_id: selectedAgent.id,
        description,
        location,
        bounty_usdc: Number(bounty),
        deadline_hours: Number(deadlineHours),
      };
      if (callbackUrl.trim()) {
        body.callback_url = callbackUrl.trim();
      }
      if (recurringEnabled) {
        body.recurring_hours = Number(recurringHours);
        body.recurring_count = Number(recurringCount);
      }

      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Request failed");
        setPosting(false);
        return;
      }

      setResponse(data);
      const id = data.task?.id;
      if (id) {
        setTaskId(id);
        setFeed([
          {
            time: timeStr(),
            label: "Task posted - awaiting human claim",
            color: "#3b82f6",
          },
        ]);
      }
    } catch {
      setError("Network error");
    }
    setPosting(false);
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
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
            Back
          </Link>
          <h1 className="text-sm font-bold tracking-tight">Agent Playground</h1>
          <div className="w-12" />
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* Agent Picker */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-2">
            Select Agent
          </p>
          <div className="grid grid-cols-2 gap-2">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => selectAgent(agent)}
                className="text-left rounded-xl p-3 border transition-all"
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
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
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
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected agent header */}
        <div
          className="rounded-2xl p-4 border"
          style={{
            backgroundColor: `${selectedAgent.color}08`,
            borderColor: `${selectedAgent.color}20`,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
              style={{ backgroundColor: `${selectedAgent.color}15` }}
            >
              {selectedAgent.icon}
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: selectedAgent.color }}>
                {selectedAgent.name}
              </p>
              <p className="text-[11px] text-gray-500">
                Agent ID: {selectedAgent.id}
              </p>
            </div>
          </div>
        </div>

        {/* Task Form */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">
            Task Details
          </p>

          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 resize-none"
              placeholder="Describe the task..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
                placeholder="Paris 6e"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
                Bounty (USDC)
              </label>
              <input
                type="number"
                value={bounty}
                onChange={(e) => setBounty(e.target.value)}
                min="1"
                className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
              Deadline (hours)
            </label>
            <input
              type="number"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              min="1"
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
            />
          </div>

          {/* Webhook URL */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
              Webhook URL (optional)
            </label>
            <input
              type="url"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
              placeholder="https://your-api.com/webhook"
            />
          </div>

          {/* Recurring toggle */}
          <div>
            <button
              onClick={() => setRecurringEnabled(!recurringEnabled)}
              className="flex items-center gap-2 text-[10px] text-gray-500 uppercase tracking-wider font-medium"
            >
              <div
                className="w-4 h-4 rounded border flex items-center justify-center transition-all"
                style={{
                  borderColor: recurringEnabled
                    ? selectedAgent.color
                    : "rgba(255,255,255,0.1)",
                  backgroundColor: recurringEnabled
                    ? `${selectedAgent.color}30`
                    : "transparent",
                }}
              >
                {recurringEnabled && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={selectedAgent.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              Recurring task
            </button>

            {recurringEnabled && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
                    Interval (hours)
                  </label>
                  <input
                    type="number"
                    value={recurringHours}
                    onChange={(e) => setRecurringHours(e.target.value)}
                    min="1"
                    className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">
                    Total runs
                  </label>
                  <input
                    type="number"
                    value={recurringCount}
                    onChange={(e) => setRecurringCount(e.target.value)}
                    min="1"
                    className="w-full bg-black/40 border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fire button */}
        <button
          onClick={handlePost}
          disabled={posting || !description || !location || !bounty}
          className="w-full py-3 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-40"
          style={{
            backgroundColor: selectedAgent.color,
            color: "#000",
          }}
        >
          {posting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Posting...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              {selectedAgent.icon} Fire Task as {selectedAgent.name}
            </span>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-[fadeIn_0.3s_ease-out]">
            <p className="text-xs text-red-400 font-medium">{error}</p>
          </div>
        )}

        {/* Response */}
        {response && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden animate-[fadeIn_0.3s_ease-out]">
            <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4ade80"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span className="text-xs font-bold text-green-400">TASK POSTED</span>
            </div>
            <div className="px-4 py-3">
              <div className="bg-black/40 rounded-xl p-3 font-mono text-[11px] text-gray-400 leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(response, null, 2)}
              </div>
            </div>
          </div>
        )}

        {/* Live Status Feed */}
        {feed.length > 0 && (
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden animate-[fadeIn_0.3s_ease-out]">
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
              <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">
                Live Status
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
                  <span className="text-xs text-gray-300">{entry.label}</span>
                </div>
              ))}
            </div>

            {/* Task details when completed */}
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
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                      Verification
                    </span>
                    <span
                      className="text-xs font-bold"
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
                      className="text-[10px] text-blue-400 font-medium mt-2 inline-block"
                    >
                      View on-chain attestation
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* API Reference */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-2">
            API Reference
          </p>
          <div className="bg-black/40 rounded-xl p-3 font-mono text-[11px] text-gray-400 leading-relaxed overflow-x-auto">
            <span className="text-green-400">POST</span> /api/agent/tasks
            <br />
            {"{"}
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;agent_id&quot;</span>:{" "}
            <span className="text-yellow-300">&quot;{selectedAgent.id}&quot;</span>,
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;description&quot;</span>:{" "}
            <span className="text-yellow-300">&quot;...&quot;</span>,
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;location&quot;</span>:{" "}
            <span className="text-yellow-300">&quot;...&quot;</span>,
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;bounty_usdc&quot;</span>:{" "}
            <span className="text-purple-400">{bounty || "5"}</span>,
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;deadline_hours&quot;</span>:{" "}
            <span className="text-purple-400">{deadlineHours}</span>,
            <br />
            &nbsp;&nbsp;<span className="text-blue-400">&quot;callback_url&quot;</span>:{" "}
            <span className="text-yellow-300">&quot;https://...&quot;</span>
            <br />
            {"}"}
          </div>
        </div>
      </div>
    </div>
  );
}
