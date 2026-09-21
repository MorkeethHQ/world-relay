"use client";

import { useState, useEffect } from "react";
import type { CampaignDraft, PieceKind, PublicCompanyCampaign, CampaignResult } from "@/lib/campaign-draft-shape";
import type { Task } from "@/lib/types";
import { PIECE_LABEL, MAX_PIECES_PER_KIND, MAX_PIECES_TOTAL } from "@/lib/campaign-draft-shape";

// THE COMPANY JOURNEY (FAVOUR-COMPANY-JOURNEY-2026-09-21). Oscar's ruling: the
// first screen shows the vision. A company launches a favour campaign, people do
// useful work for it, reviewed work earns rewards.
//
// The card below is an EXAMPLE, and says so in its first line. The company is
// named "Example company", not an invented brand, and the pool is shown as
// proposed and not funded, because it is both. Nothing on this card is presented
// as a real campaign, and nothing here can move money.

const EXAMPLE_PIECES: Array<{ kind: PieceKind; count: number }> = [
  { kind: "ugc", count: 5 },
  { kind: "article", count: 2 },
  { kind: "review", count: 10 },
];

const STEPS = [
  "A company proposes a campaign and a pool.",
  "People pick a piece of work: a clip, an article, a review.",
  "They send proof: a link, a photo or a note.",
  "It is reviewed: an AI check, then human judges where it applies.",
  "Accepted work earns the reward. Points while the pool is proposed. USDC only from a funded pool, and only for Orb-verified people.",
  "Everyone sees the piece, its status and the reward in History, and comes back for the next one.",
];

// "Plan a campaign", not "Launch": the form saves a PRIVATE draft (Oscar,
// 2026-09-21 product check). Publishing is a separate, explicit step, and funding
// the proposed pool is a separate authorized step after that.
export function CompanyVisionCard({ onLaunch, launchLabel = "Plan a campaign", drafts = 0, onSeeDrafts }: {
  onLaunch: () => void;
  launchLabel?: string;
  drafts?: number;
  onSeeDrafts?: () => void;
}) {
  const [how, setHow] = useState(false);
  return (
    <section className="mx-6 mt-4 rounded-3xl bg-gray-950 text-white overflow-hidden" aria-label="How a company campaign works">
      <div className="px-5 pt-4 pb-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Example · not funded</span>
        <p className="text-[20px] font-bold leading-snug tracking-tight mt-2">
          A company launches a favour campaign. People do useful work for it. Reviewed work earns rewards.
        </p>
        <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] font-semibold">Example company</p>
            <span className="shrink-0 text-[12px] font-bold bg-white/15 rounded-full px-2.5 py-1">200 USDC proposed</span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {EXAMPLE_PIECES.map((p) => (
              <li key={p.kind} className="flex items-center justify-between text-[13px] text-white/80">
                <span>{PIECE_LABEL[p.kind]} · {p.count} wanted</span>
                <span className="font-semibold text-white">10 pts each</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-white/50">
            A proposed pool is not money. Accepted pieces earn points until a real pool is funded.
          </p>
        </div>
        <button
          type="button"
          onClick={onLaunch}
          className="mt-4 w-full min-h-[48px] rounded-full bg-white text-gray-900 text-[15px] font-semibold active:scale-[0.99]"
        >
          {launchLabel}
        </button>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => setHow((v) => !v)} className="min-h-[40px] text-[13px] text-white/70" aria-expanded={how}>
            {how ? "Hide how it works" : "How it works"}
          </button>
          {drafts > 0 && onSeeDrafts && (
            <button type="button" onClick={onSeeDrafts} className="min-h-[40px] text-[13px] font-semibold text-white">
              Your drafts ({drafts})
            </button>
          )}
        </div>
        {how && (
          <ol className="mt-1 flex flex-col gap-2">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3 text-[13px] leading-snug text-white/80">
                <span className="shrink-0 w-5 h-5 rounded-full bg-white/15 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

const inputCls =
  "w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[15px] focus:outline-none focus:border-gray-400 placeholder:text-gray-400 min-h-[48px]";

export function CampaignDraftForm({ onSaved, onCancel, onReauth }: {
  onSaved: (d: CampaignDraft) => void;
  onCancel: () => void;
  onReauth?: () => void | Promise<void>;
}) {
  const [company, setCompany] = useState("");
  const [brief, setBrief] = useState("");
  const [counts, setCounts] = useState<Record<PieceKind, number>>({ ugc: 5, article: 2, review: 10 });
  const [reward, setReward] = useState(10);
  const [pool, setPool] = useState("200");
  const [reviewRule, setReviewRule] = useState<"ai" | "ai_and_jury">("ai_and_jury");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = JSON.stringify({
      company,
      brief,
      pieces: (Object.keys(counts) as PieceKind[]).filter((k) => counts[k] > 0).map((k) => ({ kind: k, count: counts[k] })),
      rewardPerPiecePoints: reward,
      proposedPoolUsdc: Number(pool),
      reviewRule,
    });
    const send = () => fetch("/api/campaigns/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    try {
      let res = await send();
      if (res.status === 403 && onReauth) {
        const peek = await res.clone().json().catch(() => ({} as Record<string, unknown>));
        if (peek.code === "reauth_required") { await onReauth(); res = await send(); }
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) { setError(typeof data.error === "string" ? data.error : "Could not save the draft. Nothing was saved."); return; }
      onSaved(data.draft as CampaignDraft);
    } catch {
      setError("Network error. Nothing was saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // The same caps the server refuses beyond, so the form cannot offer a plan that
  // will be rejected: 10 of a kind, 20 in total, while the pool is only proposed.
  const totalPieces = counts.ugc + counts.article + counts.review;
  const step = (k: PieceKind, d: number) => setCounts((c) => {
    const total = c.ugc + c.article + c.review;
    if (d > 0 && (c[k] >= MAX_PIECES_PER_KIND || total >= MAX_PIECES_TOTAL)) return c;
    return { ...c, [k]: Math.max(0, c[k] + d) };
  });

  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] max-w-lg mx-auto w-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <button type="button" onClick={onCancel} className="min-h-[40px] text-[14px] text-gray-500">Cancel</button>
        <p className="text-[15px] font-semibold text-gray-900">Plan a campaign</p>
        <span className="w-12" />
      </div>
      <div className="flex-1 px-6 pt-5 pb-4 flex flex-col gap-5">
        <p className="text-[13px] text-gray-500 leading-snug">
          This saves a private <span className="font-semibold text-gray-900">draft</span>. Nothing goes on the board until you publish it, and no money moves. Funding the pool is a separate step.
        </p>
        <div>
          <label htmlFor="c-company" className="text-[12px] text-gray-400">Company name</label>
          <input id="c-company" className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} placeholder="Your company" />
        </div>
        <div>
          <label htmlFor="c-brief" className="text-[12px] text-gray-400">What you want made</label>
          <textarea id="c-brief" className={inputCls} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={500} placeholder="Short honest pieces about our new product, made by real customers." />
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[12px] text-gray-400">Pieces wanted</p>
            <p className="text-[12px] text-gray-500 tabular-nums">{totalPieces} of {MAX_PIECES_TOTAL} · up to {MAX_PIECES_PER_KIND} each</p>
          </div>
          <div className="flex flex-col gap-2">
            {(Object.keys(counts) as PieceKind[]).map((k) => (
              <div key={k} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 min-h-[52px]">
                <span className="text-[14px] text-gray-900">{PIECE_LABEL[k]}</span>
                <div className="flex items-center gap-3">
                  <button type="button" aria-label={`Fewer: ${PIECE_LABEL[k]}`} onClick={() => step(k, -1)} className="w-9 h-9 rounded-full bg-gray-100 text-[18px]">−</button>
                  <span className="w-6 text-center tabular-nums text-[15px] font-semibold">{counts[k]}</span>
                  <button type="button" aria-label={`More: ${PIECE_LABEL[k]}`} onClick={() => step(k, 1)}
                    disabled={counts[k] >= MAX_PIECES_PER_KIND || totalPieces >= MAX_PIECES_TOTAL}
                    className="w-9 h-9 rounded-full bg-gray-100 text-[18px] disabled:opacity-30">+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[12px] text-gray-400 mb-2">Reward per accepted piece</p>
          <div className="flex gap-2">
            {[1, 5, 10].map((r) => (
              <button key={r} type="button" aria-pressed={reward === r} onClick={() => setReward(r)}
                className={`flex-1 min-h-[44px] rounded-xl text-[14px] tabular-nums ${reward === r ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-700"}`}>
                {r} pts
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="c-pool" className="text-[12px] text-gray-400">Proposed pool (USDC)</label>
          <input id="c-pool" inputMode="decimal" className={inputCls} value={pool} onChange={(e) => setPool(e.target.value.replace(/[^0-9.]/g, ""))} />
          <p className="mt-1 text-[12px] text-gray-500">A proposal, not a payment. It is shown as not funded, and accepted pieces earn points until a real pool is funded.</p>
        </div>
        <div>
          <p className="text-[12px] text-gray-400 mb-2">How work is reviewed</p>
          <div className="flex gap-2">
            {([["ai", "AI check"], ["ai_and_jury", "AI check + human judges"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={reviewRule === k} onClick={() => setReviewRule(k)}
                className={`flex-1 min-h-[44px] rounded-xl text-[13px] ${reviewRule === k ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-700"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-6 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}>
        {error && <p role="alert" className="mb-3 text-[14px] text-error-700 bg-error-100 border border-error-200 rounded-xl px-4 py-3">{error}</p>}
        <button type="button" onClick={save} disabled={saving}
          className="w-full min-h-[52px] rounded-full bg-gray-900 text-white text-[15px] font-semibold disabled:opacity-40 active:scale-[0.99]">
          {saving ? "Saving" : "Save draft"}
        </button>
      </div>
    </div>
  );
}

export function CampaignDraftList({ drafts, onDone, justSaved, onPublished, onOpen, onReauth, onChanged }: {
  drafts: CampaignDraft[];
  onDone: () => void;
  justSaved?: string | null;
  onPublished: (c: PublicCompanyCampaign) => void;
  onOpen: (id: string) => void;
  onReauth?: () => void | Promise<void>;
  // Refetch after a failed publish, so a part-published campaign shows as such
  // and offers "Finish publishing".
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publish = async (id: string) => {
    setBusy(id);
    setError(null);
    const send = () => fetch(`/api/campaigns/drafts/${encodeURIComponent(id)}/publish`, { method: "POST" });
    try {
      let res = await send();
      if (res.status === 403 && onReauth) {
        const peek = await res.clone().json().catch(() => ({} as Record<string, unknown>));
        if (peek.code === "reauth_required") { await onReauth(); res = await send(); }
      }
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) { setError(typeof data.error === "string" ? data.error : "Could not publish. Nothing changed."); onChanged?.(); return; }
      onPublished(data.campaign as PublicCompanyCampaign);
    } catch {
      setError("Network error. Nothing changed. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] max-w-lg mx-auto w-full bg-gray-50">
      <div className="px-6 pt-8 pb-4">
        <p className="text-[22px] font-bold tracking-tight text-gray-900">{justSaved ? "Draft saved" : "Your campaigns"}</p>
        <p className="text-[13px] text-gray-500 mt-1">A draft is private to you. Publishing puts its pieces on the board as points favours. No money moves at either step.</p>
      </div>
      <div className="px-6 flex flex-col gap-3">
        {drafts.map((d) => {
          const total = d.pieces.reduce((n, p) => n + p.count, 0);
          return (
            <div key={d.id} className={`rounded-2xl bg-white border ${d.id === justSaved ? "border-gray-900" : "border-gray-200"} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 line-clamp-2 break-words">{d.company}</p>
                <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 ${d.status === "published" ? "text-success-700 bg-success-100" : d.status === "publishing" ? "text-warning-700 bg-warning-100" : "text-gray-600 bg-gray-100"}`}>
                  {d.status === "published" ? "Live · points" : d.status === "publishing" ? "Part published" : "Draft"}
                </span>
              </div>
              <p className="text-[13px] text-gray-600 mt-1 line-clamp-3 break-words">{d.brief}</p>
              <ul className="mt-2 text-[13px] text-gray-700">
                {d.pieces.map((p) => <li key={p.kind}>{PIECE_LABEL[p.kind]} · {p.count} wanted · {d.rewardPerPiecePoints} pts each</li>)}
              </ul>
              <p className="mt-2 text-[12px] text-gray-500">
                Proposed pool {d.proposedPoolUsdc} USDC · <span className="font-semibold text-gray-700">not funded</span> · reviewed by {d.reviewRule === "ai_and_jury" ? "AI check + human judges" : "AI check"}
              </p>
              {d.status !== "published" ? (
                <>
                  {d.status === "publishing" && (
                    <p className="mt-2 text-[12px] text-warning-700">
                      {Object.keys(d.pieceTaskIds ?? {}).length} of {d.pieces.length} kinds of piece are live. Finish publishing to add the rest; nothing is added twice.
                    </p>
                  )}
                  <button type="button" onClick={() => publish(d.id)} disabled={busy === d.id}
                    className="mt-3 w-full min-h-[44px] rounded-full bg-gray-900 text-white text-[14px] font-semibold disabled:opacity-40">
                    {busy === d.id ? "Publishing" : d.status === "publishing" ? "Finish publishing" : `Publish ${total} pieces as points favours`}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => onOpen(d.id)} className="mt-3 w-full min-h-[44px] rounded-full border border-gray-900 text-gray-900 text-[14px] font-semibold">
                  Open campaign
                </button>
              )}
            </div>
          );
        })}
        {error && <p role="alert" className="text-[14px] text-error-700 bg-error-100 border border-error-200 rounded-xl px-4 py-3">{error}</p>}
      </div>
      <div className="px-6 mt-6" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
        <button type="button" onClick={onDone} className="w-full min-h-[52px] rounded-full bg-gray-900 text-white text-[15px] font-semibold">Back to favours</button>
      </div>
    </div>
  );
}

// A REAL published company campaign on the board. Only campaigns a company
// actually published appear here; the example card above is never one of them.
export function CompanyCampaignCard({ c, onOpen }: { c: PublicCompanyCampaign; onOpen: () => void }) {
  const total = c.pieces.reduce((n, p) => n + p.count, 0);
  return (
    <button type="button" onClick={onOpen} className="mx-6 mt-4 text-left rounded-2xl border border-gray-900 bg-white p-4 active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-900">Company campaign</p>
          <p className="text-[16px] font-bold text-gray-900 mt-1 line-clamp-1 break-words">{c.company}</p>
        </div>
        <span className="shrink-0 text-[12px] font-bold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1">{c.rewardPerPiecePoints} pts / piece</span>
      </div>
      <p className="text-[13px] text-gray-600 mt-1 line-clamp-2 break-words">{c.brief}</p>
      <p className="text-[12px] text-gray-500 mt-2">{total} pieces · proposed pool {c.proposedPoolUsdc} USDC, not funded · points only</p>
    </button>
  );
}

const VERDICT_LABEL: Record<CampaignResult["verdict"], string> = { pass: "Accepted", fail: "Rejected", flag: "In review" };

export function CompanyCampaignView({ id, tasks, completedIds, onJoin, onBack }: {
  id: string;
  tasks: Task[];
  completedIds: Set<string>;
  onJoin: (t: Task) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<{ campaign: PublicCompanyCampaign; results: CampaignResult[] } | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/company/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!live) return; if (d?.campaign) setData(d); else setMissing(true); })
      .catch(() => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [id]);
  const c = data?.campaign;
  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] max-w-lg mx-auto w-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="min-h-[40px] text-[14px] text-gray-500">Back</button>
        <p className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 truncate">{c ? c.company : "Campaign"}</p>
      </div>
      {missing && <p className="px-6 pt-8 text-[14px] text-gray-500">This campaign is not published.</p>}
      {c && (
        <div className="px-6 pt-5 pb-8 flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-900">Company campaign · points only{c.status === "publishing" ? " · still publishing" : ""}</p>
            <p className="text-[15px] text-gray-800 mt-1 leading-snug break-words">{c.brief}</p>
            <p className="text-[12px] text-gray-500 mt-2">
              Proposed pool {c.proposedPoolUsdc} USDC · <span className="font-semibold text-gray-700">not funded</span>. Accepted pieces earn {c.rewardPerPiecePoints} points. Reviewed by {c.reviewRule === "ai_and_jury" ? "an AI check, then human judges" : "an AI check"}.
            </p>
          </div>
          <section aria-label="Pieces you can join" className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold text-gray-900">Pick a piece</h2>
            {c.pieces.map((p) => {
              const taskId = c.pieceTaskIds?.[p.kind];
              const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
              const done = !!taskId && completedIds.has(taskId);
              const open = !!task && task.status === "open" && !done;
              const left = task ? Math.max(0, (task.maxCompletions || p.count) - (task.completionCount || 0)) : 0;
              return (
                <div key={p.kind} className="rounded-2xl bg-white border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex-1 min-w-0 text-[14px] font-semibold text-gray-900">{PIECE_LABEL[p.kind]}</p>
                    <span className="shrink-0 text-[12px] font-bold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1">{c.rewardPerPiecePoints} pts</span>
                  </div>
                  <p className="text-[12px] text-gray-500 mt-1">{done ? "You delivered this piece. It is in History." : open ? `${left} of ${p.count} still wanted` : "Not open right now"}</p>
                  {open && task && (
                    <button type="button" onClick={() => onJoin(task)} className="mt-3 w-full min-h-[44px] rounded-full bg-gray-900 text-white text-[14px] font-semibold">
                      Join this piece
                    </button>
                  )}
                </div>
              );
            })}
          </section>
          <section aria-label="Reviewed work" className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold text-gray-900">Reviewed work</h2>
            {data!.results.length === 0 ? (
              <p className="text-[13px] text-gray-500">Nothing reviewed yet.</p>
            ) : (
              data!.results.map((r) => (
                <div key={`${r.taskId}-${r.at}`} className="rounded-xl bg-white border border-gray-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-[12px] font-bold ${r.verdict === "pass" ? "text-success-700" : r.verdict === "fail" ? "text-error-700" : "text-gray-600"}`}>{VERDICT_LABEL[r.verdict]}</span>
                    <span className="text-[12px] text-gray-400">{r.kind ? PIECE_LABEL[r.kind] : "Piece"} · {r.participant}</span>
                  </div>
                  <p className="text-[13px] text-gray-700 mt-1 line-clamp-3 break-words">{r.reason}</p>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
