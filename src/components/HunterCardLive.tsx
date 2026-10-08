"use client";

import { useEffect, useState } from "react";
import { hunterProfile, type HunterProfile } from "@/lib/hunter-profile";
import { HunterCard } from "./HunterCard";

// `HunterCard` WITH ITS DATA, for the signed-in person. It reads two routes that
// answer from the session only: the person's accepted work and the person's own
// campaigns. Nobody else's record can be asked for here.
//
// Four states: reading, could not read (with "Try again"), not signed in (it
// says so and shows no numbers, because zeros would be a claim), and the card.
//
// Mounted at the top of the profile page, /dashboard.

type State = { kind: "loading" } | { kind: "error" } | { kind: "signed_out" } | { kind: "ready"; profile: HunterProfile };

async function read(): Promise<State> {
  const [done, own] = await Promise.all([
    fetch("/api/me/contributions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("unreadable")))),
    fetch("/api/campaigns/drafts", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!done?.authenticated) return { kind: "signed_out" };
  return {
    kind: "ready",
    profile: hunterProfile(Array.isArray(done.contributions) ? done.contributions : [], Array.isArray(own?.drafts) ? own.drafts : []),
  };
}

export function HunterCardLive({ name }: { name: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    read().then((next) => { if (live) setState(next); }).catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  if (state.kind === "loading") return <p role="status" className="text-sm text-gray-600">Reading your work…</p>;
  if (state.kind === "signed_out") {
    return <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Open FAVOUR in World App and sign in to see your reviews.</p>;
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">Your work could not be read.</p>
        <button
          type="button"
          className="mt-3 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 active:scale-[0.98]"
          onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}
        >
          Try again
        </button>
      </div>
    );
  }
  return <HunterCard name={name} profile={state.profile} />;
}
