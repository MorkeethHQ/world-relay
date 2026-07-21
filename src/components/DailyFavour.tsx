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

type Beat = "answer" | "guess" | "reveal";

export default function DailyFavour({
  userId,
  onDone,
  onReauth,
}: {
  userId: string | null;
  onDone?: () => void;
  // Existing users are signed in from localStorage but hold no session cookie,
  // so a strict route 403s them. Re-running wallet auth mints one.
  onReauth?: () => void;
}) {
  const [state, setState] = useState<DailyState | null>(null);
  const [beat, setBeat] = useState<Beat>("answer");
  const [guess, setGuess] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [awarded, setAwarded] = useState<number | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  // Done EARLIER (loaded already-submitted) collapses to a one-line summary.
  // Done JUST NOW stays open, because the reveal is the payoff they earned.
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = userId ? `?address=${userId}` : "";
      const res = await fetch(`/api/daily${qs}`);
      if (!res.ok) return;
      const data: DailyState = await res.json();
      setState(data);
      if (data.submitted) setBeat("reveal");
    } catch {
      // Offline or a bad response — surfaced elsewhere; do not leave an
      // unhandled rejection or crash the load, and the skeleton below still
      // gives a visible (if stuck) state instead of a silent white card.
    }
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
        if (res.status === 403) {
          // Not a failure they caused: their sign-in predates the session
          // cookie. Offer the one tap that fixes it.
          setNeedsAuth(true);
          setMsg(null);
          return;
        }
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
      setExpanded(true);
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

  // Already done today: a slim strip, not a hero. Tap to reopen the reveal.
  if (beat === "reveal" && results && !expanded) {
    return (
      <button
        type="button"
        onClick={() => { hapticTap(); setExpanded(true); }}
        className="w-full text-left rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-amber-700 tracking-wide uppercase">
            Today&rsquo;s favour &middot; done
          </p>
          <p className="text-[13px] text-gray-900 truncate mt-0.5">{results.verdict}</p>
        </div>
        <span className="text-[11px] text-amber-700 font-semibold shrink-0 tabular-nums">
          {streak > 0 ? `${streak}d` : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-3xl overflow-hidden border border-amber-200/70 bg-gradient-to-b from-amber-50 to-white shadow-sm">
      {/* Hero. Deliberately AMBER, not the gray-950 strip every other card wears:
          this is the one surface everybody meets first, and amber is already the
          canonical points colour (DESIGN-SYSTEM.md), so it reads as its own place
          without inventing an off-system hue. */}
      <div className="px-5 pt-5 pb-4">
        {/* No pulsing status dot. A blinking amber light is a named slop tell
            (observability-console theater) — semantic colour is fine, making it
            twinkle is not. The label carries it. */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] font-semibold text-amber-700 tracking-wide uppercase">
            Today&rsquo;s favour
          </span>
          {streak > 0 && (
            <span className="ml-auto text-[10px] font-medium text-amber-700/70 tabular-nums">
              {streak} day{streak === 1 ? "" : "s"} in a row
            </span>
          )}
        </div>

        {/* Bigger. This is the first thing anyone sees in the app. */}
        <p className="text-[22px] font-bold text-gray-900 leading-[1.2] tracking-tight">
          {prompt.question}
        </p>
        <p className="text-[12px] text-gray-500 mt-1.5">
          {beat === "reveal"
            ? `${results?.total ?? 0} ${results?.total === 1 ? "person" : "people"} answered today`
            : prompt.hint || "Everyone on earth gets this same question today"}
        </p>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-3">
        {/* BEAT 1 — ANSWER. No preamble, no toll: the options are tappable the
            instant the card renders. Answering about yourself is the natural
            first act; guessing the world is the fun second beat. */}
        {beat === "answer" && (
          <>
            {isChoice ? (
              <div className="flex flex-col gap-2">
                {(prompt.options || []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => {
                      hapticTap();
                      setAnswer(o);
                      setBeat("guess");
                    }}
                    className="min-h-[52px] px-4 rounded-2xl border border-gray-200 bg-white text-[16px] font-medium text-gray-900 text-left transition-colors hover:border-gray-900 active:scale-[0.99]"
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <input
                  inputMode="decimal"
                  autoFocus
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={prompt.unit ? `Number of ${prompt.unit}` : "Your answer"}
                  className="min-h-[52px] px-4 rounded-2xl border border-gray-200 bg-white text-[18px] font-medium tabular-nums focus:outline-none focus:border-gray-900"
                />
                <button
                  type="button"
                  disabled={!answer}
                  onClick={() => {
                    hapticTap();
                    setBeat("guess");
                  }}
                  className="min-h-[52px] rounded-2xl bg-gray-900 text-white text-[15px] font-semibold disabled:opacity-25 active:scale-[0.99]"
                >
                  Next
                </button>
              </>
            )}
          </>
        )}

        {/* BEAT 2 — GUESS the world. Now it is a game, not an entry fee. */}
        {beat === "guess" && (
          <>
            <p className="text-[15px] font-semibold text-gray-900">
              Now the fun part: what will everyone else say?
            </p>
            <p className="text-[12px] text-gray-500 -mt-1.5">
              You said &ldquo;{answer}&rdquo;. Guess right and you earn more.
            </p>
            {isChoice ? (
              <div className="flex flex-wrap gap-2">
                {(prompt.options || []).map((o) => chip(o, guess === o, () => setGuess(o), o))}
              </div>
            ) : (
              <input
                inputMode="decimal"
                autoFocus
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="What will the world's median be?"
                className="min-h-[52px] px-4 rounded-2xl border border-gray-200 bg-white text-[18px] font-medium tabular-nums focus:outline-none focus:border-gray-900"
              />
            )}

            {needsAuth ? (
              <>
                <p className="text-[13px] text-gray-900 font-medium">
                  One tap to verify and you&rsquo;re in.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    hapticTap();
                    onReauth?.();
                  }}
                  className="min-h-[52px] rounded-2xl bg-gray-900 text-white text-[15px] font-semibold active:scale-[0.99]"
                >
                  Verify and answer
                </button>
              </>
            ) : (
              <>
                {msg && <p className="text-[12px] text-red-600">{msg}</p>}
                {!userId && (
                  <p className="text-[12px] text-gray-500">Sign in to do today&rsquo;s favour.</p>
                )}
                <button
                  type="button"
                  disabled={!guess || busy || !userId}
                  onClick={submit}
                  className="min-h-[52px] rounded-2xl bg-gray-900 text-white text-[15px] font-semibold disabled:opacity-25 active:scale-[0.99]"
                >
                  {busy ? "Sending" : "Reveal the world"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    hapticTap();
                    setBeat("answer");
                  }}
                  className="text-[12px] text-gray-500 underline underline-offset-2"
                >
                  Change my answer
                </button>
              </>
            )}
          </>
        )}

        {/* BEAT 3 — the boom */}
        {beat === "reveal" && results && (
          <>
            <p className="text-[17px] font-bold text-gray-900 leading-snug">{results.verdict}</p>

            {results.guessWasClose && (
              <p className="text-[13px] text-amber-700 font-semibold">
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
                      className={`relative rounded-2xl overflow-hidden border ${
                        isYours ? "border-gray-900 bg-white" : "border-gray-100 bg-white"
                      }`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-amber-500 opacity-20 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                      <div className="relative flex items-center justify-between px-4 py-3.5">
                        <span className="text-[15px] text-gray-900">
                          {label}
                          {isYours && <span className="text-[11px] text-gray-400 ml-2">you</span>}
                        </span>
                        <span className="text-[15px] font-bold text-gray-900 tabular-nums">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {prompt.fact && (
              <div className="rounded-2xl bg-white border border-amber-200/70 px-4 py-3 mt-1">
                <p className="text-[10px] font-semibold text-amber-700 tracking-wide uppercase mb-1">
                  Today&rsquo;s fact
                </p>
                <p className="text-[13px] text-gray-900 leading-relaxed">{prompt.fact}</p>
              </div>
            )}

            {awarded !== null && (
              <p className="text-[13px] text-amber-700 font-semibold tabular-nums">
                +{awarded} pts{streak >= 3 ? ` · ${streak} day streak` : ""}
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-[12px] text-gray-500">New question tomorrow.</p>
              <button
                type="button"
                onClick={() => { hapticTap(); setExpanded(false); }}
                className="text-[12px] text-gray-500 underline underline-offset-2 min-h-[44px]"
              >
                Hide
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
