"use client";

import type { Task } from "@/lib/types";
import { Button } from "@worldcoin/mini-apps-ui-kit-react";
import { rewardAmountLabel } from "@/lib/reward";
import { authorLabel } from "@/lib/authorship";

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
          {authorLabel(task) ?? "Asked on the board"} · {task.location} ·{" "}
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


// THE DONE STATE, added 2026-09-21. Once today's mission is completed it stops
// being an action: no button, no second go. What is left is the result, the
// points actually written (not the advertised price, which omits a streak bonus),
// and the way back to the proof in History.
export function DailyMissionDoneCard({
  task,
  points,
  proofImageUrl,
  at,
}: {
  task: Task;
  points: number;
  proofImageUrl: string | null;
  // When the pass happened. The mission can run for days, so a pass from an
  // earlier day reads "Done", never "Done today".
  at?: string;
}) {
  const today = !at || at.slice(0, 10) === new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-6 mt-4 rounded-3xl border border-gray-200 bg-white overflow-hidden animate-[fadeSlideIn_0.4s_ease-out]">
      <div className="px-5 pt-4 pb-4 flex gap-4 items-start">
        {proofImageUrl ? (
          <img src={proofImageUrl} alt="Your proof" loading="lazy" className="w-16 h-16 rounded-xl object-cover bg-gray-100 shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 shrink-0 flex items-center justify-center text-gray-400" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-success-600">{today ? "Done today" : "Done"}</span>
            <span className="text-[13px] font-bold text-gray-900 shrink-0">+{points} pts</span>
          </div>
          <p className="text-[14px] font-medium leading-snug text-gray-900 mt-1 line-clamp-2 break-words">{task.description}</p>
          <a href="/history" className="inline-block mt-2 text-[13px] font-semibold text-gray-900 underline underline-offset-2">
            See your proof
          </a>
        </div>
      </div>
    </div>
  );
}
