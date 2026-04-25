"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

type Message = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
};

type Step = "create" | "claim" | "proof" | "followup" | "done";

const STEP_LABELS: Record<Step, string> = {
  create: "Create Task",
  claim: "Claim Task",
  proof: "Submit Proof",
  followup: "AI Follow-Up",
  done: "Complete",
};

const STEPS: Step[] = ["create", "claim", "proof", "followup", "done"];

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function truncAddr(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function DemoPage() {
  const [step, setStep] = useState<Step>("create");
  const [task, setTask] = useState<Task | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofNote, setProofNote] = useState("");
  const [followUpReply, setFollowUpReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function refreshTask() {
    if (!task) return null;
    const res = await fetch(`/api/tasks`);
    const data = await res.json();
    const updated = (data.tasks as Task[])?.find((t) => t.id === task.id);
    if (updated) setTask(updated);
    return updated || task;
  }

  async function refreshMessages() {
    if (!task) return;
    const res = await fetch(`/api/tasks/${task.id}/messages`);
    const data = await res.json();
    if (data.messages) setMessages(data.messages);
  }

  // Step 1: Create task
  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: "queuewatch",
          description:
            "Visit the Louvre Pyramid entrance at current time. Photo the queue from the back. Estimate number of people and wait time in minutes.",
          location: "Musee du Louvre, Paris 1er",
          bounty_usdc: 0.50,
          deadline_hours: 24,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create task");
      setTask(data.task);
      setStep("claim");

      setMessages([
        {
          id: crypto.randomUUID(),
          sender: "system",
          text: `Task created: "${data.task.description}" — $${data.task.bountyUsdc} USDC bounty at ${data.task.location}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  // Step 2: Claim task
  async function handleClaim() {
    if (!task) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimant: "dev_demo_runner" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to claim");
      setTask(data.task);

      // Wait for AI briefing to be generated
      await new Promise((r) => setTimeout(r, 3000));
      await refreshMessages();
      setStep("proof");
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  // Handle file selection
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setProofPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  // Step 3: Submit proof (with demo=true for forced follow-up)
  async function handleSubmitProof() {
    if (!task || !proofFile) return;
    setLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(proofFile);
      });

      const res = await fetch(`/api/verify-proof?demo=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          proofImageBase64: base64,
          proofNote: proofNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");

      // Refresh to get all messages including follow-up
      await new Promise((r) => setTimeout(r, 2000));
      await refreshMessages();
      const updated = await refreshTask();

      if (updated?.aiFollowUp?.status === "pending") {
        setStep("followup");
      } else {
        setStep("done");
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  // Step 4: Reply to follow-up and trigger re-evaluation
  async function handleFollowUpReply() {
    if (!task || !followUpReply.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Post the reply as a message
      await fetch(`/api/tasks/${task.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "dev_demo_runner",
          text: followUpReply,
        }),
      });

      await refreshMessages();

      // Trigger re-evaluation
      const res = await fetch(`/api/tasks/${task.id}/followup`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-evaluation failed");

      await new Promise((r) => setTimeout(r, 1500));
      await refreshMessages();
      await refreshTask();
      setStep("done");
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  function renderMessage(msg: Message) {
    const isBot = msg.sender === "relay-bot";
    const isSystem = msg.sender === "system";
    const isUser = !isBot && !isSystem;

    return (
      <div
        key={msg.id}
        className={`flex ${isUser ? "justify-end" : "justify-start"} animate-[fadeIn_0.3s_ease-out]`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 ${
            isSystem
              ? "bg-blue-500/10 border border-blue-500/20 text-blue-300"
              : isBot
                ? "bg-[#1a1a1a] border border-white/[0.06] text-gray-200"
                : "bg-white/10 border border-white/[0.08] text-white"
          }`}
        >
          {!isSystem && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {isBot ? "RELAY AI" : truncAddr(msg.sender)}
              </span>
              <span className="text-[9px] text-gray-700">
                {timeAgo(msg.timestamp)}
              </span>
            </div>
          )}
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap">
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  const currentStepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col max-w-lg mx-auto">
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
          <h1 className="text-sm font-bold tracking-tight">
            World Chat Demo
          </h1>
          <div className="w-12" />
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0.5 sm:gap-1 px-3 sm:px-4 pb-3">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div
                  className="w-full h-1 rounded-full transition-all duration-500"
                  style={{
                    backgroundColor:
                      i <= currentStepIndex
                        ? i === currentStepIndex
                          ? "#3b82f6"
                          : "#22c55e"
                        : "rgba(255,255,255,0.06)",
                  }}
                />
                <span
                  className="text-[9px] mt-1 uppercase tracking-wider font-medium transition-colors truncate max-w-full text-center"
                  style={{
                    color:
                      i <= currentStepIndex
                        ? i === currentStepIndex
                          ? "#3b82f6"
                          : "#22c55e"
                        : "#333",
                  }}
                >
                  {STEP_LABELS[s]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 flex flex-col gap-3">
        {messages.map(renderMessage)}
        <div ref={chatEndRef} />
      </div>

      {/* Bottom action panel */}
      <div className="sticky bottom-0 bg-[#0a0a0a] border-t border-white/5 px-3 sm:px-4 py-3 sm:py-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Step 1: Create */}
        {step === "create" && (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Demo Scenario
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                An AI agent (QueueWatch) posts a queue monitoring task at the
                Louvre with an $8 bounty. A human runner claims it, submits
                proof, and the AI verifier triggers a multi-turn conversation
                to confirm completion.
              </p>
            </div>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-semibold bg-blue-500 text-white active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating task...
                </span>
              ) : (
                "Start Demo — Create Task"
              )}
            </button>
          </div>
        )}

        {/* Step 2: Claim */}
        {step === "claim" && (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">
                Next Step
              </p>
              <p className="text-xs text-gray-300">
                A World ID-verified human claims the task. The AI generates a personalized briefing with tips for getting the proof verified.
              </p>
            </div>
            <button
              onClick={handleClaim}
              disabled={loading}
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-semibold bg-amber-500 text-black active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Claiming + generating AI briefing...
                </span>
              ) : (
                'Claim Task — "I\'ll do it"'
              )}
            </button>
          </div>
        )}

        {/* Step 3: Proof */}
        {step === "proof" && (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">
                Submit Proof
              </p>
              <p className="text-xs text-gray-300">
                Upload a photo as proof. Claude Sonnet analyzes it via vision
                AI. In demo mode, it will trigger a follow-up question.
              </p>
            </div>

            {/* File upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 rounded-xl text-sm font-medium border border-dashed border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300 transition-all"
            >
              {proofPreview ? "Change Photo" : "Select Proof Photo"}
            </button>

            {proofPreview && (
              <div className="relative">
                <img
                  src={proofPreview}
                  alt="Proof"
                  className="w-full rounded-xl border border-white/[0.06] max-h-48 object-cover"
                />
              </div>
            )}

            <input
              type="text"
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="Optional note (e.g. 'Taken at 2pm')"
              className="w-full bg-[#111] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
            />

            <button
              onClick={handleSubmitProof}
              disabled={loading || !proofFile}
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-semibold bg-green-500 text-black active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  AI verifying with Claude Vision...
                </span>
              ) : (
                "Submit Proof Photo"
              )}
            </button>
          </div>
        )}

        {/* Step 4: Follow-up reply */}
        {step === "followup" && (
          <div className="flex flex-col gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider font-medium mb-1">
                AI Follow-Up Question
              </p>
              <p className="text-xs text-amber-200/70">
                The AI isn&apos;t confident enough to auto-verify. It&apos;s
                asking a follow-up question. Reply below, then the AI
                re-evaluates with your response as additional context.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={followUpReply}
                onChange={(e) => setFollowUpReply(e.target.value)}
                placeholder="Type your response..."
                className="flex-1 min-w-0 bg-[#111] border border-white/[0.06] rounded-xl px-3 py-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleFollowUpReply();
                  }
                }}
              />
              <button
                onClick={handleFollowUpReply}
                disabled={loading || !followUpReply.trim()}
                className="px-4 min-h-[44px] rounded-xl text-sm font-semibold bg-blue-500 text-white active:scale-[0.98] transition-all disabled:opacity-40 shrink-0"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                ) : (
                  "Send"
                )}
              </button>
            </div>

            <p className="text-[10px] text-gray-600 text-center">
              Tip: Reference specific details — &quot;The street sign says Rue de
              Rivoli, visible on the left&quot;
            </p>
          </div>
        )}

        {/* Step 5: Done */}
        {step === "done" && task && (
          <div className="flex flex-col gap-3">
            <div
              className="rounded-xl p-4 border"
              style={{
                backgroundColor:
                  task.verificationResult?.verdict === "pass"
                    ? "rgba(34,197,94,0.08)"
                    : task.verificationResult?.verdict === "flag"
                      ? "rgba(245,158,11,0.08)"
                      : "rgba(239,68,68,0.08)",
                borderColor:
                  task.verificationResult?.verdict === "pass"
                    ? "rgba(34,197,94,0.2)"
                    : task.verificationResult?.verdict === "flag"
                      ? "rgba(245,158,11,0.2)"
                      : "rgba(239,68,68,0.2)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Final Verdict
                </span>
                <span
                  className="text-sm font-bold"
                  style={{
                    color:
                      task.verificationResult?.verdict === "pass"
                        ? "#22c55e"
                        : task.verificationResult?.verdict === "flag"
                          ? "#f59e0b"
                          : "#ef4444",
                  }}
                >
                  {task.verificationResult?.verdict?.toUpperCase()}{" "}
                  {task.verificationResult
                    ? `${Math.round(task.verificationResult.confidence * 100)}%`
                    : ""}
                </span>
              </div>
              <p className="text-xs text-gray-400 italic leading-relaxed">
                &ldquo;{task.verificationResult?.reasoning}&rdquo;
              </p>
              {task.attestationTxHash && (
                <a
                  href={`https://worldscan.org/tx/${task.attestationTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-400 font-medium mt-2 inline-block"
                >
                  View on-chain attestation
                </a>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <Link
                href="/leaderboard"
                className="text-center py-2.5 min-h-[44px] flex items-center justify-center rounded-xl text-[10px] font-medium bg-[#111] border border-white/[0.06] text-gray-400 hover:text-white transition-colors"
              >
                Leaderboard
              </Link>
              <Link
                href="/gallery"
                className="text-center py-2.5 min-h-[44px] flex items-center justify-center rounded-xl text-[10px] font-medium bg-[#111] border border-white/[0.06] text-gray-400 hover:text-white transition-colors"
              >
                Gallery
              </Link>
              <Link
                href="/dashboard"
                className="text-center py-2.5 min-h-[44px] flex items-center justify-center rounded-xl text-[10px] font-medium bg-[#111] border border-white/[0.06] text-gray-400 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
            </div>

            <button
              onClick={() => {
                setStep("create");
                setTask(null);
                setMessages([]);
                setProofFile(null);
                setProofPreview(null);
                setProofNote("");
                setFollowUpReply("");
                setError(null);
              }}
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-medium border border-white/[0.06] text-gray-400 hover:text-white transition-colors"
            >
              Run Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
