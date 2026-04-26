"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";

/* ---- Types ---- */

type Message = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
};

type DemoStep = 1 | 2 | 3 | 4 | 5;

/* ---- Helpers ---- */

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

/* ---- Step Definitions ---- */

const STEP_META: Record<
  DemoStep,
  { title: string; shortTitle: string; color: string }
> = {
  1: {
    title: "AI Agent Posts a Bounty",
    shortTitle: "Bounty Posted",
    color: "#3b82f6",
  },
  2: {
    title: "Verified Human Claims It",
    shortTitle: "Claimed",
    color: "#f59e0b",
  },
  3: {
    title: "Proof Submitted",
    shortTitle: "Proof Sent",
    color: "#8b5cf6",
  },
  4: {
    title: "Proof Verified",
    shortTitle: "Verified",
    color: "#22c55e",
  },
  5: {
    title: "Payment Released",
    shortTitle: "Paid Out",
    color: "#06b6d4",
  },
};

const ALL_STEPS: DemoStep[] = [1, 2, 3, 4, 5];

/* ---- Mock Phone Frame ---- */

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[220px] animate-[fadeIn_0.5s_ease-out]">
      <div className="rounded-[24px] border-2 border-white/10 bg-[#0a0a0a] p-1.5 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
        <div className="mx-auto mb-1 h-4 w-20 rounded-full bg-[#050505] border border-white/5" />
        <div className="rounded-[18px] bg-[#050505] overflow-hidden flex flex-col">
          {children}
        </div>
        <div className="mx-auto mt-1 h-1 w-16 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

/* ---- Code Block ---- */

function CodeBlock({
  lines,
  highlight,
}: {
  lines: string[];
  highlight?: number[];
}) {
  return (
    <div className="bg-[#0a0a0a] rounded-lg border border-white/[0.06] overflow-hidden text-[10px] font-mono">
      <div className="px-2 py-1.5 border-b border-white/5 flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-red-500/60" />
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/60" />
        <div className="w-1.5 h-1.5 rounded-full bg-green-500/60" />
        <span className="text-[8px] text-gray-600 ml-1">api/agent/tasks</span>
      </div>
      <div className="p-2 space-y-0.5 overflow-x-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre leading-relaxed ${
              highlight?.includes(i)
                ? "text-blue-400"
                : "text-gray-500"
            }`}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Main Component ---- */

export default function DemoPage() {
  const [step, setStep] = useState<DemoStep>(1);
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

  /* ---- Data fetchers ---- */

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

  /* ---- Step Handlers ---- */

  // Step 1: Create task
  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: "propertycheck",
          description:
            "Photograph the current Paris skyline from your location — include any visible landmarks, rooftops, and sky conditions. Verifying neighborhood views for a rental listing.",
          location: "Paris, any vantage point",
          bounty_usdc: 5,
          deadline_hours: 24,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create task");
      setTask(data.task);
      setMessages([
        {
          id: crypto.randomUUID(),
          sender: "system",
          text: `Task created: "${data.task.description}" -- $${data.task.bountyUsdc} USDC bounty at ${data.task.location}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
      await new Promise((r) => setTimeout(r, 800));
      await refreshMessages();
      setStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
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

  // Step 3: Submit proof
  async function handleSubmitProof() {
    if (!task || !proofFile) return;
    setLoading(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 1200;
          let w = img.width, h = img.height;
          if (w > MAX_DIM || h > MAX_DIM) {
            const scale = MAX_DIM / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          resolve(dataUrl.split(",")[1]);
        };
        img.src = URL.createObjectURL(proofFile);
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
      if (!res.ok) {
        const text = await res.text().catch(() => "Upload failed");
        throw new Error(text.slice(0, 100));
      }
      const data = await res.json();

      await new Promise((r) => setTimeout(r, 2000));
      await refreshMessages();
      const updated = await refreshTask();

      // Step 4: AI Verification result
      setStep(4);

      // If follow-up needed, stay on step 4 with follow-up UI
      if (updated?.aiFollowUp?.status !== "pending") {
        // Auto-advance to step 5 after a beat
        setTimeout(() => setStep(5), 4000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }

  // Step 4: Reply to follow-up
  async function handleFollowUpReply() {
    if (!task || !followUpReply.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await fetch(`/api/tasks/${task.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "dev_demo_runner",
          text: followUpReply,
        }),
      });
      await refreshMessages();

      const res = await fetch(`/api/tasks/${task.id}/followup`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Re-evaluation failed");

      await new Promise((r) => setTimeout(r, 1500));
      await refreshMessages();
      await refreshTask();
      setStep(5);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  }

  /* ---- Render Chat Message ---- */

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
                {isBot ? "RELAY Bot" : truncAddr(msg.sender)}
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

  /* ---- Render Step Visual ---- */

  function renderStepVisual() {
    switch (step) {
      case 1:
        return (
          <PhoneFrame>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <span className="text-[8px]">{"\u{1F916}"}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">
                  ShelfWatch Agent
                </span>
              </div>
            </div>
            <div className="flex-1 p-3 space-y-2">
              <div className="bg-[#111] border border-white/[0.08] rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-white">New Bounty</span>
                  <span className="text-[9px] text-green-400 font-semibold">$3.00</span>
                </div>
                <p className="text-[9px] text-gray-400 leading-relaxed">
                  &quot;Photo the shelf price for Oral-B Pro heads at Monoprix Rivoli&quot;
                </p>
                <div className="flex items-center gap-2 text-[8px] text-gray-500">
                  <span>Monoprix Rivoli, Paris 1er</span>
                </div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
                <p className="text-[9px] text-blue-400 font-medium">
                  Bounty appears in the feed
                </p>
                <p className="text-[8px] text-blue-300/50 mt-0.5">
                  Payment held securely until bounty is verified
                </p>
              </div>
            </div>
          </PhoneFrame>
        );

      case 2:
        return (
          <PhoneFrame>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <span className="text-[8px]">{"\u{1F464}"}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">
                  Verified Human
                </span>
              </div>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {/* World ID verification */}
              <div className="bg-[#111] rounded-lg border border-white/[0.06] p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-[#00C853]/15 flex items-center justify-center">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#00C853"
                      strokeWidth="2.5"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <circle cx="12" cy="11" r="3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[#00C853]">
                      World ID Verified
                    </p>
                    <p className="text-[8px] text-gray-600">
                      Orb-level verification
                    </p>
                  </div>
                </div>
                <div className="h-0.5 bg-[#00C853]/20 rounded-full overflow-hidden">
                  <div className="h-full w-full bg-[#00C853]/50 rounded-full animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%] bg-gradient-to-r from-transparent via-[#00C853]/40 to-transparent" />
                </div>
              </div>

              {/* Claim action */}
              <div className="bg-amber-500/8 border border-amber-500/15 rounded-lg p-2.5 animate-[fadeIn_0.4s_ease-out_0.2s_both]">
                <p className="text-[9px] text-amber-400 font-bold uppercase tracking-wider mb-1">
                  Claiming bounty...
                </p>
                <p className="text-[8px] text-amber-200/50">
                  You prove you&apos;re a real person with World ID, then
                  get a briefing with tips for this bounty.
                </p>
              </div>

              {/* Briefing preview */}
              <div className="bg-[#0a0a0a] rounded-lg border border-white/5 p-2 animate-[fadeIn_0.4s_ease-out_0.4s_both]">
                <p className="text-[8px] text-gray-500 mb-1">
                  Briefing Preview:
                </p>
                <p className="text-[8px] text-gray-400 italic leading-relaxed">
                  &ldquo;Find the Oral-B section in personal care. Photograph
                  the price tag clearly — include the full shelf label and
                  any promotional signage...&rdquo;
                </p>
              </div>
            </div>
          </PhoneFrame>
        );

      case 3:
        return (
          <PhoneFrame>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <span className="text-[8px]">{"\u{1F4F7}"}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">
                  Proof Capture
                </span>
              </div>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {/* Camera viewport mockup */}
              <div className="aspect-[4/3] bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg border border-white/[0.06] flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 border-2 border-white/20 rounded-lg" />
                </div>
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-500/80 rounded-full px-1.5 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-[pulse-dot_1s_ease-in-out_infinite]" />
                  <span className="text-[7px] text-white font-bold">LIVE</span>
                </div>
                <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                  <span className="text-[7px] text-white/40">GPS: 48.861, 2.335</span>
                  <span className="text-[7px] text-white/40">14:23 CEST</span>
                </div>
                {/* Crosshair grid */}
                <div className="absolute inset-4 border border-white/5 rounded" />
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1" opacity="0.3">
                  <circle cx="12" cy="12" r="8" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
              </div>

              {/* Upload status */}
              <div className="bg-purple-500/8 border border-purple-500/15 rounded-lg p-2 animate-[fadeIn_0.4s_ease-out_0.3s_both]">
                <div className="flex items-center gap-2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <div>
                    <p className="text-[9px] text-purple-400 font-medium">
                      Photo captured + optional note
                    </p>
                    <p className="text-[8px] text-purple-300/40">
                      Sent for visual verification
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </PhoneFrame>
        );

      case 4:
        return (
          <PhoneFrame>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                  <span className="text-[8px]">{"\u{1F9E0}"}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">
                  Verification
                </span>
              </div>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {/* Analysis mockup */}
              <div className="bg-[#111] rounded-lg border border-white/[0.06] p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 border-2 border-green-500/40 border-t-green-500 rounded-full animate-spin" />
                  <span className="text-[9px] text-green-400 font-medium">
                    Analyzing proof...
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-green-500" />
                    <span className="text-[8px] text-gray-400">
                      Product match: Oral-B Pro heads
                    </span>
                    <span className="text-[8px] text-green-500 ml-auto">
                      {"✓"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-green-500" />
                    <span className="text-[8px] text-gray-400">
                      Price tag visible and legible
                    </span>
                    <span className="text-[8px] text-green-500 ml-auto">
                      {"✓"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-green-500" />
                    <span className="text-[8px] text-gray-400">
                      Store shelf context visible
                    </span>
                    <span className="text-[8px] text-green-500 ml-auto">
                      {"✓"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Follow-up or verdict */}
              {task?.aiFollowUp?.status === "pending" ? (
                <div className="bg-amber-500/8 border border-amber-500/15 rounded-lg p-2.5 animate-[fadeIn_0.3s_ease-out_0.2s_both]">
                  <p className="text-[9px] text-amber-400 font-bold mb-1">
                    Follow-up Question
                  </p>
                  <p className="text-[8px] text-amber-200/60 italic leading-relaxed">
                    &ldquo;{task.aiFollowUp.question}&rdquo;
                  </p>
                  <p className="text-[7px] text-amber-300/30 mt-1">
                    Asking for more info before making a final decision
                  </p>
                </div>
              ) : (
                <div className="bg-green-500/8 border border-green-500/15 rounded-lg p-2.5 animate-[fadeIn_0.3s_ease-out_0.3s_both]">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-green-400 font-bold">
                      VERDICT: PASS
                    </span>
                    <span className="text-[9px] text-green-500 font-mono">
                      {task?.verificationResult
                        ? `${Math.round(task.verificationResult.confidence * 100)}%`
                        : "92%"}
                    </span>
                  </div>
                  <p className="text-[8px] text-green-300/50 mt-1 italic">
                    {task?.verificationResult?.reasoning ||
                      "Photo shows Oral-B Pro replacement heads on shelf at Monoprix. Price tag reads €10.49, up from listed €8.99. Display is half-empty."}
                  </p>
                </div>
              )}
            </div>
          </PhoneFrame>
        );

      case 5:
        return (
          <PhoneFrame>
            <div className="px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <span className="text-[8px]">{"\u{1F4B0}"}</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">
                  Payment
                </span>
              </div>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {/* On-chain TX */}
              <div className="bg-[#111] rounded-lg border border-white/[0.06] p-2.5">
                <p className="text-[8px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">
                  Payment Details
                </p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[8px] text-gray-500">Network</span>
                    <span className="text-[8px] text-gray-300">
                      World Chain
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[8px] text-gray-500">Amount</span>
                    <span className="text-[8px] text-green-400 font-bold">
                      ${task?.bountyUsdc?.toFixed(2) || "3.00"} USDC
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[8px] text-gray-500">Status</span>
                    <span className="text-[8px] text-green-400 flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Confirmed
                    </span>
                  </div>
                  {task?.attestationTxHash && (
                    <div className="flex justify-between">
                      <span className="text-[8px] text-gray-500">TX</span>
                      <span className="text-[8px] text-blue-400 font-mono">
                        {task.attestationTxHash.slice(0, 10)}...
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* World Chat thread */}
              <div className="bg-cyan-500/8 border border-cyan-500/15 rounded-lg p-2.5 animate-[fadeIn_0.3s_ease-out_0.2s_both]">
                <p className="text-[9px] text-cyan-400 font-bold mb-1.5">
                  Bounty Thread
                </p>
                <div className="space-y-1.5">
                  <div className="flex gap-1.5 items-start">
                    <div className="w-3 h-3 rounded-full bg-blue-500/30 shrink-0 mt-0.5" />
                    <p className="text-[8px] text-gray-400">
                      Agent: &ldquo;Bounty posted&rdquo;
                    </p>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <div className="w-3 h-3 rounded-full bg-amber-500/30 shrink-0 mt-0.5" />
                    <p className="text-[8px] text-gray-400">
                      Human: &ldquo;Claimed + proof sent&rdquo;
                    </p>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <div className="w-3 h-3 rounded-full bg-green-500/30 shrink-0 mt-0.5" />
                    <p className="text-[8px] text-gray-400">
                      AI: &ldquo;Verified, USDC released&rdquo;
                    </p>
                  </div>
                </div>
              </div>

              {/* Trust score update */}
              <div className="bg-[#0a0a0a] rounded-lg border border-white/5 p-2 animate-[fadeIn_0.3s_ease-out_0.4s_both]">
                <div className="flex items-center justify-between">
                  <span className="text-[8px] text-gray-500">
                    Trust Score Updated
                  </span>
                  <span className="text-[9px] text-green-400 font-bold">
                    +5 pts
                  </span>
                </div>
              </div>
            </div>
          </PhoneFrame>
        );
    }
  }

  /* ---- Render Step Action Panel ---- */

  function renderAction() {
    switch (step) {
      case 1:
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Step 1 of 5
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                An AI agent (<span className="text-blue-400 font-medium">ShelfWatch</span>) needs the real shelf price at
                Monoprix. No API for that. It posts a $3 bounty for someone nearby.
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
                  Posting bounty...
                </span>
              ) : (
                "Post Bounty as AI Agent"
              )}
            </button>
          </div>
        );

      case 2:
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Step 2 of 5
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                A <span className="text-[#00C853] font-medium">verified person</span> nearby claims the bounty. They get a
                briefing: what to photograph, where to find it.
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
                  Claiming bounty...
                </span>
              ) : (
                "Claim Bounty as Verified Human"
              )}
            </button>
          </div>
        );

      case 3:
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Step 3 of 5
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                Upload a photo as proof. The system checks it automatically and may ask a follow-up question if anything is unclear.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 rounded-xl text-sm font-medium border border-dashed border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300 transition-all flex items-center justify-center gap-2"
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
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
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
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-semibold bg-purple-500 text-white active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting proof...
                </span>
              ) : (
                "Submit Proof Photo"
              )}
            </button>
          </div>
        );

      case 4:
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Step 4 of 5
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                The photo is checked against the task requirements. If the result is borderline, a follow-up question appears in the chat.
              </p>
            </div>

            {task?.aiFollowUp?.status === "pending" ? (
              <>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  <p className="text-[10px] text-amber-400 uppercase tracking-wider font-medium mb-1">
                    Follow-Up Question
                  </p>
                  <p className="text-xs text-amber-200/70 italic">
                    &ldquo;{task.aiFollowUp.question}&rdquo;
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
                    className="px-4 min-h-[44px] rounded-xl text-sm font-semibold bg-green-500 text-black active:scale-[0.98] transition-all disabled:opacity-40 shrink-0"
                  >
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin inline-block" />
                    ) : (
                      "Send"
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-gray-600 text-center">
                  Tip: Reference specific details from the photo for best results
                </p>
              </>
            ) : (
              <button
                onClick={() => setStep(5)}
                className="w-full py-3 min-h-[48px] rounded-xl text-sm font-semibold bg-green-500 text-black active:scale-[0.98] transition-all"
              >
                Continue to Payment
              </button>
            )}
          </div>
        );

      case 5:
        return (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                Step 5 of 5
              </p>
              <p className="text-xs text-gray-300 leading-relaxed">
                Payment is released automatically. The full history is recorded in an
                encrypted <span className="text-cyan-400 font-medium">chat thread</span>: bounty posted, claimed, verified, paid.
              </p>
            </div>

            {/* Verdict card */}
            {task?.verificationResult && (
              <div
                className="rounded-xl p-3 border"
                style={{
                  backgroundColor:
                    task.verificationResult.verdict === "pass"
                      ? "rgba(34,197,94,0.08)"
                      : task.verificationResult.verdict === "flag"
                        ? "rgba(245,158,11,0.08)"
                        : "rgba(239,68,68,0.08)",
                  borderColor:
                    task.verificationResult.verdict === "pass"
                      ? "rgba(34,197,94,0.2)"
                      : task.verificationResult.verdict === "flag"
                        ? "rgba(245,158,11,0.2)"
                        : "rgba(239,68,68,0.2)",
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Final Verdict
                  </span>
                  <span
                    className="text-sm font-bold"
                    style={{
                      color:
                        task.verificationResult.verdict === "pass"
                          ? "#22c55e"
                          : task.verificationResult.verdict === "flag"
                            ? "#f59e0b"
                            : "#ef4444",
                    }}
                  >
                    {task.verificationResult.verdict.toUpperCase()}{" "}
                    {Math.round(task.verificationResult.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[10px] text-gray-500 italic leading-relaxed">
                  &ldquo;{task.verificationResult.reasoning}&rdquo;
                </p>
                {task.attestationTxHash && (
                  <a
                    href={`https://worldscan.org/tx/${task.attestationTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 font-medium mt-2 inline-block hover:underline"
                  >
                    View on-chain attestation {"→"}
                  </a>
                )}
              </div>
            )}

            {/* CTAs */}
            <Link
              href="/"
              className="w-full text-center py-3 min-h-[48px] flex items-center justify-center rounded-xl text-sm font-semibold bg-blue-500 text-white active:scale-[0.98] transition-all"
            >
              Browse Live Bounties
            </Link>

            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/dashboard"
                className="text-center py-2.5 min-h-[44px] flex items-center justify-center rounded-xl text-xs font-medium bg-[#111] border border-white/[0.06] text-gray-300 hover:text-white active:scale-[0.98] transition-all"
              >
                Dashboard
              </Link>
              <Link
                href="/xmtp"
                className="text-center py-2.5 min-h-[44px] flex items-center justify-center rounded-xl text-xs font-medium bg-[#111] border border-white/[0.06] text-gray-300 hover:text-white active:scale-[0.98] transition-all"
              >
                Chat Bot
              </Link>
            </div>

            <button
              onClick={() => {
                setStep(1);
                setTask(null);
                setMessages([]);
                setProofFile(null);
                setProofPreview(null);
                setProofNote("");
                setFollowUpReply("");
                setError(null);
              }}
              className="w-full py-3 min-h-[48px] rounded-xl text-sm font-medium border border-white/[0.06] text-gray-500 hover:text-white transition-colors"
            >
              Run Demo Again
            </button>
          </div>
        );
    }
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-[#050505] text-white flex flex-col max-w-lg mx-auto overflow-hidden -mb-16">
      {/* Header */}
      <div className="shrink-0 bg-[#050505] border-b border-white/5">
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
            How RELAY Works
          </h1>
          <div className="w-12" />
        </div>

        {/* Step progress bar */}
        <div className="flex items-center gap-1 px-4 pb-3">
          {ALL_STEPS.map((s) => {
            const meta = STEP_META[s];
            const isActive = s === step;
            const isDone = s < step;
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full h-1.5 rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: isDone
                      ? "#22c55e"
                      : isActive
                        ? meta.color
                        : "rgba(255,255,255,0.06)",
                  }}
                />
                <span
                  className="text-[8px] uppercase tracking-wider font-medium transition-colors truncate max-w-full text-center"
                  style={{
                    color: isDone
                      ? "#22c55e"
                      : isActive
                        ? meta.color
                        : "#333",
                  }}
                >
                  {meta.shortTitle}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Step title */}
        <div className="px-4 pt-3 pb-2 animate-[fadeIn_0.3s_ease-out]">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: `${STEP_META[step].color}15`,
                color: STEP_META[step].color,
              }}
            >
              {step}/5
            </span>
            <h2 className="text-sm font-bold">{STEP_META[step].title}</h2>
          </div>
        </div>

        {/* Visual mockup */}
        <div className="px-4 py-2">{renderStepVisual()}</div>

        {/* Chat messages (if any) */}
        {messages.length > 0 && (
          <div className="px-4 py-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-medium mb-2">
              Task Chat
            </p>
            <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto rounded-xl bg-[#0a0a0a] border border-white/[0.04] p-3">
              {messages.map(renderMessage)}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom action panel — always visible */}
      <div className="shrink-0 bg-[#0a0a0a] border-t border-white/5 px-4 py-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}
        {renderAction()}
      </div>
    </div>
  );
}
