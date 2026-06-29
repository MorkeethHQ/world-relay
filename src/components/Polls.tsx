"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Typography, Input, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { hapticTap, hapticSuccess } from "@/lib/minikit-helpers";

type Poll = {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  creator: string;
  category: string;
  createdAt: string;
  endsAt: string;
  totalVotes: number;
  voterCount: number;
};

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const days = Math.floor(ms / (24 * 3600_000));
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(ms / 3600_000);
  if (hours > 0) return `${hours}h left`;
  return `${Math.floor(ms / 60_000)}m left`;
}

const POLL_COLORS = [
  { bar: "bg-gray-900", text: "text-gray-900" },
  { bar: "bg-info-600", text: "text-info-600" },
  { bar: "bg-success-600", text: "text-success-600" },
  { bar: "bg-warning-600", text: "text-warning-600" },
];

function PollCard({
  poll,
  userId,
  onVote,
}: {
  poll: Poll;
  userId: string | null;
  onVote: (pollId: string, option: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [localVotes, setLocalVotes] = useState(poll.votes);
  const [localTotal, setLocalTotal] = useState(poll.totalVotes);
  const isEnded = new Date(poll.endsAt).getTime() < Date.now();
  const showResults = hasVoted || isEnded;

  const maxVotes = Math.max(...Object.values(localVotes), 1);

  const handleVote = (option: string) => {
    if (hasVoted || isEnded || !userId) return;
    hapticTap();
    setSelected(option);
  };

  const confirmVote = () => {
    if (!selected || !userId) return;
    hapticSuccess();
    setLocalVotes((prev) => ({ ...prev, [selected]: (prev[selected] || 0) + 1 }));
    setLocalTotal((prev) => prev + 1);
    setHasVoted(true);
    onVote(poll.id, selected);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="p-5 pb-4">
        <p className="text-[15px] font-semibold text-gray-900 leading-snug">{poll.question}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-gray-400">{localTotal} {localTotal === 1 ? "vote" : "votes"}</span>
          <span className="text-xs text-gray-300">&middot;</span>
          <span className="text-xs text-gray-400">{timeLeft(poll.endsAt)}</span>
        </div>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-2">
        {poll.options.map((opt, i) => {
          const count = localVotes[opt] || 0;
          const pct = localTotal > 0 ? Math.round((count / localTotal) * 100) : 0;
          const color = POLL_COLORS[i % POLL_COLORS.length];
          const isSelected = selected === opt;
          const isWinner = showResults && count === maxVotes && count > 0;

          if (showResults) {
            return (
              <div key={opt} className="relative">
                <div className="relative rounded-xl overflow-hidden bg-gray-50 border border-gray-100">
                  <div
                    className={`absolute inset-y-0 left-0 ${color.bar} opacity-10 rounded-xl transition-all duration-700 ease-out`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isWinner && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={color.text}>
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      )}
                      <span className={`text-sm ${isWinner ? "font-semibold text-gray-900" : "text-gray-600"}`}>
                        {opt}
                      </span>
                    </div>
                    <span className={`text-sm font-semibold ${isWinner ? color.text : "text-gray-400"}`}>
                      {pct}%
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <button
              key={opt}
              onClick={() => handleVote(opt)}
              disabled={!userId}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition-all active:scale-[0.98] min-h-[48px] ${
                isSelected
                  ? "border-gray-900 bg-gray-900 text-white font-medium"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              } ${!userId ? "opacity-50" : ""}`}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {!showResults && selected && (
        <div className="px-5 pb-5">
          <Button onClick={confirmVote} variant="primary" fullWidth size="lg">
            Vote
          </Button>
        </div>
      )}
    </div>
  );
}

function CreatePoll({
  userId,
  onCreated,
  onCancel,
}: {
  userId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [submitting, setSubmitting] = useState(false);

  const addOption = () => {
    if (options.length < 4) setOptions([...options, ""]);
  };

  const updateOption = (i: number, val: string) => {
    const next = [...options];
    next[i] = val;
    setOptions(next);
  };

  const isValid = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          options: options.filter((o) => o.trim()).map((o) => o.trim()),
          creator: userId,
          durationHours: 72,
        }),
      });
      hapticSuccess();
      onCreated();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-0 max-w-lg mx-auto w-full min-h-screen bg-gray-50">
      <TopBar
        title="New Poll"
        startAdornment={
          <button onClick={onCancel} className="text-sm text-gray-500 min-h-[44px] flex items-center">
            Cancel
          </button>
        }
        endAdornment={<div className="w-[60px]" />}
      />

      <div className="flex-1 px-6 py-6 flex flex-col gap-5">
        <Input
          label="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
        />

        <div className="flex flex-col gap-2">
          {options.map((opt, i) => (
            <Input
              key={i}
              label={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              maxLength={100}
            />
          ))}
          {options.length < 4 && (
            <button
              onClick={addOption}
              className="mt-1 text-sm text-gray-500 hover:text-gray-900 transition-colors min-h-[44px] flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add option
            </button>
          )}
        </div>

        <div className="mt-auto pt-4">
          <Button onClick={handleSubmit} disabled={!isValid || submitting} variant="primary" fullWidth size="lg">
            {submitting ? "Creating..." : "Create Poll"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PollsFeed({
  userId,
}: {
  userId: string | null;
}) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchPolls = useCallback(async () => {
    try {
      const res = await fetch("/api/polls");
      const data = await res.json();
      setPolls(data.polls || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  const handleVote = async (pollId: string, option: string) => {
    if (!userId) return;
    await fetch(`/api/polls/${pollId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, option }),
    });
  };

  if (creating && userId) {
    return (
      <CreatePoll
        userId={userId}
        onCreated={() => { setCreating(false); fetchPolls(); }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  const active = polls.filter((p) => new Date(p.endsAt).getTime() > Date.now());
  const ended = polls.filter((p) => new Date(p.endsAt).getTime() <= Date.now());

  return (
    <div className="flex flex-col gap-4">
      {/* Create button */}
      {userId && (
        <button
          onClick={() => { hapticTap(); setCreating(true); }}
          className="flex items-center gap-3 bg-white border border-gray-200 border-dashed rounded-2xl px-5 py-4 active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-gray-900">Create a poll</p>
            <p className="text-xs text-gray-400">Ask the community anything</p>
          </div>
        </button>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded w-1/3 mb-4" />
              <div className="flex flex-col gap-2">
                <div className="h-12 bg-gray-50 rounded-xl" />
                <div className="h-12 bg-gray-50 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : polls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 animate-[fadeSlideIn_0.4s_ease-out]">
          <p className="text-[28px] font-bold text-gray-200 tracking-tight">No polls yet</p>
          <p className="text-[14px] text-gray-400">Be the first to ask something</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="flex flex-col gap-3">
              {active.map((poll) => (
                <PollCard key={poll.id} poll={poll} userId={userId} onVote={handleVote} />
              ))}
            </div>
          )}
          {ended.length > 0 && (
            <>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mt-2">Past polls</p>
              <div className="flex flex-col gap-3">
                {ended.map((poll) => (
                  <PollCard key={poll.id} poll={poll} userId={userId} onVote={handleVote} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
