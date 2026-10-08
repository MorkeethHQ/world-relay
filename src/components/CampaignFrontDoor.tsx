"use client";

import { useState } from "react";
import type { CampaignStage } from "@/lib/campaign-stage";
import type { WelcomeStepView, WelcomeView } from "@/lib/welcome-shape";
import { DEMO_BRAND, formatProposedUsdc, proposedLabel } from "@/lib/demo-brand";
import { CompanyTrust, ProductLine } from "@/components/CompanyCampaign";
import { CategoryIcon } from "@/components/CategoryIcon";

// R19 (BOARD-RULES.md, 2026-10-05): campaigns are the front door. One stage,
// three rungs, in one order on the signed-out first screen and on the board:
// Welcome, then a real company campaign, then a labelled demo brand.
//
// Colour follows DESIGN-SYSTEM: ink for everything here. Nothing on this stage
// is escrowed money, so nothing on it is green. Points are amber.

const STEP_LABEL: Record<WelcomeStepView["state"], string> = {
  todo: "To do",
  sent: "Sent, not checked yet",
  in_review: "In human review",
  done: "Done",
};

function ProgressDots({ total, done, waiting }: { total: number; done: number; waiting: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-white" : i < done + waiting ? "bg-white/50" : "bg-white/20"}`} />
      ))}
    </div>
  );
}

export function CampaignStageCards({ stage, welcome, signedIn, onOpenWelcome, onOpenCompany, onForCompanies, onOpenDemo, quiet = false }: {
  stage: CampaignStage;
  welcome: WelcomeView | null;
  signedIn: boolean;
  onOpenWelcome: () => void;
  onOpenCompany: (campaignId: string) => void;
  onForCompanies: () => void;
  onOpenDemo: () => void;
  // The first page (8 Oct 2026 redesign) has one way to post a product, "Post your
  // own app" at the top. With `quiet`, the owner entry and its sentence are not
  // drawn; the campaigns themselves still are. Onboarding keeps the full stage.
  quiet?: boolean;
}) {
  const w = stage.welcome;
  const c = stage.company;
  if (quiet && !c && !(w && welcome)) return null;
  return (
    <section aria-label="Campaigns" className="campaign-stage flex flex-col gap-5 px-6 pt-5 pb-2">
      <h2 className="campaign-section-title">{quiet ? "Campaigns" : "Explore campaigns"}</h2>
      {c && (
        <article className="overflow-hidden rounded-3xl border border-gray-200 bg-white">
          <div className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Company campaign</p>
            <h3 className="campaign-title mt-2 text-[26px] font-bold tracking-tight text-gray-950">{c.campaign.company}</h3>
            <CompanyTrust c={c.campaign} className="mt-2" />
            <ProductLine c={c.campaign} className="mt-3" />
            <p className="mt-3 text-[15px] leading-relaxed text-gray-700 break-words">{c.campaign.brief}</p>
            <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 text-[13px]">
              <span className="text-gray-600">{c.openPieces} pieces open</span>
              <span className="font-semibold text-amber-700">{c.campaign.rewardPerPiecePoints} pts per accepted piece</span>
            </div>
            <button type="button" onClick={() => onOpenCompany(c.campaign.id)} className="mt-4 w-full min-h-[48px] rounded-full campaign-action-dark bg-gray-900 text-white text-[15px] font-semibold">Explore campaign →</button>
          </div>
        </article>
      )}
      {w && welcome && (
        <article className="relative overflow-hidden rounded-3xl bg-gray-950 text-white">
          {welcome.campaign.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={welcome.campaign.heroImage} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/15" />
          <div className="relative px-5 pt-24 pb-5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">By FAVOUR · Welcome campaign</span>
            <h3 className="campaign-title mt-2 text-[28px] font-bold leading-[1.1] tracking-tight">{welcome.campaign.name}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-white/85">{welcome.campaign.tagline}</p>
            <div className="mt-4 flex items-center justify-between text-[12px] text-white/80">
              <span>{signedIn ? `${w.done} of ${w.total} done` : `${w.total} small favours`}</span><span>Earn points</span>
            </div>
            {signedIn && <div className="mt-2"><ProgressDots total={w.total} done={w.done} waiting={w.waiting} /></div>}
            <button type="button" onClick={onOpenWelcome} className="mt-4 w-full min-h-[48px] rounded-full campaign-action-light bg-white text-gray-900 text-[15px] font-semibold">
              {w.finished ? "See your Welcome favours" : signedIn && w.done + w.waiting > 0 ? "Continue Welcome →" : "Explore Welcome →"}
            </button>
          </div>
        </article>
      )}
      {!quiet && (
        <button type="button" onClick={onForCompanies} className="campaign-owner-entry text-left rounded-3xl border border-gray-200 bg-white p-5 min-h-[110px]">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">For teams & creators</span>
          <span className="mt-2 block text-[21px] font-bold tracking-tight text-gray-950">Build a campaign ↗</span>
          <span className="mt-2 block text-[14px] leading-relaxed text-gray-600">Product feedback, honest reviews, original stories. Build your campaign.</span>
        </button>
      )}
      {!quiet && !c && <p className="text-[12px] text-gray-500">Company campaigns open here after review.{w && welcome ? " Welcome is open now." : " Start a campaign with your own product and brief."}</p>}
    </section>
  );
}

export function WelcomeCampaignView({ welcome, signedIn, busyId, error, onStart, onBack, onDiscover }: {
  welcome: WelcomeView;
  signedIn: boolean;
  busyId: string | null;
  error: string | null;
  onStart: (step: WelcomeStepView) => void;
  onBack: () => void;
  onDiscover: () => void;
}) {
  const done = welcome.steps.filter((s) => s.state === "done").length;
  const total = welcome.steps.length;
  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] max-w-lg mx-auto w-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="min-h-[44px] text-[14px] text-gray-500">Back</button>
        <p className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 truncate">Welcome</p>
      </div>
      <div className="relative overflow-hidden bg-gray-950 text-white">
        {welcome.campaign.heroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={welcome.campaign.heroImage} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/65 to-black/40" />
        <div className="relative px-6 pt-12 pb-6">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Welcome campaign · points</span>
          <h1 className="mt-1.5 text-[28px] font-bold leading-[1.1] tracking-tight">{welcome.campaign.name}</h1>
          <p className="mt-2 text-[14px] leading-snug text-white/80">{welcome.campaign.tagline}</p>
          <div className="mt-4">
            <ProgressDots total={total} done={done} waiting={welcome.steps.filter((s) => s.state === "sent" || s.state === "in_review").length} />
            <p className="mt-2 text-[12px] text-white/70">{signedIn ? `${done} of ${total} done` : `${total} favours`} · runs until {new Date(welcome.campaign.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
        </div>
      </div>
      <div className="px-6 pt-5 pb-8 flex flex-col gap-3">
        <div className="rounded-2xl bg-white border border-gray-200 px-4 py-3">
          <p className="text-[13px] font-semibold text-gray-900">How it works</p>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] leading-snug text-gray-700">
            <li>Each favour is yours to do. Someone else&apos;s proof never takes it from you.</li>
            <li>An automatic check reads your proof. Accepted: the points are added.</li>
            <li>If the check is not sure, 3 qualified reviewers look and 2 must accept. If the checking service is not working, your proof is not judged and no points change. You can try again; it is judged only once the service works.</li>
            <li>Points only. No USDC is paid by this campaign.</li>
          </ul>
        </div>
        {error && <p role="alert" className="text-[14px] text-error-700 bg-error-100 border border-error-200 rounded-xl px-4 py-3">{error}</p>}
        <ol className="flex flex-col gap-2.5">
          {welcome.steps.map((s, i) => (
            <li key={s.sourceTaskId} className="rounded-2xl bg-white border border-gray-200 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 shrink-0">
                  <CategoryIcon category={s.category} size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-500">Favour {i + 1} of {total}</p>
                  <p className="mt-0.5 text-[15px] font-medium leading-snug text-gray-900 break-words">{s.description}</p>
                </div>
                <span className="shrink-0 text-[12px] font-bold text-amber-600 bg-amber-50 rounded-full px-2.5 py-1">{s.points} pts</span>
              </div>
              {signedIn && s.state !== "todo" && (
                <p className={`mt-3 text-[13px] font-semibold ${s.state === "done" ? "text-gray-900" : "text-yellow-600"}`}>{STEP_LABEL[s.state]}</p>
              )}
              {s.state === "in_review" && (
                <p className="mt-1 text-[13px] leading-snug text-gray-600">
                  3 qualified reviewers look at this proof and 2 must accept it. No points yet. You can send a new proof at any time.
                </p>
              )}
              {s.state === "sent" && (
                <p className="mt-1 text-[13px] leading-snug text-gray-600">Your proof is saved on this favour, but it was not judged: the checking service was not working. No points yet. You can send it again; it is judged only once the service works.</p>
              )}
              {s.state === "todo" && s.reviewNote && (
                <div className="mt-3 rounded-xl bg-gray-100 px-3 py-2">
                  <p className="text-[12px] font-semibold text-gray-900">The reviewers did not accept your last proof. No points were added.</p>
                  {s.reviewNote.reasons.map((r, k) => (
                    <p key={k} className="mt-1 text-[12px] leading-snug text-gray-700 break-words">&ldquo;{r}&rdquo;</p>
                  ))}
                </div>
              )}
              {s.state !== "done" && (
                <button
                  type="button"
                  onClick={() => onStart(s)}
                  disabled={busyId === s.sourceTaskId}
                  className={`mt-3 w-full min-h-[48px] rounded-full text-[15px] font-semibold active:scale-[0.99] disabled:opacity-40 ${s.state === "todo" ? "bg-gray-900 text-white" : "bg-white border border-gray-300 text-gray-900"}`}
                >
                  {busyId === s.sourceTaskId ? "Opening" : s.state === "todo" ? (signedIn ? "Do this favour" : "Sign in to do this favour") : "Send a new proof"}
                </button>
              )}
            </li>
          ))}
        </ol>
        <p className="text-[12px] leading-snug text-gray-500">
          These are the original Welcome favours, first posted on 5 Jul 2026. The texts are unchanged.
        </p>
        <button type="button" onClick={onDiscover} className="w-full min-h-[48px] rounded-full border border-gray-300 bg-white text-[15px] font-semibold text-gray-900 active:scale-[0.99]">
          Discover more favours
        </button>
      </div>
    </div>
  );
}

export function DemoBrandView({ onBack, onPlan, onWelcome }: { onBack: () => void; onPlan: () => void; onWelcome: (() => void) | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const micro = DEMO_BRAND.items.filter((i) => i.size === "micro");
  const big = DEMO_BRAND.items.filter((i) => i.size === "big");
  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)] max-w-lg mx-auto w-full bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={onBack} className="min-h-[44px] text-[14px] text-gray-500">Back</button>
        <p className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 truncate">Demo campaign</p>
      </div>
      <div role="note" className="bg-gray-900 px-6 py-3 text-[13px] leading-snug text-white">
        <span className="font-bold uppercase tracking-[0.15em] text-[11px]">Demo · fictional brand</span>
        <span className="block mt-1 text-white/80">{DEMO_BRAND.disclaimer}</span>
      </div>
      <div className="px-6 pt-5 pb-8 flex flex-col gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-gray-900">{DEMO_BRAND.name}</h1>
          <p className="mt-2 text-[15px] leading-snug text-gray-700">{DEMO_BRAND.pitch}</p>
        </div>
        <section aria-label="Micro favours" className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-semibold text-gray-900">Micro favours</h2>
          <p className="text-[13px] leading-snug text-gray-600">Seconds each. Thousands of real people, one tiny answer at a time.</p>
          {micro.map((it) => (
            <div key={it.key} className="rounded-2xl bg-white border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900">{it.title}</p>
                <span className="shrink-0 text-[12px] font-bold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1 tabular-nums">{formatProposedUsdc(it.proposedUsdc)} USDC proposed</span>
              </div>
              <p className="mt-1 text-[14px] leading-snug text-gray-700">{it.ask}</p>
              <p className="mt-2 text-[12px] text-gray-500">{it.effort} · {proposedLabel(it.proposedUsdc)}</p>
              <button type="button" onClick={() => setOpen(open === it.key ? null : it.key)} aria-expanded={open === it.key} className="mt-1 min-h-[44px] text-[13px] font-semibold text-gray-900 underline underline-offset-2">
                {open === it.key ? "Hide" : "Can I do this?"}
              </button>
              {open === it.key && (
                <p className="text-[13px] leading-snug text-gray-700">No. This favour is a demo. It cannot be started, it takes no proof, and it pays nothing: no USDC and no points.</p>
              )}
            </div>
          ))}
        </section>
        <section aria-label="Big challenge" className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-semibold text-gray-900">Or one big challenge</h2>
          <p className="text-[13px] leading-snug text-gray-600">Real work, a real write-up, a reward worth working towards.</p>
          {big.map((it) => (
            <div key={it.key} className="rounded-2xl bg-gray-950 text-white p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 min-w-0 text-[18px] font-bold leading-tight">{it.title}</p>
                <span className="shrink-0 text-[12px] font-bold bg-white/15 rounded-full px-2.5 py-1 tabular-nums">{formatProposedUsdc(it.proposedUsdc)} USDC proposed</span>
              </div>
              <p className="mt-2 text-[14px] leading-snug text-white/80">{it.ask}</p>
              <p className="mt-2 text-[12px] text-white/60">{it.effort} · {proposedLabel(it.proposedUsdc)} · demo, cannot be started</p>
            </div>
          ))}
        </section>
        <div className="rounded-2xl bg-white border border-gray-200 px-4 py-3">
          <p className="text-[13px] font-semibold text-gray-900">What is real today</p>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] leading-snug text-gray-700">
            <li>The Welcome favours and published company campaigns are real and pay points.</li>
            <li>A company can plan and publish a points campaign now. Its pool is shown as proposed until it is funded.</li>
            <li>No favour on FAVOUR pays {formatProposedUsdc(0.001)} USDC today. That amount is an idea, shown here so you can picture it.</li>
          </ul>
        </div>
        {onWelcome && (
          <button type="button" onClick={onWelcome} className="w-full min-h-[48px] rounded-full bg-gray-900 text-white text-[15px] font-semibold active:scale-[0.99]">
            Do the Welcome favours
          </button>
        )}
        <button type="button" onClick={onPlan} className="w-full min-h-[48px] rounded-full border border-gray-300 bg-white text-[15px] font-semibold text-gray-900 active:scale-[0.99]">
          Plan a real campaign
        </button>
      </div>
    </div>
  );
}
