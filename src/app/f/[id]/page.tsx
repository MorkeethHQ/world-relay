import Link from "next/link";
import { notFound } from "next/navigation";
import { getTask } from "@/lib/store";
import { isPublicTask } from "@/lib/task-serializer";
import { rewardAmountLabel, isPointsReward, isRealMoney } from "@/lib/reward";
import { proofRequirement, PROOF_DESTINATION } from "@/lib/proof-requirement";
import { ProofSlot } from "@/components/ProofSlot";
import { getCampaignById } from "@/lib/campaign-store";
import { CAMPAIGNS } from "@/lib/campaigns";

// ---------------------------------------------------------------------------
// The public request page (2026-09-09).
//
// /c/[id] proved the content model for a campaign: who asks, what counts as
// done, what proof, what you receive, why it repeats. A single favour had no
// such page. It could only be read inside the app, behind sign-in, as client
// view state. This is the same discipline applied to one favour, as a real
// route a stranger can be handed.
//
// Rules obeyed here:
//  - Reward amounts come only from reward.ts. Points are amber, real escrowed
//    USDC is green, and a USDC task with no escrow behind it is grey, never
//    green (DESIGN-SYSTEM.md, and the RewardBadge rule).
//  - No stock photograph stands in for evidence. The proof slot is drawn.
//  - Test identities never reach a public surface (isPublicTask).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-5">{children}</div>
  );
}

// CLAUDE.md: never print a raw wallet address in UI. useWorldUser's displayName
// is a client module, so this server route keeps its own short form: anything
// address-shaped or simply long is truncated, never printed in full.
function shortPoster(addr: string): string {
  if (/^0x/i.test(addr) || addr.length > 18) {
    return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
  }
  return addr;
}

export default async function FavourRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task || !isPublicTask(task)) notFound();

  const points = isPointsReward(task);
  const money = isRealMoney(task);
  // Green means real escrowed USDC and nothing else. Points amber. A
  // USDC-denominated task with no escrow is neither, so it is grey.
  const amountColour = points ? "text-amber-600" : money ? "text-success-600" : "text-gray-400";
  const amount = rewardAmountLabel(task);
  const req = proofRequirement(task.category);

  const runtimeCampaign = task.campaignId ? await getCampaignById(task.campaignId) : null;
  const staticCampaign = task.campaignId
    ? CAMPAIGNS.find((c) => c.id === task.campaignId) ?? null
    : null;
  const requesterName =
    runtimeCampaign?.commission?.requester ??
    runtimeCampaign?.brand ??
    staticCampaign?.brand ??
    shortPoster(task.poster);

  const deadline = new Date(task.deadline).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const left = Math.max(task.maxCompletions - task.completionCount, 0);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-lg pb-24">
        <div className="bg-gray-950 px-5 pb-8 pt-4">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-white/70 underline underline-offset-2"
          >
            <span aria-hidden="true">&#8592;</span> Back to favours
          </Link>

          {/* WHO IS ASKING */}
          <p className="mt-4 text-[13px] font-semibold text-white/60">
            {requesterName} is asking for
          </p>
          <h1 className="mt-2 text-[24px] font-bold leading-tight tracking-tight text-white">
            {task.description}
          </h1>
          <p className="mt-3 text-[13px] text-white/50">
            {task.location} &middot; open until {deadline}
          </p>
        </div>

        <div className="space-y-3 px-4 pt-4">
          {/* WHAT YOU RECEIVE */}
          <Card>
            <SectionLabel>What you receive</SectionLabel>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-gray-700">For one verified favour</span>
              <span className={`text-[20px] font-bold tabular-nums ${amountColour}`}>{amount}</span>
            </div>
            {points ? (
              <p className="mt-2.5 text-[12px] leading-relaxed text-gray-400">
                Points only. Nothing on this favour pays cash.
              </p>
            ) : money ? (
              <p className="mt-2.5 text-[12px] leading-relaxed text-gray-400">
                Real USDC, escrowed on-chain for this favour before you start.
              </p>
            ) : (
              <p className="mt-2.5 text-[12px] leading-relaxed text-gray-400">
                Listed in USDC with no escrow funded behind it yet, so nothing
                here pays cash today.
              </p>
            )}
          </Card>

          {/* WHAT COUNTS AS DONE */}
          <Card>
            <SectionLabel>What counts as done</SectionLabel>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-900">{task.description}</p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-gray-500">
              {req.kind === "photo"
                ? "Do the thing in the real world, then photograph it yourself. A screenshot, a stock image or a picture someone else took does not count."
                : "Answer in your own words. A generated answer does not count, and it earns nothing if it is caught."}
            </p>
          </Card>

          {/* PROOF REQUIRED, the signature device */}
          <ProofSlot category={task.category} />

          {/* WHAT HAPPENS TO THE PROOF */}
          <Card>
            <SectionLabel>What happens to your proof</SectionLabel>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{PROOF_DESTINATION}</p>
          </Card>

          {/* WHY IT REPEATS */}
          <Card>
            <SectionLabel>Why you would come back</SectionLabel>
            {task.recurring && task.recurring.totalRuns > 1 ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-900">
                The requester runs this ask {task.recurring.totalRuns} times, so
                passing once puts you in line for the next round.
              </p>
            ) : task.maxCompletions > 1 ? (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-900">
                {left > 0
                  ? `${left} of ${task.maxCompletions} places are still open on this favour, each one a different verified person.`
                  : "Every place on this favour is filled. It closes here."}
              </p>
            ) : (
              <p className="mt-2 text-[14px] leading-relaxed text-gray-900">
                This ask runs once. Requesters post new ones, so the board
                changes rather than repeating itself.
              </p>
            )}
          </Card>

          <Link
            href={`/?task=${task.id}`}
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-[15px] font-semibold text-white active:scale-[0.98]"
          >
            Do this favour
          </Link>

          <Link
            href="/"
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-[15px] font-semibold text-gray-900 active:scale-[0.98]"
          >
            Back to favours
          </Link>
        </div>
      </div>
    </main>
  );
}
