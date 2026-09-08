import Link from "next/link";
import { notFound } from "next/navigation";
import { getCampaignById } from "@/lib/campaign-store";
import { listTasks } from "@/lib/store";
import { rewardAmountLabel } from "@/lib/reward";
import { RequesterCampaignStatus } from "@/components/RequesterCampaignStatus";

// ---------------------------------------------------------------------------
// The public campaign proposition (F1, 2026-09-08).
//
// Why this route exists: a campaign could only be seen from inside the app,
// behind sign-in, as client view state with no URL. A cold visitor could not
// read who was asking, what the work was, what counted as done, what proof was
// required, what they got, or why the ask repeats. This is that page, and it is
// a real route so it can be linked to.
//
// Reward amounts are rendered ONLY through reward.ts (rewardAmountLabel), and
// money-green is used ONLY for a real USDC unlock. A points campaign never
// wears money colours (DESIGN-SYSTEM.md).
//
// No hero photograph is rendered here on purpose. The stock images in
// /public/hero are decoration, and this page is the requester's evidence
// surface. Decoration next to a claim reads as evidence for the claim.
// ---------------------------------------------------------------------------

// Requester campaigns are created at runtime. Do not freeze the campaign store
// into a build artifact or touch the live store during `next build`.
export const dynamic = "force-dynamic";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
      {children}
    </p>
  );
}

export default async function CampaignPropositionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaignById(id);
  if (!campaign) notFound();

  const campaignTasks = (await listTasks())
    .filter((task) => task.campaignId === campaign.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const activeTask = campaignTasks.find((task) => task.status === "open" || task.status === "claimed") ?? null;
  const latestTask = activeTask ?? campaignTasks[0] ?? null;
  const cadence = campaign.cadence;
  const currentCycle = Math.min(latestTask ? (latestTask.recurring?.completedRuns ?? 0) + 1 : 1, cadence?.totalCycles ?? Number.MAX_SAFE_INTEGER);
  const cycleTarget = cadence?.completionsPerCycle ?? latestTask?.maxCompletions ?? 0;
  const cycleFilled = latestTask?.status === "completed" ? cycleTarget : latestTask?.completionCount ?? 0;
  const totalVerified = campaignTasks.reduce((sum, task) => sum + (task.completionCount || 0), 0);

  const brief = campaign.commission ?? null;
  const isPoints = campaign.rewardKind !== "usdc";
  const perFavour = rewardAmountLabel({
    rewardType: isPoints ? "points" : "usdc",
    bountyUsdc: campaign.rewardPerTask,
  });
  const unlock = campaign.unlock;
  // Money green means real, committed USDC. A points campaign is amber, and a
  // USDC-denominated campaign with no funded pot is neither: it is gray, the
  // same rule RewardBadge applies to a posted-but-unfunded money task.
  const amountColour = isPoints
    ? "text-amber-600"
    : unlock
      ? "text-success-600"
      : "text-gray-400";
  // Formatted in UTC. endsAt is a UTC instant, and rendering it in the server's
  // local zone shifted "31 August" to "1 September" in the first screenshot run.
  const ends = new Date(campaign.endsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-lg bg-gray-50 pb-28">
        {/* Header. Back control is top-left, the one back system. */}
        <div className={`bg-gradient-to-br ${campaign.heroGradient} px-5 pb-7 pt-4`}>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-white/80 underline underline-offset-2"
          >
            <span aria-hidden="true">&#8592;</span> Back to favours
          </Link>

          <div className="mt-3 flex items-center gap-2">
            <Chip>Campaign</Chip>
            <Chip>{campaign.location}</Chip>
          </div>

          {/* JOURNEY POINT 1: who is asking, and what recurring work they want. */}
          <p className="mt-5 text-[13px] font-semibold text-white/70">
            {brief ? brief.requester : campaign.brand} is asking for
          </p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-white">
            {campaign.name}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/80">
            {campaign.tagline}
          </p>
          {brief && (
            <p className="mt-4 border-t border-white/15 pt-4 text-[13px] leading-relaxed text-white/70">
              {brief.requesterKind}
            </p>
          )}
        </div>

        <div className="space-y-3 px-4 pt-4">
          {campaign.media ? (
            <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <img src={campaign.media.url} alt={campaign.media.alt} className="aspect-video w-full object-cover" />
              <figcaption className="px-4 py-2 text-[11px] text-gray-400">Uploaded by the requester</figcaption>
            </figure>
          ) : campaign.owner ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-5 text-center">
              <SectionLabel>No campaign media</SectionLabel>
              <p className="mt-2 text-[13px] text-gray-500">The requester did not upload an image. FAVOUR does not add stock media.</p>
            </div>
          ) : null}

          {cadence && latestTask && (
            <section className="rounded-2xl border-2 border-gray-900 bg-white px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SectionLabel>Cycle {currentCycle} of {cadence.totalCycles}</SectionLabel>
                  <p className="mt-1 text-[18px] font-bold text-gray-950">{cycleFilled} of {cycleTarget} verified</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">{totalVerified} total</span>
              </div>
              <div className="mt-4 grid grid-cols-5 gap-2" aria-label={`${cycleFilled} of ${cycleTarget} positions filled`}>
                {Array.from({ length: cycleTarget }, (_, index) => (
                  <span key={index} className={`h-3 rounded-full ${index < cycleFilled ? "bg-amber-500" : "bg-gray-100"}`} />
                ))}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
                Each block is a different verified wallet. When all {cycleTarget} fill, cycle {Math.min(currentCycle + 1, cadence.totalCycles)} opens with a clean set of blocks.
              </p>
            </section>
          )}

          {!brief && (
            /* Honest empty state. No brief was published, so none is invented. */
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center">
              <SectionLabel>No brief published</SectionLabel>
              <p className="mt-2 text-[14px] font-semibold leading-snug text-gray-900">
                This requester has not stated their terms yet.
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
                What counts as done, what proof is required and why the ask
                repeats are all missing. We will not guess them on the
                requester&apos;s behalf. The favours below are real and open.
              </p>
            </div>
          )}

          {brief && (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <SectionLabel>What they want</SectionLabel>
                <p className="mt-2 text-[14px] leading-relaxed text-gray-700">
                  {brief.asks}
                </p>
              </div>

              {/* JOURNEY POINT 2: the participant's actual task. */}
              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <SectionLabel>Your task</SectionLabel>
                <ul className="mt-2.5 space-y-2">
                  {campaign.taskDescriptions.slice(0, 5).map((d) => (
                    <li key={d} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-900"
                      />
                      <span className="text-[14px] leading-snug text-gray-900">
                        {d}
                      </span>
                    </li>
                  ))}
                </ul>
                {campaign.taskDescriptions.length > 5 && (
                  <p className="mt-2.5 text-[12px] text-gray-400">
                    {campaign.taskDescriptions.length - 5} more favours in this
                    campaign.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <SectionLabel>What counts as done</SectionLabel>
                <ul className="mt-2.5 space-y-2">
                  {brief.completion.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300"
                      />
                      <span className="text-[14px] leading-snug text-gray-700">
                        {c}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3.5 border-t border-gray-100 pt-3.5">
                  <SectionLabel>Proof required</SectionLabel>
                  <p className="mt-2 text-[14px] leading-relaxed text-gray-700">
                    {brief.proof}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Reward terms. Amounts come from reward.ts only. Points are amber,
              real USDC is green, and the two are never dressed the same. */}
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <SectionLabel>What you receive</SectionLabel>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-gray-700">
                Every verified favour
              </span>
              <span
                className={`text-[17px] font-bold tabular-nums ${amountColour}`}
              >
                {perFavour}
              </span>
            </div>
            {unlock ? (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] leading-snug text-gray-700">
                    {unlock.unlockThreshold === 1
                      ? "One clean favour, as an Orb-verified human"
                      : `${unlock.unlockThreshold} clean favours, as an Orb-verified human`}
                  </span>
                  <span className="shrink-0 text-[17px] font-bold tabular-nums text-success-600">
                    {rewardAmountLabel({
                      rewardType: "usdc",
                      bountyUsdc: unlock.unlockAmount,
                    })}
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
                  Paid from a pot of ${unlock.pot}, so it covers{" "}
                  {Math.floor(unlock.pot / unlock.unlockAmount)} humans. When the
                  pot is gone, the cash is gone and the points continue. No Orb,
                  no cash.
                </p>
              </div>
            ) : isPoints ? (
              <p className="mt-2.5 text-[12px] leading-relaxed text-gray-400">
                Points only. There is no USDC in this campaign, and nothing here
                pays cash.
              </p>
            ) : (
              /* Listed in USDC with no funded pot behind it. Custody is retired,
                 so the only live cash rail is a campaign unlock, and this
                 campaign has none. Saying so is the whole point. */
              <p className="mt-2.5 text-[12px] leading-relaxed text-gray-400">
                Listed in USDC, but no pot is committed to this campaign, so
                nothing here pays cash today.
              </p>
            )}
          </div>

          {/* JOURNEY POINT 3: why it repeats, with the mechanic named. */}
          {brief && (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <SectionLabel>Why it repeats</SectionLabel>
              <p className="mt-2 text-[14px] leading-relaxed text-gray-900">
                {brief.repeats}
              </p>
              <p className="mt-2.5 text-[13px] leading-relaxed text-gray-500">
                {brief.repeatsMechanic}
              </p>
              <p className="mt-3 text-[12px] text-gray-400">
                Open now. Runs until {ends}.
              </p>
            </div>
          )}

          {/* JOURNEY POINT 4: one primary CTA, to a route that works. */}
          <Link
            href={campaign.owner && activeTask ? `/?task=${activeTask.id}` : `/?campaign=${campaign.id}`}
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-[15px] font-semibold text-white active:scale-[0.98]"
          >
            {campaign.owner && activeTask ? "Do this campaign favour" : "See the open favours"}
          </Link>

          {campaign.owner && <RequesterCampaignStatus campaignId={campaign.id} />}

          <Link
            href="/c/new"
            className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-gray-900 bg-white px-4 text-[15px] font-semibold text-gray-900 active:scale-[0.98]"
          >
            Commission your own campaign
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
