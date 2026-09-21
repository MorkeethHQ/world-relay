"use client";

import type { Task } from "@/lib/types";
import { Button } from "@worldcoin/mini-apps-ui-kit-react";
import { rewardAmountLabel } from "@/lib/reward";

// Today's mission card, shared by the board and the signed-out teaser in
// onboarding (Oscar, 2026-09-21: a new visitor should meet the mission before
// terms and sign-in). The card is read-only; onStart decides what an action
// needs, so the teaser can route to consent and sign-in first.
// Same list as tierRequiresPhoto in Feed.tsx.
const PHOTO_CATEGORIES = ["photo", "delivery", "errand", "check-in"];

export function DailyMissionCard({
  task,
  proofs,
  onStart,
}: {
  task: Task;
  proofs: Task[];
  onStart: () => void;
}) {
  const needsPhoto = PHOTO_CATEGORIES.includes(task.category);
  return (
    <div className="mx-6 mt-4 rounded-3xl border border-gray-900 bg-white overflow-hidden animate-[fadeSlideIn_0.4s_ease-out]">
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-900">Today&apos;s mission</span>
          <span className="text-[13px] font-bold text-gray-900">{rewardAmountLabel(task)}</span>
        </div>
        {/* break-words is required by the viewport-containment guard: a mission is
            supplied text and a long unbroken string would push the card wider than
            a 390 px phone. */}
        <p className="text-[20px] font-bold leading-snug tracking-tight text-gray-900 mt-2 break-words">{task.description}</p>
        <p className="text-[12px] text-gray-400 mt-2">
          {task.agent?.name ? `${task.agent.name} asked` : "Asked on the board"} · {task.location} ·{" "}
          {needsPhoto ? "photo proof" : "a few words"}
        </p>
      </div>

      {proofs.length > 0 && (
        <div className="px-5 pb-1">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {proofs.map((p) => (
              <img
                key={p.id}
                src={p.proofImageUrl!}
                alt=""
                aria-hidden
                loading="lazy"
                className="w-[72px] h-[72px] rounded-xl object-cover bg-gray-100 shrink-0"
              />
            ))}
          </div>
          <p className="text-[11px] text-gray-400">
            {proofs.length} real proofs from favours people already finished
          </p>
        </div>
      )}

      <div className="px-5 pt-3 pb-5">
        <Button fullWidth variant="primary" size="lg" onClick={onStart}>
          Do today&apos;s mission
        </Button>
      </div>
    </div>
  );
}

