"use client";

import { useCallback, useEffect, useState } from "react";
import { rewardAmountLabel } from "@/lib/reward";
import type { RoundChange } from "@/lib/campaign-round";

// RUN THIS AGAIN, both sides of it (2026-09-09).
//
// Requester: read what the last round produced, run it again, edit the brief,
// save a DRAFT.
// Participant: see that a next round exists, see exactly what changed, and see
// what it would pay in points. Never a claim button on a draft.
//
// DRAFT is stated on every surface here. A draft creates no favour and promises
// nobody anything, and the copy says so in those words rather than implying it.

type Draft = {
  round: number;
  ask: string;
  completion: string[];
  proof: string;
  repeats: string;
  rewardPoints: number;
  completionsPerCycle: number;
  status: "draft";
  updatedAt: string;
  changes: RoundChange[];
};

type RoundState = {
  currentRound: number;
  outcome: { accepted: number; capacity: number; rejectedCount: null };
  isOwner: boolean;
  baseline: {
    ask: string;
    completion: string[];
    proof: string;
    repeats: string;
    rewardPoints: number;
    completionsPerCycle: number;
  };
  draft: Draft | null;
  offer: { actionable: false; reason: string; detail: string };
};

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{children}</p>;
}

function DraftBadge() {
  return (
    <span className="rounded-full border border-gray-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-900">
      Draft
    </span>
  );
}

function Field({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[14px] leading-relaxed text-gray-900"
      />
    </label>
  );
}

export function NextRound({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<RoundState | null>(null);
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState("");
  const [proof, setProof] = useState("");
  const [repeats, setRepeats] = useState("");
  const [points, setPoints] = useState("");
  const [people, setPeople] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/round`);
    if (!res.ok) return;
    const data = (await res.json()) as RoundState;
    setState(data);
    // Prefill from the draft if one exists, otherwise from the round that ran.
    const source = data.draft ?? data.baseline;
    setAsk(source.ask);
    setProof(source.proof);
    setRepeats(source.repeats);
    setPoints(String(source.rewardPoints));
    setPeople(String(source.completionsPerCycle));
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/round`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ask,
        proof,
        repeats,
        rewardPoints: Number(points),
        completionsPerCycle: Number(people),
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      // Verbatim from the server, which knows better than this form does.
      setError(data.error || "The draft could not be saved.");
      return;
    }
    setEditing(false);
    await load();
  };

  const draft = state.draft;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white px-5 py-5" id="next-round">
      <div className="flex items-center justify-between gap-3">
        <Label>The next round</Label>
        {draft && <DraftBadge />}
      </div>

      {/* What the round that ran actually produced. Accepted is accepted.
          Everything else is reported as not accepted, never as rewarded. */}
      <div className="mt-3">
        <p className="text-[20px] font-bold tabular-nums text-gray-950">
          {state.outcome.accepted} of {state.outcome.capacity} accepted
        </p>
        <p className="text-[12px] text-gray-500">across {state.currentRound} round(s) so far</p>
      </div>
      {/* Rejected submissions are deliberately NOT counted here. The store
          keeps no per-campaign tally of them, and inventing one would be a
          number with no source. What can be said truthfully is said. */}
      <p className="mt-2 text-[12px] leading-relaxed text-gray-500">
        Only accepted proofs are counted. A proof that was not accepted earned
        nothing, counts toward nothing, and is not recorded against this round.
      </p>

      {/* ------------------------------ REQUESTER ------------------------------ */}
      {state.isOwner && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-[15px] font-semibold text-white active:scale-[0.98]"
        >
          {draft ? `Edit the round ${draft.round} draft` : "Run this again"}
        </button>
      )}

      {state.isOwner && editing && (
        <div className="mt-5 space-y-4">
          <p className="text-[13px] leading-relaxed text-gray-500">
            Edit what you are asking for. Saving keeps this as a draft: no favour
            is created, nobody is offered work, and no reward is promised.
          </p>
          <Field label="What you are asking for" value={ask} onChange={setAsk} rows={4} />
          <Field label="Proof required" value={proof} onChange={setProof} rows={2} />
          <Field label="Why it repeats" value={repeats} onChange={setRepeats} rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <Label>Points per favour</Label>
              <input
                inputMode="numeric"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[14px] tabular-nums text-gray-900"
              />
            </label>
            <label className="block">
              <Label>People wanted</Label>
              <input
                inputMode="numeric"
                value={people}
                onChange={(e) => setPeople(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[14px] tabular-nums text-gray-900"
              />
            </label>
          </div>
          <p className="text-[12px] leading-relaxed text-gray-500">
            A repeat round pays points. It cannot pay cash, because a recurring
            cash commitment is a money decision this screen is not allowed to
            make on your behalf.
          </p>
          {error && (
            <p className="text-[13px] leading-relaxed text-error-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-[15px] font-semibold text-white disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? "Saving" : "Save as draft"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-[15px] font-semibold text-gray-900"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ------------------------- RETURNING PARTICIPANT ------------------------ */}
      {draft ? (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-semibold text-gray-900">Round {draft.round}</p>
            <span className="text-[17px] font-bold tabular-nums text-amber-600">
              {rewardAmountLabel({ rewardType: "points", bountyUsdc: draft.rewardPoints })}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
            {draft.completionsPerCycle} people wanted. Points only, and points
            are not cash.
          </p>

          {draft.changes.length > 0 ? (
            <div className="mt-4">
              <Label>What changed since the last round</Label>
              <ul className="mt-2.5 space-y-3">
                {draft.changes.map((change) => (
                  <li key={change.field}>
                    <p className="text-[13px] font-semibold text-gray-900">{change.label}</p>
                    <p className="text-[13px] leading-relaxed text-gray-400 line-through">{change.before || "(empty)"}</p>
                    <p className="text-[13px] leading-relaxed text-gray-900">{change.after}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-[13px] leading-relaxed text-gray-500">
              Nothing changed from the last round. Same ask, same proof, same
              points.
            </p>
          )}

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5">
            <Label>{state.offer.reason}</Label>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{state.offer.detail}</p>
          </div>
        </div>
      ) : (
        !state.isOwner && (
          <p className="mt-4 text-[13px] leading-relaxed text-gray-500">
            The requester has not drafted another round. There is nothing here to
            come back for yet, and we will not invent one.
          </p>
        )
      )}
    </section>
  );
}
