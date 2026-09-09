"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Task } from "@/lib/types";
import { RewardBadge } from "@/components/RewardBadge";
import { isPointsReward, isRealMoney } from "@/lib/reward";
import { ProofSlot } from "@/components/ProofSlot";

// The cold first screen leads with ONE real open favour (2026-09-09).
//
// Why: the first screen used to sell the concept of a marketplace. A stranger
// had to work out what a favour was from an explanation. The fastest way to
// explain a two-sided market is to show one side's actual work, with its reward
// and its proof requirement visible before any scroll.
//
// The favour is the FIRST OPEN TASK in the order the server returns. Board
// order is owned by BOARD-RULES.md + board-rank.ts via orderBoardForApi; this
// component must never re-rank, filter by category, or pick a "nicer" card.
// If the lead card looks wrong, the rules are wrong, and they get fixed there.
//
// Three honest states and no invented one: loading, request failed, and an
// empty board that says the board is empty.

function LeadFrame({ children }: { children: React.ReactNode }) {
  return (
    <section className="w-full rounded-3xl border border-gray-200 bg-white p-5">
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
      {children}
    </p>
  );
}

// What the reward actually is, in words. Points are points.
function rewardTruth(task: Task): string {
  if (isPointsReward(task)) {
    return "Points, not cash. Points are a score inside FAVOUR and do not convert to money.";
  }
  if (isRealMoney(task)) {
    return "Real USDC, escrowed on-chain for this favour before you start.";
  }
  return "Listed in USDC with no escrow funded behind it, so it pays nothing today.";
}

// Why a stranger would come back, derived from the task itself. Never a
// cadence nobody measures.
function returnReason(task: Task): string {
  if (task.recurring && task.recurring.totalRuns > 1) {
    const every = task.recurring.intervalHours;
    const unit = every >= 24 ? `${Math.round(every / 24)} days` : `${every} hours`;
    return `The requester asks for this again every ${unit}, so a pass here is not a one-off.`;
  }
  const left = Math.max(task.maxCompletions - task.completionCount, 0);
  if (task.maxCompletions > 1 && left > 0) {
    // Remaining supply, said as remaining supply. Places left is a reason this
    // is open to you now. It is NOT a reason the same person returns, and
    // dressing it as one would be a claim about a market nobody has measured.
    return `${left} of ${task.maxCompletions} places are still unfilled, so there is room for you on this one today. Places left is availability, not a promise that this ask comes back.`;
  }
  return "This ask runs once. Requesters post new ones, so the board changes rather than repeating.";
}

export function FirstFavour({ compact = false }: { compact?: boolean }) {
  const [task, setTask] = useState<Task | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tasks");
        if (!res.ok) throw new Error(`board request failed (${res.status})`);
        const data = await res.json();
        const lead = (data.tasks as Task[] | undefined)?.find((t) => t.status === "open") ?? null;
        if (!alive) return;
        setTask(lead);
        setState(lead ? "ready" : "empty");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <LeadFrame>
        <Eyebrow>Loading one open favour</Eyebrow>
        <div className="mt-4 space-y-3" aria-hidden="true">
          <span className="block h-4 w-4/5 rounded-full bg-gray-100" />
          <span className="block h-4 w-3/5 rounded-full bg-gray-100" />
          <span className="block h-24 w-full rounded-xl bg-gray-50" />
        </div>
      </LeadFrame>
    );
  }

  if (state === "error") {
    return (
      <LeadFrame>
        <Eyebrow>The board could not be reached</Eyebrow>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-gray-900">
          We could not load an open favour just now.
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
          This is a connection problem on our side, not an empty board. Nothing
          is shown here rather than something made up.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-[15px] font-semibold text-gray-900 active:scale-[0.98]"
        >
          Try again
        </button>
      </LeadFrame>
    );
  }

  if (state === "empty" || !task) {
    return (
      <LeadFrame>
        <Eyebrow>Nothing open right now</Eyebrow>
        <p className="mt-2 text-[15px] font-semibold leading-snug text-gray-900">
          No favour is open at this moment.
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
          Requesters post the work, so the board can genuinely run dry. There is
          no sample favour here standing in for a real one.
        </p>
        <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] leading-relaxed text-gray-600">
          Judging is the one thing that never runs dry: signed-in people rate
          whether a submitted proof is real. Sign in below to do that while the
          board refills.
        </p>
      </LeadFrame>
    );
  }

  return (
    <LeadFrame>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>Open favour</Eyebrow>
          <p className="mt-1 text-[12px] text-gray-400">{task.location}</p>
        </div>
        <RewardBadge task={task} hero />
      </div>

      <h2 className="mt-4 text-[20px] font-bold leading-snug tracking-tight text-gray-950">
        {task.description}
      </h2>

      {/* Points are never implied to be cash (CLAUDE.md production rule). The
          model for this precision is campaigns.ts, which says outright "No
          points here, this is money, settled on-chain to your wallet." */}
      <p className="mt-2 text-[12px] leading-relaxed text-gray-500">{rewardTruth(task)}</p>

      <div className="mt-5">
        <ProofSlot category={task.category} size={compact ? "sm" : "md"} />
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4">
        <Eyebrow>Why you would come back</Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          {returnReason(task)}
        </p>
      </div>

      {/* DESIGN-SYSTEM: one primary button per screen. Inside onboarding the
          primary is the flow's own "Get started", so the card's control is the
          secondary shape there and the primary shape on the landing screen. */}
      <Link
        href={`/f/${task.id}`}
        className={`mt-5 flex min-h-[52px] w-full items-center justify-center rounded-xl px-4 text-[15px] font-semibold active:scale-[0.98] ${
          compact
            ? "border border-gray-900 bg-white text-gray-900"
            : "bg-gray-900 text-white"
        }`}
      >
        Open this request
      </Link>
    </LeadFrame>
  );
}
