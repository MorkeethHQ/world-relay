"use client";

// The funnel carries only this random device identifier. It never sends a wallet,
// task id, route, error text, or user-entered value.
export type FunnelEvent =
  | "onboarding_started" | "onboarding_completed" | "wallet_auth_succeeded" | "wallet_auth_failed"
  | "daily_entered" | "jury_entered" | "task_detail_viewed" | "claim_succeeded" | "claim_failed" | "proof_submitted";

export function funnelClientId(): string | null {
  try {
    let cid = localStorage.getItem("favour_cid");
    if (!cid) { cid = crypto.randomUUID(); localStorage.setItem("favour_cid", cid); }
    return cid;
  } catch { return null; }
}

export function trackFunnel(event: FunnelEvent): void {
  const cid = funnelClientId();
  if (!cid) return;
  fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, cid }) }).catch(() => {});
}
