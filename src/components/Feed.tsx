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
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function shortId(id: string): string {
  if (id.startsWith("dev_")) return id;
  if (id.startsWith("0x")) return `${id.slice(0, 6)}...${id.slice(-4)}`;
  return id.slice(0, 12);
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

  return (
    <div className="flex flex-col gap-3 p-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">RELAY</h1>
          {userId && (
            <button onClick={onLogout} className="text-xs text-gray-500 hover:text-gray-300">
              {shortId(userId)}
            </button>
          )}
        </div>
        {userId && (
          <button
            onClick={() => setView("post")}
            className="bg-white text-black px-4 py-2 rounded-lg font-medium text-sm active:scale-95 transition-transform"
          >
            + Request
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
        {(["available", "mine", "completed"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              tab === t ? "bg-gray-700 text-white" : "text-gray-400"
            }`}
          >
            {t === "available" ? "Nearby" : t === "mine" ? "Yours" : "Done"}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-gray-500 py-12 text-sm">
          {tab === "available" ? "No requests nearby. Post one." :
           tab === "mine" ? "Nothing yet." :
           "No completed requests."}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((task) => (
          <TaskCard
            key={task.id}
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
        ))}
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
    <div onClick={onTap} className="border border-gray-800 rounded-xl p-4 flex flex-col gap-3 bg-gray-950 cursor-pointer active:bg-gray-900 transition-colors">
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-snug">{task.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500">{task.location}</span>
            <span className="text-xs text-gray-600">·</span>
            <span className="text-xs text-gray-500">{timeLeft(task.deadline)}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-green-400 text-sm">${task.bountyUsdc}</p>
          <p className="text-[10px] text-gray-500">USDC</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <StatusBadge status={task.status} />
        {isOwnTask && <span className="text-[10px] text-gray-600">You posted</span>}
        {isClaimant && task.status === "claimed" && <span className="text-[10px] text-gray-600">You claimed</span>}
      </div>

      {task.verificationResult && (
        <div className={`text-xs p-2.5 rounded-lg ${
          task.verificationResult.verdict === "pass" ? "bg-green-900/20 text-green-300 border border-green-800/30" :
          task.verificationResult.verdict === "flag" ? "bg-yellow-900/20 text-yellow-300 border border-yellow-800/30" :
          "bg-red-900/20 text-red-300 border border-red-800/30"
        }`}>
          <span className="font-bold">{task.verificationResult.verdict.toUpperCase()}</span>
          {" — "}
          {task.verificationResult.reasoning}
        </div>
      )}

      {task.status === "open" && userId && !isOwnTask && (
        <button
          onClick={(e) => { e.stopPropagation(); onClaim(); }}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium active:scale-[0.98] transition-transform"
        >
          Claim This Task
        </button>
      )}

      {task.status === "claimed" && isClaimant && (
        <button
          onClick={(e) => { e.stopPropagation(); onSubmitProof(); }}
          className="bg-purple-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium active:scale-[0.98] transition-transform"
        >
          Submit Proof
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    claimed: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    expired: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase tracking-wider ${styles[status] || styles.expired}`}>
      {status}
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

    // On-chain escrow deposit if inside World App and contract is deployed
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

  return (
    <div className="p-4 flex flex-col gap-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Post a Request</h2>
        <button onClick={onCancel} className="text-gray-400 text-sm">Cancel</button>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">What do you need?</label>
          <textarea
            placeholder="Be specific. Example: Take a photo of the menu board at the coffee shop on Rue de Rivoli."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-gray-600"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Location</label>
          <input
            type="text"
            placeholder="City or area"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-600"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Bounty (USDC)</label>
          <input
            type="number"
            placeholder="5"
            value={bounty}
            onChange={(e) => setBounty(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-600"
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!description || !location || !bounty || submitting}
        className="bg-white text-black px-4 py-3 rounded-lg font-medium text-sm disabled:opacity-40 active:scale-[0.98] transition-transform"
      >
        {submitting ? "Posting..." : `Post Task — $${bounty || "0"} USDC`}
      </button>
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
    <div className="p-4 flex flex-col gap-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Submit Proof</h2>
        <button onClick={onCancel} className="text-gray-400 text-sm">Cancel</button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Task</p>
        <p className="text-sm">{task.description}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-gray-500">{task.location}</span>
          <span className="text-xs text-gray-600">·</span>
          <span className="text-xs text-green-400 font-medium">${task.bountyUsdc} USDC</span>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-2">Proof Photo</label>
        {imagePreview ? (
          <div className="relative">
            <img src={imagePreview} alt="Proof preview" className="w-full rounded-lg border border-gray-800 max-h-64 object-cover" />
            <button
              onClick={() => { setImageData(null); setImagePreview(null); }}
              className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded"
            >
              Remove
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-700 rounded-lg p-6 cursor-pointer hover:border-gray-600 transition-colors">
            <span className="text-gray-400 text-sm">Tap to take a photo or choose one</span>
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
        placeholder="Optional note about the proof"
        value={proofNote}
        onChange={(e) => setProofNote(e.target.value)}
        className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-600"
      />

      {submitting && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400 animate-pulse">AI is verifying your proof...</p>
        </div>
      )}

      {result && (
        <div className={`p-5 rounded-xl text-sm border animate-[fadeIn_0.3s_ease-in] ${
          result.verdict === "pass" ? "bg-green-900/20 text-green-300 border-green-500/40" :
          result.verdict === "flag" ? "bg-yellow-900/20 text-yellow-300 border-yellow-500/40" :
          "bg-red-900/20 text-red-300 border-red-500/40"
        }`}>
          <p className="font-bold text-xl tracking-tight">
            {result.verdict === "pass" ? "VERIFIED" : result.verdict === "flag" ? "FLAGGED" : "REJECTED"}
          </p>
          <p className="mt-2 text-xs opacity-80 leading-relaxed">{result.reasoning}</p>
          {result.verdict === "pass" && (
            <div className="mt-3 pt-3 border-t border-green-800/30">
              <p className="font-medium text-sm">${task.bountyUsdc} USDC released to you.</p>
            </div>
          )}
          {result.verdict === "flag" && (
            <p className="mt-2 text-xs">Waiting for poster to review...</p>
          )}
          {result.verdict === "fail" && (
            <p className="mt-2 text-xs">Task reopened for new claims.</p>
          )}
        </div>
      )}

      {!result && !submitting && (
        <button
          onClick={handleSubmit}
          disabled={!imageData}
          className="bg-purple-600 text-white px-4 py-3 rounded-lg font-medium text-sm disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          Submit Proof
        </button>
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
    <div className="p-4 flex flex-col gap-4 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-gray-400 text-sm">Back</button>
        <StatusBadge status={currentTask.status} />
      </div>

      <div>
        <p className="font-medium">{currentTask.description}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500">{currentTask.location}</span>
          <span className="text-xs text-gray-600">·</span>
          <span className="text-xs text-green-400 font-medium">${currentTask.bountyUsdc} USDC</span>
          <span className="text-xs text-gray-600">·</span>
          <span className="text-xs text-gray-500">{timeLeft(currentTask.deadline)}</span>
        </div>
      </div>

      {currentTask.poster && (
        <div className="text-xs text-gray-500">
          Posted by {shortId(currentTask.poster)}
          {currentTask.claimant && ` · Claimed by ${shortId(currentTask.claimant)}`}
        </div>
      )}

      {currentTask.verificationResult && (
        <div className={`text-xs p-3 rounded-lg border ${
          currentTask.verificationResult.verdict === "pass" ? "bg-green-900/20 text-green-300 border-green-800/30" :
          currentTask.verificationResult.verdict === "flag" ? "bg-yellow-900/20 text-yellow-300 border-yellow-800/30" :
          "bg-red-900/20 text-red-300 border-red-800/30"
        }`}>
          <span className="font-bold">{currentTask.verificationResult.verdict.toUpperCase()}</span>
          {" — "}{currentTask.verificationResult.reasoning}
        </div>
      )}

      {currentTask.status === "claimed" && isClaimant && !isFlagged && (
        <button
          onClick={onSubmitProof}
          className="bg-purple-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium active:scale-[0.98] transition-transform"
        >
          Submit Proof
        </button>
      )}

      {isFlagged && isPoster && (
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
            className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium active:scale-[0.98] transition-transform"
          >
            Approve
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
            className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium active:scale-[0.98] transition-transform"
          >
            Reject
          </button>
        </div>
      )}

      {messages.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">XMTP Thread</p>
          {messages.map((msg) => (
            <div key={msg.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium text-blue-400">
                  {msg.sender === "relay-bot" ? "RELAY Bot" : shortId(msg.sender)}
                </span>
                <span className="text-[10px] text-gray-600">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-xs text-gray-300 whitespace-pre-line">{msg.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
