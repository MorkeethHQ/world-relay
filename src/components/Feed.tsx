"use client";

import { useState, useEffect, useCallback } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import type { Task } from "@/lib/types";
import { encodeCreateTask, RELAY_ESCROW_ADDRESS } from "@/lib/contracts";

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

type Tab = "available" | "mine" | "completed";

export function Feed({ userId, onLogout }: { userId: string | null; onLogout?: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<"board" | "post" | "proof" | "detail">("board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [tab, setTab] = useState<Tab>("available");

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data.tasks);
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

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

  const filtered = tasks.filter((t) => {
    if (tab === "available") return t.status === "open";
    if (tab === "mine") return t.poster === userId || t.claimant === userId;
    if (tab === "completed") return t.status === "completed";
    return true;
  });

  const myTaskCount = tasks.filter(t => t.poster === userId || t.claimant === userId).length;

  return (
    <div className="flex flex-col gap-0 max-w-lg mx-auto w-full min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">RELAY</h1>
              {userId && (
                <button onClick={onLogout} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors leading-none mt-0.5">
                  {shortId(userId)}
                </button>
              )}
            </div>
          </div>
          {userId && (
            <button
              onClick={() => setView("post")}
              className="bg-white text-black h-9 px-4 rounded-full font-semibold text-xs active:scale-95 transition-all shadow-[0_0_12px_rgba(255,255,255,0.08)]"
            >
              + Request
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex px-4 gap-0">
          {(["available", "mine", "completed"] as Tab[]).map((t) => {
            const label = t === "available" ? "Nearby" : t === "mine" ? "Yours" : "Done";
            const count = t === "mine" ? myTaskCount : null;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 text-xs py-2.5 font-medium transition-all relative ${
                  tab === t ? "text-white" : "text-gray-500"
                }`}
              >
                {label}
                {count !== null && count > 0 && (
                  <span className="ml-1 text-[10px] text-gray-500">{count}</span>
                )}
                {tab === t && (
                  <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-white rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center">
              {tab === "available" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              ) : tab === "mine" ? (
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
              {tab === "available" ? "No requests nearby yet" :
               tab === "mine" ? "You haven't posted or claimed anything" :
               "No completed requests"}
            </p>
            {tab === "available" && (
              <button
                onClick={() => setView("post")}
                className="text-xs text-white/60 underline underline-offset-2 hover:text-white/80 transition-colors"
              >
                Post the first one
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((task, i) => (
              <div key={task.id} style={{ animationDelay: `${i * 50}ms` }} className="animate-[slideUp_0.3s_ease-out_both]">
                <TaskCard
                  task={task}
                  userId={userId}
                  onTap={() => {
                    setSelectedTask(task);
                    setView("detail");
                  }}
                  onClaim={async () => {
                    await fetch(`/api/tasks/${task.id}/claim`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ claimant: userId }),
                    });
                    fetchTasks();
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
    </div>
  );
}

function TaskCard({
  task,
  userId,
  onTap,
  onClaim,
  onSubmitProof,
}: {
  task: Task;
  userId: string | null;
  onTap: () => void;
  onClaim: () => void;
  onSubmitProof: () => void;
}) {
  const isOwnTask = task.poster === userId;
  const isClaimant = task.claimant === userId;

  return (
    <div
      onClick={onTap}
      className="rounded-2xl p-4 flex flex-col gap-3 bg-[#111] border border-white/[0.06] cursor-pointer active:scale-[0.98] transition-all"
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[15px] leading-snug">{task.description}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{task.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-gray-600">{timeLeft(task.deadline)}</span>
          </div>
        </div>
        <div className="text-right shrink-0 bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-1.5">
          <p className="font-bold text-green-400 text-sm leading-none">${task.bountyUsdc}</p>
          <p className="text-[9px] text-green-500/60 mt-0.5">USDC</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          {isOwnTask && <span className="text-[10px] text-gray-600">You posted</span>}
          {isClaimant && task.status === "claimed" && <span className="text-[10px] text-gray-600">You claimed</span>}
        </div>
        <span className="text-[10px] text-gray-700">{timeAgo(task.createdAt)}</span>
      </div>

      {task.verificationResult && (
        <div className={`text-xs p-3 rounded-xl ${
          task.verificationResult.verdict === "pass" ? "bg-green-500/8 text-green-300 border border-green-500/15" :
          task.verificationResult.verdict === "flag" ? "bg-yellow-500/8 text-yellow-300 border border-yellow-500/15" :
          "bg-red-500/8 text-red-300 border border-red-500/15"
        }`}>
          <span className="font-bold text-[11px] tracking-wide">{task.verificationResult.verdict === "pass" ? "VERIFIED" : task.verificationResult.verdict === "flag" ? "FLAGGED" : "REJECTED"}</span>
          <span className="text-gray-400 mx-1.5">—</span>
          <span className="opacity-80">{task.verificationResult.reasoning}</span>
        </div>
      )}

      {task.status === "open" && userId && !isOwnTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onClaim(); }}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-all"
        >
          Claim
        </button>
      )}

      {task.status === "claimed" && isClaimant && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium active:scale-[0.97] transition-all"
        >
          Submit Proof
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; dot: string; label: string }> = {
    open: { bg: "text-blue-400", dot: "bg-blue-400", label: "Open" },
    claimed: { bg: "text-yellow-400", dot: "bg-yellow-400", label: "Claimed" },
    completed: { bg: "text-green-400", dot: "bg-green-400", label: "Done" },
    failed: { bg: "text-red-400", dot: "bg-red-400", label: "Failed" },
    expired: { bg: "text-gray-400", dot: "bg-gray-500", label: "Expired" },
  };

  const c = config[status] || config.expired;

  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-medium ${c.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} animate-[pulse-dot_2s_ease-in-out_infinite]`} />
      {c.label}
    </span>
  );
}

function PostTask({
  userId,
  onDone,
  onCancel,
}: {
  userId: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [bounty, setBounty] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!description || !location || !bounty || !userId) return;
    setSubmitting(true);

    if (MiniKit.isInstalled() && RELAY_ESCROW_ADDRESS) {
      const txPayload = encodeCreateTask(description, parseFloat(bounty), 24);
      if (txPayload) {
        try {
          await MiniKit.sendTransaction(txPayload);
        } catch (err) {
          console.error("On-chain escrow failed, continuing off-chain:", err);
        }
      }
    }

    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poster: userId,
        description,
        location,
        bountyUsdc: parseFloat(bounty),
        deadlineHours: 24,
      }),
    });
    onDone();
  };

  const isValid = description && location && bounty;

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
        <span className="text-sm font-semibold">New Request</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-5">
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">What do you need?</label>
          <textarea
            placeholder="Take a photo of the menu board at Blue Bottle on Rue de Rivoli"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-[#111] border border-white/[0.06] rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Location</label>
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <input
              type="text"
              placeholder="City or neighborhood"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Bounty</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">$</span>
            <input
              type="number"
              placeholder="5"
              value={bounty}
              onChange={(e) => setBounty(e.target.value)}
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl pl-8 pr-16 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-600 font-medium">USDC</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8 pt-2">
        <button
          onClick={handleSubmit}
          disabled={!isValid || submitting}
          className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
            isValid ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.1)]" : "bg-gray-800 text-gray-500"
          } disabled:opacity-50`}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Posting...
            </span>
          ) : `Post Request${bounty ? ` — $${bounty} USDC` : ""}`}
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
  const [proofNote, setProofNote] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ verdict: string; reasoning: string } | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      setImageData(dataUrl.split(",")[1]);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!imageData) return;
    setSubmitting(true);

    const res = await fetch("/api/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        proofImageBase64: imageData,
        proofNote: proofNote || null,
      }),
    });

    const data = await res.json();
    setResult(data.verification);
    setSubmitting(false);

    if (data.verification.verdict === "pass") {
      setTimeout(onDone, 2500);
    }
  };

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
        <span className="text-sm font-semibold">Submit Proof</span>
        <div className="w-12" />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4">
        {/* Task context */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">Task</p>
          <p className="text-sm font-medium leading-snug">{task.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{task.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-green-400 font-semibold">${task.bountyUsdc} USDC</span>
          </div>
        </div>

        {/* Photo upload */}
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium block mb-2">Proof Photo</label>
          {imagePreview ? (
            <div className="relative rounded-2xl overflow-hidden">
              <img src={imagePreview} alt="Proof" className="w-full max-h-72 object-cover" />
              <button
                onClick={() => { setImageData(null); setImagePreview(null); }}
                className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full font-medium"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl p-10 cursor-pointer hover:border-white/20 transition-all bg-[#111]/50 active:scale-[0.99]">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <span className="text-sm text-gray-400">Take photo or choose from library</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageChange}
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
          className="bg-[#111] border border-white/[0.06] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-white/20 transition-colors placeholder:text-gray-600"
        />

        {/* Verification spinner */}
        {submitting && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="w-12 h-12 border-2 border-purple-500/30 rounded-full" />
              <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin absolute inset-0" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-white">Verifying proof...</p>
              <p className="text-xs text-gray-500 mt-1">AI is analyzing your photo</p>
            </div>
          </div>
        )}

        {/* Verdict result */}
        {result && (
          <div className={`p-5 rounded-2xl text-sm border animate-[fadeIn_0.3s_ease-out] ${
            result.verdict === "pass" ? "bg-green-500/8 border-green-500/20" :
            result.verdict === "flag" ? "bg-yellow-500/8 border-yellow-500/20" :
            "bg-red-500/8 border-red-500/20"
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
                result.verdict === "pass" ? "text-green-400" :
                result.verdict === "flag" ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {result.verdict === "pass" ? "VERIFIED" : result.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{result.reasoning}</p>
            {result.verdict === "pass" && (
              <div className="mt-3 pt-3 border-t border-green-500/15">
                <p className="font-semibold text-sm text-green-400">${task.bountyUsdc} USDC released</p>
              </div>
            )}
            {result.verdict === "flag" && (
              <p className="mt-2 text-xs text-yellow-400/70">Waiting for poster to review...</p>
            )}
            {result.verdict === "fail" && (
              <p className="mt-2 text-xs text-red-400/70">Task reopened for new claims.</p>
            )}
          </div>
        )}
      </div>

      {!result && !submitting && (
        <div className="px-4 pb-8 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!imageData}
            className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
              imageData ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-500"
            } disabled:opacity-50`}
          >
            Submit for Verification
          </button>
        </div>
      )}
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
  const isClaimant = currentTask.claimant === userId;
  const isPoster = currentTask.poster === userId;
  const isFlagged = currentTask.verificationResult?.verdict === "flag" && currentTask.status === "claimed";

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/tasks/${task.id}/messages`);
    const data = await res.json();
    setMessages(data.messages || []);
  }, [task.id]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <StatusBadge status={currentTask.status} />
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-4">
        {/* Task info */}
        <div>
          <p className="font-semibold text-lg leading-snug">{currentTask.description}</p>
          <div className="flex items-center gap-2 mt-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs text-gray-500">{currentTask.location}</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-green-400 font-semibold">${currentTask.bountyUsdc} USDC</span>
            <span className="text-[10px] text-gray-700 mx-0.5">·</span>
            <span className="text-xs text-gray-500">{timeLeft(currentTask.deadline)}</span>
          </div>
        </div>

        {/* People */}
        <div className="flex gap-3">
          <div className="flex-1 bg-[#111] rounded-xl p-3 border border-white/[0.06]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Poster</p>
            <p className="text-xs font-medium">{shortId(currentTask.poster)}</p>
          </div>
          {currentTask.claimant && (
            <div className="flex-1 bg-[#111] rounded-xl p-3 border border-white/[0.06]">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Claimant</p>
              <p className="text-xs font-medium">{shortId(currentTask.claimant)}</p>
            </div>
          )}
        </div>

        {/* Verification result */}
        {currentTask.verificationResult && (
          <div className={`p-4 rounded-2xl border ${
            currentTask.verificationResult.verdict === "pass" ? "bg-green-500/8 border-green-500/20" :
            currentTask.verificationResult.verdict === "flag" ? "bg-yellow-500/8 border-yellow-500/20" :
            "bg-red-500/8 border-red-500/20"
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
                currentTask.verificationResult.verdict === "pass" ? "text-green-400" :
                currentTask.verificationResult.verdict === "flag" ? "text-yellow-400" :
                "text-red-400"
              }`}>
                {currentTask.verificationResult.verdict === "pass" ? "VERIFIED" : currentTask.verificationResult.verdict === "flag" ? "FLAGGED" : "REJECTED"}
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{currentTask.verificationResult.reasoning}</p>
          </div>
        )}

        {/* Action buttons */}
        {currentTask.status === "claimed" && isClaimant && !isFlagged && (
          <button
            onClick={onSubmitProof}
            className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
          >
            Submit Proof
          </button>
        )}

        {isFlagged && isPoster && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-yellow-400/70 text-center">AI flagged this proof. Your call.</p>
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
                className="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
              >
                Approve & Pay
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
                className="flex-1 bg-red-600/80 hover:bg-red-600 text-white px-4 py-3 rounded-2xl text-sm font-semibold active:scale-[0.98] transition-all"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* XMTP Thread */}
        {messages.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Thread</span>
              <span className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] text-gray-700">XMTP</span>
            </div>
            {messages.map((msg) => (
              <div key={msg.id} className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-blue-400">
                    {msg.sender === "relay-bot" ? "RELAY" : shortId(msg.sender)}
                  </span>
                  <span className="text-[10px] text-gray-700">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-xs text-gray-300 whitespace-pre-line leading-relaxed">{msg.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
