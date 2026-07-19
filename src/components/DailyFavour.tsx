"use client";

import { useState, useEffect, useCallback } from "react";
import { hapticTap, hapticSuccess, hapticError } from "@/lib/minikit-helpers";

// THE TOP FAVOUR — the daily gate.
//
// Three beats: GUESS what the world will say -> ANSWER for yourself -> REVEAL.
// The guess is captured before anything is shown, which is the only reason the
// reveal has stakes. Results stay locked until you have contributed (enforced
// server-side in lib/daily.getResults, not here).
//
// Design: dark hero strip like Predictions since this is curated and singular.
// Points amber, ink gray-900, no blue/purple, 44px targets. DESIGN-SYSTEM.md.

type Prompt = {
  date: string;
  question: string;
  type: "choice" | "number";
  options?: string[];
  unit?: string;
  hint?: string;
  fact?: string; // only present once you have answered
};

type Results = {
  total: number;
  distribution: Record<string, number>;
  median?: number;
  yourAnswer: string;
  yourGuess: string;
  guessWasClose: boolean;
  verdict: string;
  percentile?: number;
};

type DailyState = {
  date: string;
  prompt: Prompt;
  submitted: boolean;
  yourAnswer?: string | null;
  results: Results | null;
  streak: number;
};

type Beat = "guess" | "answer" | "reveal";

export default function DailyFavour({
  userId,
  onDone,
}: {
  userId: string | null;
  onDone?: () => void;
}) {
  const [state, setState] = useState<DailyState | null>(null);
  const [beat, setBeat] = useState<Beat>("guess");
  const [guess, setGuess] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [awarded, setAwarded] = useState<number | null>(null);

  const load = useCallback(async () => {
    const qs = userId ? `?address=${userId}` : "";
    const res = await fetch(`/api/daily${qs}`);
    if (!res.ok) return;
    const data: DailyState = await res.json();
    setState(data);
    if (data.submitted) setBeat("reveal");
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) {
    return <div className="h-32 rounded-2xl bg-gray-100 animate-pulse" />;
  }

  const { prompt, results, streak } = state;
  const isChoice = prompt.type === "choice";

  const submit = async () => {
    if (!userId || busy || !answer) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userId, answer, guess }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          // Already done today — jump straight to the reveal rather than
          // scolding them for a double tap.
          hapticTap();
          await load();
          setBeat("reveal");
          return;
        }
        hapticError();
        setMsg(data.error || "Could not submit");
        return;
      }
      hapticSuccess();
      setAwarded(data.pointsAwarded ?? null);
      setState((s) =>
        s
          ? { ...s, submitted: true, results: data.results, streak: data.streak, prompt: data.prompt ?? s.prompt }
          : s,
      );
      setBeat("reveal");
      onDone?.();
    } catch {
      hapticError();
      setMsg("Could not submit. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const chip = (value: string, selected: boolean, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        hapticTap();
        onClick();
      }}
      className={`min-h-[44px] px-4 rounded-xl border text-[14px] font-medium transition-colors active:scale-[0.98] ${
        selected
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-900 border-gray-200 hover:border-gray-400"
      }`}
    >
      {value}
    </button>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Hero */}
      <div className="bg-gray-950 px-5 py-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] font-medium text-white/60 tracking-wide uppercase">
            Top favour
          </span>
          {streak > 0 && (
            <span className="ml-auto text-[10px] text-white/50 tabular-nums">
              {streak} day{streak === 1 ? "" : "s"} in a row
            </span>
          )}
        </div>
        <p className="text-[15px] font-bold text-white leading-snug">{prompt.question}</p>
        <p className="text-[11px] text-white/50 mt-1">
          {beat === "reveal"
            ? `${results?.total ?? 0} ${results?.total === 1 ? "person" : "people"} answered today`
            : "Everyone on earth gets the same question today"}
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* BEAT 1 — the guess, before they see anything */}
        {beat === "guess" && (
          <>
            <p className="text-[14px] text-gray-900 font-medium">
              First: what do you think the world will say?
            </p>
            {prompt.hint && <p className="text-[12px] text-gray-400 -mt-1">{prompt.hint}</p>}
            {isChoice ? (
              <div className="flex flex-wrap gap-2">
                {(prompt.options || []).map((o) => chip(o, guess === o, () => setGuess(o), o))}
              </div>
            ) : (
              <input
                inputMode="decimal"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder={prompt.unit ? `Number of ${prompt.unit}` : "Your guess"}
                className="min-h-[44px] px-4 rounded-xl border border-gray-200 text-[14px] tabular-nums focus:outline-none focus:border-gray-900"
              />
            )}
            <button
              type="button"
              disabled={!guess}
              onClick={() => {
                hapticTap();
                setBeat("answer");
              }}
              className="min-h-[44px] rounded-xl bg-gray-900 text-white text-[14px] font-medium disabled:opacity-30 active:scale-[0.98]"
            >
              Lock it in
            </button>
          </>
        )}

        {/* BEAT 2 — their own answer */}
        {beat === "answer" && (
          <>
            <p className="text-[14px] text-gray-900 font-medium">Now your own answer.</p>
            <p className="text-[12px] text-gray-400 -mt-1">
              You guessed the world would say &ldquo;{guess}&rdquo;.
            </p>
            {isChoice ? (
              <div className="flex flex-wrap gap-2">
                {(prompt.options || []).map((o) => chip(o, answer === o, () => setAnswer(o), o))}
              </div>
            ) : (
              <input
                inputMode="decimal"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={prompt.unit ? `Number of ${prompt.unit}` : "Your answer"}
                className="min-h-[44px] px-4 rounded-xl border border-gray-200 text-[14px] tabular-nums focus:outline-none focus:border-gray-900"
              />
            )}
            {msg && <p className="text-[12px] text-red-600">{msg}</p>}
            {!userId && (
              <p className="text-[12px] text-gray-400">Sign in to do today&rsquo;s favour.</p>
            )}
            <button
              type="button"
              disabled={!answer || busy || !userId}
              onClick={submit}
              className="min-h-[44px] rounded-xl bg-gray-900 text-white text-[14px] font-medium disabled:opacity-30 active:scale-[0.98]"
            >
              {busy ? "Sending" : "Answer and reveal"}
            </button>
          </>
        )}

        {/* BEAT 3 — the boom */}
        {beat === "reveal" && results && (
          <>
            <p className="text-[15px] font-semibold text-gray-900 leading-snug">{results.verdict}</p>

            {results.guessWasClose && (
              <p className="text-[12px] text-amber-600 font-medium">
                You called it. Your guess was close.
              </p>
            )}

            <div className="flex flex-col gap-1.5 mt-1">
              {Object.entries(results.distribution)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([label, count]) => {
                  const pct = results.total ? Math.round((count / results.total) * 100) : 0;
                  const isYours = label === results.yourAnswer;
                  return (
                    <div
                      key={label}
                      className={`relative rounded-xl overflow-hidden border ${
                        isYours ? "border-gray-900" : "border-gray-100 bg-gray-50"
                      }`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-amber-600 opacity-10 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                      <div className="relative flex items-center justify-between px-4 py-3">
                        <span className="text-[14px] text-gray-900">
                          {label}
                          {isYours && <span className="text-[11px] text-gray-400 ml-2">you</span>}
                        </span>
                        <span className="text-[14px] font-bold text-gray-900 tabular-nums">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {prompt.fact && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 mt-1">
                <p className="text-[10px] font-medium text-gray-400 tracking-wide uppercase mb-1">
                  Today&rsquo;s fact
                </p>
                <p className="text-[13px] text-gray-900 leading-relaxed">{prompt.fact}</p>
              </div>
            )}

            {awarded !== null && (
              <p className="text-[12px] text-amber-600 font-medium tabular-nums">
                +{awarded} pts
                {streak >= 3 ? ` · ${streak} day streak` : ""}
              </p>
            )}

            <p className="text-[12px] text-gray-400">
              Come back tomorrow for a new question. The favours below are open now.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
