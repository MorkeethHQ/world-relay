"use client";

import { useState, useEffect, useCallback } from "react";
import { hapticTap, hapticSuccess, hapticError } from "@/lib/minikit-helpers";

// PREDICTIONS — stake points on an outcome, winners split the pool pro-rata.
// Wears the campaign-hero visual language (dark header strip) since these are
// few and curated. Points only.
type ApiPrediction = {
  id: string;
  question: string;
  options: string[];
  locksAt: string;
  status: "open" | "resolved" | "void";
  outcome: string | null;
  locked: boolean;
  pools: Record<string, number>;
  stakers: number;
  myStake: { option: string; amount: number } | null;
};

const STAKE_CHIPS = [5, 10, 25, 50];

function locksIn(locksAt: string): string {
  const ms = new Date(locksAt).getTime() - Date.now();
  if (ms <= 0) return "Locked";
  const days = Math.floor(ms / 86400_000);
  if (days > 0) return `Locks in ${days}d`;
  const hours = Math.floor(ms / 3600_000);
  if (hours > 0) return `Locks in ${hours}h`;
  return `Locks in ${Math.max(1, Math.floor(ms / 60_000))}m`;
}

function PredictionCard({ p, userId, onStaked }: { p: ApiPrediction; userId: string | null; onStaked: () => void }) {
  const [option, setOption] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const total = Object.values(p.pools).reduce((s, v) => s + v, 0);
  const showPools = !!p.myStake || p.locked || p.status !== "open";
  const canStake = !p.locked && p.status === "open" && !p.myStake && !!userId;

  const stake = async () => {
    if (!userId || !option || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/predictions/${p.id}/stake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: userId, option, amount }),
      });
      const d = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setMsg(typeof d.error === "string" ? d.error : "Stake failed — try again");
        hapticError();
      } else {
        hapticSuccess();
        onStaked();
      }
    } catch {
      setMsg("Network hiccup — nothing was staked");
      hapticError();
    }
    setBusy(false);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Hero strip */}
      <div className="bg-gray-950 px-5 py-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] font-medium text-white/60 tracking-wide uppercase">Prediction</span>
          <span className="ml-auto text-[10px] text-white/50">{p.status === "resolved" ? "Resolved" : p.status === "void" ? "Voided" : locksIn(p.locksAt)}</span>
        </div>
        <p className="text-[15px] font-bold text-white leading-snug">{p.question}</p>
        <p className="text-[11px] text-white/50 mt-1">
          {total > 0 ? `${total} pts staked · ${p.stakers} ${p.stakers === 1 ? "staker" : "stakers"}` : "Be the first to stake"}
          {p.myStake ? ` · you: ${p.myStake.amount} pts on ${p.myStake.option}` : ""}
        </p>
      </div>

      <div className="p-4 flex flex-col gap-2">
        {p.options.map((opt) => {
          const pool = p.pools[opt] || 0;
          const pct = total > 0 ? Math.round((pool / total) * 100) : 0;
          const isMine = p.myStake?.option === opt;
          const isOutcome = p.outcome === opt;
          const isPicked = option === opt;

          if (showPools) {
            return (
              <div key={opt} className={`relative rounded-xl overflow-hidden border ${isOutcome ? "border-green-300 bg-green-50" : "border-gray-100 bg-gray-50"}`}>
                <div className="absolute inset-y-0 left-0 bg-amber-600 opacity-10 transition-all duration-700" style={{ width: `${pct}%` }} />
                <div className="relative flex items-center justify-between px-4 py-3">
                  <span className={`text-sm ${isOutcome || isMine ? "font-semibold text-gray-900" : "text-gray-600"}`}>
                    {opt}{isMine ? " · yours" : ""}{isOutcome ? " · winner" : ""}
                  </span>
                  <span className="text-sm font-semibold text-gray-400 tabular-nums">{pct}%</span>
                </div>
              </div>
            );
          }

          return (
            <button
              key={opt}
              onClick={() => { hapticTap(); setOption(opt); }}
              disabled={!canStake}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition-all active:scale-[0.98] min-h-[48px] ${
                isPicked ? "border-gray-900 bg-gray-900 text-white font-medium" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              } ${!canStake ? "opacity-50" : ""}`}
            >
              {opt}
            </button>
          );
        })}

        {canStake && option && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center gap-2">
              {STAKE_CHIPS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => { hapticTap(); setAmount(amt); }}
                  className={`flex-1 rounded-xl border py-2.5 text-center text-[14px] font-semibold transition-all active:scale-[0.97] ${
                    amount === amt ? "border-amber-600 bg-amber-50 text-amber-700" : "border-gray-200 bg-white text-gray-500"
                  }`}
                >
                  {amt}
                </button>
              ))}
            </div>
            {/* Stake amount on its own full-width row so it's legible, not crammed
                into a narrow dark chip (Oscar live-test Jul 8). */}
            <button
              onClick={stake}
              disabled={busy}
              className="w-full bg-gray-900 text-white rounded-xl py-3.5 text-[16px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {busy ? "..." : `Stake ${amount}`}
            </button>
          </div>
        )}
        {canStake && option && (
          <p className="text-[10px] text-gray-400">Stakes are final. Winners split the whole pool by stake size.</p>
        )}
        {msg && <p className="text-[11px] text-red-600">{msg}</p>}
      </div>
    </div>
  );
}

export function PredictionsSection({ userId }: { userId: string | null }) {
  const [predictions, setPredictions] = useState<ApiPrediction[]>([]);

  const load = useCallback(() => {
    fetch(`/api/predictions${userId ? `?address=${encodeURIComponent(userId)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setPredictions(d.predictions || []))
      .catch(() => {});
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Open first (closest lock first via API order), resolved/void after.
  const open = predictions.filter((p) => p.status === "open");
  const done = predictions.filter((p) => p.status !== "open");
  if (predictions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      {[...open, ...done].map((p) => (
        <PredictionCard key={p.id} p={p} userId={userId} onStaked={load} />
      ))}
    </div>
  );
}
