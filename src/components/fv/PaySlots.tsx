"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MiniKit } from "@worldcoin/minikit-js";
import { SLOT_LABEL, shortDate, type FundSummary, type PayPlan, type PublicSlot, type SlotState } from "@/lib/pay-plan";
import { sendWithReauth } from "@/lib/reauth";

// PAID REVIEWS on one project (19 Oct 2026). Two views of the same record.
// REVIEWER: the price, how many slots are left, one button to take a slot, then
// the state of their slot (waiting for funding, funded so the review is open).
// BUILDER: every slot with its state, ONE button that funds all taken slots in
// one World App confirm (the sum, the count and the refund date are shown first),
// and per slot Approve and pay, or Reclaim after the deadline. Every state
// change after signing is verified by the server against the chain through
// /api/escrow-v2, the route the old board already uses. Nothing books on the
// app's word.

export type PayView = {
  plan: PayPlan | null;
  open?: boolean;
  counts?: { taken: number; funded: number; reviewed: number; paid: number; refunded: number; open: number };
  slots?: PublicSlot[];
  isOwner?: boolean;
  mine?: { taskId: string; state: SlotState } | null;
  fund?: FundSummary | null;
};

type Busy = null | "take" | "fund" | string; // string = taskId being released or reclaimed

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Poll the existing escrow route until the chain shows the state, or give up. */
async function verifyOnChain(taskId: string, action: "verify-funded" | "verify-released" | "verify-refunded", key: "funded" | "released" | "refunded", txHash: string | null): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await post("/api/escrow-v2", { action, taskId, txHash }).catch(() => null);
    const b = res ? await res.json().catch(() => null) : null;
    if (res?.ok && b?.[key]) return true;
  }
  return false;
}

export function PaySlotsScreen({ v, projectId, busy, note, onTake, onFund, onRelease, onRefund, signedIn }: {
  v: PayView; projectId: string; busy: Busy; note: string | null;
  onTake: () => void; onFund: () => void; onRelease: (taskId: string) => void; onRefund: (taskId: string) => void; signedIn: boolean;
}) {
  const plan = v.plan;
  if (!plan) return null;
  const counts = v.counts ?? { taken: 0, funded: 0, reviewed: 0, paid: 0, refunded: 0, open: plan.slots };
  const slots = v.slots ?? [];
  const mine = v.mine ?? null;

  if (v.isOwner) {
    const f = v.fund;
    return (
      <section aria-label="Paid reviews" className="flex flex-col gap-3">
        <h2 className="fv-label">Paid reviews · {plan.perReviewUsd} USDC each</h2>
        <p className="fv-body fv-num">{counts.paid} paid, {counts.taken} waiting for your funding, {counts.open} of {plan.slots} slots open.</p>
        {f && f.count > 0 && (
          <div className="fv-box p-4 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="fv-body">{f.count} {f.count === 1 ? "reviewer" : "reviewers"} accepted</p>
              <p className="fv-h fv-num fv-blue">{f.totalUsd} USDC</p>
            </div>
            {f.lines.map((l) => <p key={l} className="fv-body text-[12px]">{l}</p>)}
            <button type="button" className="fv-btn fv-btn-ink" disabled={busy !== null || v.open === false} onClick={onFund}>
              {busy === "fund" ? "Confirm in World App…" : `Fund ${f.count} ${f.count === 1 ? "review" : "reviews"}, ${f.totalUsd} USDC`}
            </button>
          </div>
        )}
        {slots.map((s) => (
          <div key={s.taskId} className="fv-box p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="fv-h">{SLOT_LABEL[s.state]}</p>
              <p className="fv-body text-[12px] fv-num break-all">{s.reviewer ? `${s.reviewer.slice(0, 6)}…${s.reviewer.slice(-4)}` : "Reviewer"} · refund after {shortDate(s.reclaimAfter)}</p>
            </div>
            {s.state === "reviewed" && (
              <button type="button" className="fv-btn fv-btn-sm fv-btn-ink" disabled={busy !== null} onClick={() => onRelease(s.taskId)}>
                {busy === s.taskId ? "Confirm…" : `Approve, pay ${plan.perReviewUsd}`}
              </button>
            )}
            {s.reclaimable && (
              <button type="button" className="fv-btn fv-btn-sm" disabled={busy !== null} onClick={() => onRefund(s.taskId)}>
                {busy === s.taskId ? "Confirm…" : "Reclaim"}
              </button>
            )}
          </div>
        ))}
        {note && <p role="status" className="fv-body">{note}</p>}
      </section>
    );
  }

  return (
    <section aria-label="Paid review" className="fv-box p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="fv-h">Paid review</p>
        <p className="fv-h fv-num fv-blue">{plan.perReviewUsd} USDC</p>
      </div>
      {mine ? (
        <>
          <p className="fv-body">{mine.state === "taken" ? "You hold a slot. The builder funds it next. Your review opens when the USDC is in escrow." : mine.state === "funded" ? "Funded. Write your review now." : mine.state === "reviewed" ? "Review sent. The builder reads it and releases the USDC." : mine.state === "paid" ? "Paid to your wallet." : "This slot was refunded to the builder."}</p>
          {mine.state === "funded" && (
            <Link href={`/project/${encodeURIComponent(projectId)}/feedback?task=${encodeURIComponent(mine.taskId)}`} className="fv-btn fv-btn-ink">Write the paid review</Link>
          )}
        </>
      ) : (
        <>
          <p className="fv-body fv-num">{counts.open} of {plan.slots} slots open. The builder funds your slot into escrow before you start. Released to you when the builder approves your written review.</p>
          <button type="button" className="fv-btn fv-btn-ink" disabled={busy !== null || counts.open === 0} onClick={onTake}>
            {busy === "take" ? "Taking…" : counts.open === 0 ? "No slot open" : signedIn ? `Take a paid slot` : "Sign in and take a slot"}
          </button>
        </>
      )}
      {note && <p role="status" className="fv-body">{note}</p>}
    </section>
  );
}

export function PaySlots({ projectId, userId, onNeedSignIn }: { projectId: string; userId: string | null; onNeedSignIn: () => void }) {
  const [v, setV] = useState<PayView | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pay`, { cache: "no-store" }).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    setV(b && typeof b === "object" ? (b as PayView) : { plan: null });
  }, [projectId]);
  useEffect(() => { load(); }, [load, userId]);

  const sign = async (prep: { payload: unknown } | null, verify: () => Promise<boolean>, ok: string) => {
    if (!prep?.payload) { setNote("The transaction could not be prepared."); return; }
    if (!MiniKit.isInstalled()) { setNote("Open FAVOUR inside World App to sign this."); return; }
    const result = await MiniKit.sendTransaction(prep.payload as Parameters<typeof MiniKit.sendTransaction>[0]).catch(() => null);
    if (!result) { setNote("Not signed. Nothing moved."); return; }
    setNote("Signed. Waiting for the chain…");
    setNote((await verify()) ? ok : "Not confirmed on chain yet. Reload in a minute.");
    await load();
  };

  const onTake = async () => {
    if (!userId) return onNeedSignIn();
    setBusy("take"); setNote(null);
    const r = await sendWithReauth(() => post(`/api/projects/${encodeURIComponent(projectId)}/pay`, { action: "take" }), userId).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) setNote(typeof b?.error === "string" ? b.error : "The slot could not be taken.");
    await load(); setBusy(null);
  };

  const onFund = async () => {
    if (!userId) return onNeedSignIn();
    setBusy("fund"); setNote(null);
    const r = await sendWithReauth(() => post(`/api/projects/${encodeURIComponent(projectId)}/pay`, { action: "prepare-fund" }), userId).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { setNote(typeof b?.error === "string" ? b.error : "Funding could not be prepared."); setBusy(null); return; }
    const ids: string[] = (b.slots ?? []).map((s: { taskId: string }) => s.taskId);
    // No client hash is passed on purpose: World App returns a userOpHash for a
    // batch, which verifyEscrowV2Receipt cannot read, so the server's own log
    // scan (findEscrowV2EventTx) is the only source here, per slot.
    await sign(b, async () => {
      const results = await Promise.all(ids.map((id) => verifyOnChain(id, "verify-funded", "funded", null)));
      return results.every(Boolean);
    }, "Funded and verified on chain. Reviewers can start.");
    setBusy(null);
  };

  const perSlot = (taskId: string, prepare: "prepare-release" | "prepare-refund", verify: "verify-released" | "verify-refunded", key: "released" | "refunded", ok: string) => async () => {
    if (!userId) return onNeedSignIn();
    setBusy(taskId); setNote(null);
    const r = await sendWithReauth(() => post("/api/escrow-v2", { action: prepare, taskId, poster: userId }), userId).catch(() => null);
    const b = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { setNote(typeof b?.error === "string" ? b.error : "Could not prepare."); setBusy(null); return; }
    await sign(b, () => verifyOnChain(taskId, verify, key, null), ok);
    setBusy(null);
  };

  if (!v || !v.plan) return null;
  return (
    <PaySlotsScreen v={v} projectId={projectId} busy={busy} note={note} signedIn={!!userId}
      onTake={onTake} onFund={onFund}
      onRelease={(id) => perSlot(id, "prepare-release", "verify-released", "released", "Released on chain. The reviewer is paid.")()}
      onRefund={(id) => perSlot(id, "prepare-refund", "verify-refunded", "refunded", "Refund confirmed on chain.")()} />
  );
}
