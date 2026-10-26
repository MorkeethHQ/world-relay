"use client";

import { useState } from "react";
import { CAMPAIGNS, type Campaign } from "@/lib/campaigns";
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

export function CampaignStageCards({ stage, welcome, welcomeLoading, signedIn, onOpenWelcome, onOpenCompany, onForCompanies, onOpenDemo, campaigns, onOpenCampaign }: {
  stage: CampaignStage;
  welcome: WelcomeView | null;
  welcomeLoading: boolean;
  signedIn: boolean;
  onOpenWelcome: () => void;
  onOpenCompany: (campaignId: string) => void;
  onForCompanies: () => void;
  onOpenDemo: () => void;
  campaigns: Campaign[];
  onOpenCampaign: (campaign: Campaign) => void;
}) {
  const originalWelcome = CAMPAIGNS.find((c) => c.id === "first-favour")!;
  const hero = welcome?.campaign ?? originalWelcome;
  const steps = welcome?.steps ?? [];
  const done = steps.filter((s) => s.state === "done").length;
  const rewards = steps.map((s) => s.points);
  const rewardLabel = rewards.length ? Math.min(...rewards) === Math.max(...rewards) ? `${rewards[0]} points per accepted favour` : `${Math.min(...rewards)} to ${Math.max(...rewards)} points per accepted favour` : `Up to ${hero.rewardPerTask} points per accepted favour`;
  const registry = [...CAMPAIGNS, ...campaigns.filter((c) => !CAMPAIGNS.some((saved) => saved.id === c.id))];
  const cards = registry.filter((c) => c.id !== "first-favour" && Date.parse(c.endsAt) > Date.now());
  const c = stage.company;
  return (
    <section aria-label="Campaigns" className="campaign-stage campaign-discovery">
      <div className="campaign-intro"><p className="campaign-kicker">FAVOUR campaigns</p><h2>Get a favour done by a verified human.</h2><p>Each campaign joins useful steps to one purpose. See the work, the proof and the progress.</p></div>
      <article className="welcome-hero">
        <img src="/campaign-friends.jpg" alt="People working together on a shared goal" />
        <div className="welcome-shade" />
        <div className="welcome-copy">
          <p className="campaign-kicker">Open campaign · By FAVOUR</p>
          <h3>{hero.name}</h3>
          <p>Help prove what a real person can do. Complete a small task, show your work and build a record of accepted favours.</p>
          <div className="welcome-reward"><span>{rewardLabel}</span><span>{signedIn && steps.length > 0 ? `${done} of ${steps.length} accepted` : steps.length > 0 ? `${steps.length} connected steps` : "Connected steps"}</span></div>
          <button type="button" onClick={onOpenWelcome} disabled={!welcome} aria-disabled={!welcome}>{welcomeLoading ? "Loading campaign…" : !welcome ? "Campaign unavailable" : signedIn && done > 0 ? "Continue campaign" : "Explore campaign"} <span aria-hidden>↗</span></button>
        </div>
        <div className="welcome-path" aria-label="Campaign journey">
          <p className="campaign-kicker">Your path</p>
          <ol>
            <li><span>01</span><div><strong>Choose a favour</strong><small>Pick the step you can do now.</small></div></li>
            <li><span>02</span><div><strong>Send your proof</strong><small>Show the work and consent before sending.</small></div></li>
            <li><span>03</span><div><strong>See the result</strong><small>Accepted work moves your campaign progress.</small></div></li>
          </ol>
          <p className="welcome-path-progress">{signedIn && steps.length > 0 ? `${done} accepted · ${steps.length - done} to go` : "Progress stays with your signed-in wallet"}</p>
        </div>
      </article>
      <div className="campaign-grid-heading"><h3>More campaigns</h3><p>Each campaign has a purpose and its own work.</p></div>
      <div className="discovery-grid">
        <article className="discovery-card token-preview-card">
          <div className="token-preview-art" aria-hidden="true"><span>01</span><span>02</span><span>03</span></div>
          <div className="discovery-card-copy"><p className="campaign-kicker">Campaign example · Planning only</p><h3>Shape a FAVOUR token launch.</h3><p>Try a real favour, examine the proof, then tell us what a completion token should record. Your feedback would shape the plan.</p><div className="discovery-reward">No token exists here. No token or payment is promised.</div><button type="button" onClick={onOpenDemo}>See the three steps <span aria-hidden>↗</span></button></div>
        </article>
        {cards.map((campaign) => {
          const ended = Date.parse(campaign.endsAt) <= Date.now();
          return <article className="discovery-card" key={campaign.id}>
            <img src={campaign.id === "relay-launch" ? "/campaign-friends.jpg" : campaign.heroImage || "/campaign-friends.jpg"} alt={campaign.id === "relay-launch" ? "Friends spending time together outdoors" : campaign.name} />
            <div className="discovery-card-copy"><p className="campaign-kicker">{ended ? "Past campaign" : "By FAVOUR"}</p><h3>{campaign.name}</h3><p>{campaign.tagline.replaceAll("—", ",")}</p>
              <div className="discovery-reward">{campaign.rewardKind === "points" ? `${campaign.rewardPerTask} points` : `${campaign.rewardPerTask} USDC`} per accepted favour{ended && <small>Campaign ended {new Date(campaign.endsAt).toLocaleDateString("en-GB", {month: "short", year: "numeric"})}. Rewards are historical.</small>}</div>
              <button type="button" onClick={() => onOpenCampaign(campaign)}>{ended ? "View campaign" : "Explore campaign"} <span aria-hidden>↗</span></button>
            </div>
          </article>;
        })}
        {c && <article className="discovery-card"><img src="/campaign-friends.jpg" alt="People sharing time together" /><div className="discovery-card-copy"><p className="campaign-kicker">Company campaign</p><h3>{c.campaign.company}</h3><CompanyTrust c={c.campaign} /><ProductLine c={c.campaign} /><p>{c.campaign.brief}</p><div className="discovery-reward">{c.campaign.rewardPerPiecePoints} points per accepted piece · {c.openPieces} pieces open</div><button type="button" onClick={() => onOpenCompany(c.campaign.id)}>Explore campaign ↗</button></div></article>}
      </div>
      <button type="button" className="campaign-builder-link" onClick={onForCompanies}>For teams: plan a campaign <span aria-hidden>↗</span></button>
    </section>
  );
}

export function TokenLaunchPreviewView({ onBack, onWelcome }: { onBack: () => void; onWelcome: () => void }) {
  const steps = [
    ["Try a real favour", "Complete a useful step in an existing campaign and submit your own proof."],
    ["Examine the result", "See what was accepted, what was rejected, and what the record can honestly show."],
    ["Shape the token plan", "Tell us whether a completion token would help you trust the work, and what it must never imply."],
  ];
  return <div className="token-preview-page">
    <button type="button" className="token-preview-back" onClick={onBack}>← Campaigns</button>
    <div className="token-preview-hero"><p className="campaign-kicker">Campaign example · Planning only</p><h1>Shape a FAVOUR token launch.</h1><p>One question runs through all three steps: what should a record of completed favours mean to the people who did the work?</p></div>
    <p className="token-preview-note">This is an example of a connected campaign. It is not open for contributions. There is no FAVOUR token, token reward, sale, mint or payment in this example.</p>
    <ol className="token-preview-steps">{steps.map(([title, description], i) => <li key={title}><span>0{i + 1}</span><div><h2>{title}</h2><p>{description}</p></div></li>)}</ol>
    <button type="button" className="token-preview-action" onClick={onWelcome}>Try the open Welcome campaign <span aria-hidden>↗</span></button>
  </div>;
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
        {(
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/campaign-friends.jpg" alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/65 to-black/40" />
        <div className="relative px-6 pt-12 pb-6">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Welcome campaign · points</span>
          <h1 className="mt-1.5 text-[28px] font-bold leading-[1.1] tracking-tight">{welcome.campaign.name}</h1>
          <p className="mt-2 text-[14px] leading-snug text-white/80">Help FAVOUR show what real people can do, one accepted favour at a time.</p>
          <p className="mt-4 text-sm text-white">Rewards are shown on each favour. Points only, no cash payment.</p>
          <div className="mt-4">
            <ProgressDots total={total} done={done} waiting={welcome.steps.filter((s) => s.state === "sent" || s.state === "in_review").length} />
            <p className="mt-2 text-[12px] text-white/70">{signedIn ? `${done} of ${total} done` : `${total} favours`} · runs until {new Date(welcome.campaign.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
        </div>
      </div>
      <div className="px-6 pt-5 pb-8 flex flex-col gap-3">
        <div className="rounded-2xl bg-white border border-gray-200 px-4 py-3">
          <p className="text-[18px] font-semibold text-gray-900">A small favour, with a clear answer.</p>
          <div className="campaign-loop"><div><b>1</b><strong>The request</strong><span>Pick a favour below and read what to send.</span></div><div><b>2</b><strong>Your proof</strong><span>Share your own photo or answer, with your permission.</span></div><div><b>3</b><strong>The result</strong><span>See whether it was accepted and why.</span></div><div><b>4</b><strong>Your reward</strong><span>Accepted work adds the stated points to your record.</span></div></div>
          <details className="mt-2 text-[13px] leading-snug text-gray-700"><summary className="cursor-pointer font-semibold">How checking and rewards work</summary><ul className="mt-2 flex flex-col gap-1 list-disc pl-4">
            <li>Each favour is yours to do. Someone else&apos;s proof never takes it from you.</li>
            <li>An automatic check reads your proof. Accepted work adds the stated points.</li>
            <li>If the check is unsure, 3 qualified reviewers look and 2 must accept. If checking is unavailable, no points change. You can try again.</li>
            <li>Points only. No USDC is paid by this campaign.</li>
          </ul></details>
        </div>
        {error && <p role="alert" className="text-[14px] text-error-700 bg-error-100 border border-error-200 rounded-xl px-4 py-3">{error}</p>}
        {total === 0 && <p className="rounded-2xl bg-white border border-gray-200 p-4 text-[14px] text-gray-600">The Welcome favour list is being refreshed. No favours are available to start in this campaign right now.</p>}
        <ol className="flex flex-col gap-2.5">
          {welcome.steps.map((s, i) => (
            <li key={s.sourceTaskId} className="rounded-2xl bg-white border border-gray-200 p-4">
              <img src="/campaign-friends.jpg" alt="" className="favour-card-image rounded-xl mb-4" loading="lazy" />
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
