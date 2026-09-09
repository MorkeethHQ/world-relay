import { NextRequest, NextResponse } from "next/server";
import { getCampaignById } from "@/lib/campaign-store";
import { listTasks, listTaskCompletions } from "@/lib/store";
import { getAuthedAddress } from "@/lib/session";
import { sanitizeInput } from "@/lib/sanitize";
import {
  assertNoMoneyFields,
  buildRoundDraft,
  roundBaseline,
  diffRoundDraft,
  getRoundDraft,
  roundOffer,
  saveRoundDraft,
  validateRoundDraft,
} from "@/lib/campaign-round";

// The next round of a requester campaign: read by anybody, written only by the
// requester who owns the campaign.
//
// A POST here creates a DRAFT. It does not create a task, open work, or promise
// a reward to anyone. See src/lib/campaign-round.ts for why that boundary is
// where it is.

export const dynamic = "force-dynamic";

async function loadRound(id: string) {
  const campaign = await getCampaignById(id);
  if (!campaign) return null;
  const tasks = (await listTasks()).filter((t) => t.campaignId === id);
  const completions = (await Promise.all(tasks.map((t) => listTaskCompletions(t.id)))).flat();
  // Round 1 is the campaign as launched, so the draft is always the round after
  // the number of rounds that have actually run.
  const currentRound = Math.max(1, tasks.length);
  return { campaign, tasks, completions, currentRound };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadRound(id);
  if (!loaded) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  const { campaign, tasks, completions, currentRound } = loaded;

  const draft = await getRoundDraft(id);
  const authed = getAuthedAddress(req, Date.now());
  const isOwner = !!authed && !!campaign.owner && authed.toLowerCase() === campaign.owner.toLowerCase();

  // Outcome of the round that ran.
  //
  // `accepted` is the only count the store can actually source: an accepted
  // completion is a record, and a rejected submission is not. A rejected proof
  // reopens the task and clears its note, so there is no per-campaign rejection
  // tally anywhere in the store. Rather than derive one and dress it as data,
  // this reports what exists and the UI says the rest in words. (Measured
  // 2026-09-09 by driving a real rejection through the isolated store: the task
  // came back status open, verificationResult null, proofNote empty.)
  const accepted = completions.length;
  const capacity = tasks.reduce((sum, t) => sum + (t.maxCompletions || 0), 0);

  const completedCurrentRound = !!authed && completions.some(
    (c) => String(c.claimant || "").toLowerCase() === authed.toLowerCase(),
  );

  const offer = roundOffer({
    draftExists: !!draft,
    round: draft?.round ?? currentRound + 1,
    wallet: authed,
    completedCurrentRound,
  });

  return NextResponse.json({
    campaignId: id,
    currentRound,
    outcome: { accepted, capacity, rejectedCount: null },
    isOwner,
    // What round 1 said, so the editor opens on the real brief instead of on
    // empty boxes. An empty editor is how a requester accidentally publishes a
    // round with no proof requirement.
    baseline: roundBaseline(campaign),
    draft: draft ? { ...draft, changes: diffRoundDraft(campaign, draft) } : null,
    offer,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadRound(id);
  if (!loaded) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  const { campaign, currentRound } = loaded;

  if (!campaign.owner) {
    return NextResponse.json({ error: "Only a requester campaign can be run again." }, { status: 400 });
  }
  const authed = getAuthedAddress(req, Date.now());
  if (!authed || authed.toLowerCase() !== campaign.owner.toLowerCase()) {
    return NextResponse.json({ error: "Only the verified requester can draft the next round." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send the edited brief." }, { status: 400 });

  const moneyError = assertNoMoneyFields(body);
  if (moneyError) return NextResponse.json({ error: moneyError }, { status: 400 });

  const existing = await getRoundDraft(id);
  const draft = buildRoundDraft(
    campaign,
    currentRound + 1,
    authed,
    {
      ask: body.ask === undefined ? undefined : sanitizeInput(String(body.ask), 500),
      proof: body.proof === undefined ? undefined : sanitizeInput(String(body.proof), 300),
      repeats: body.repeats === undefined ? undefined : sanitizeInput(String(body.repeats), 300),
      completion: Array.isArray(body.completion)
        ? body.completion.slice(0, 6).map((v) => sanitizeInput(String(v), 180)).filter(Boolean)
        : undefined,
      rewardPoints: body.rewardPoints === undefined ? undefined : Number(body.rewardPoints),
      completionsPerCycle: body.completionsPerCycle === undefined ? undefined : Number(body.completionsPerCycle),
    },
    new Date(),
    existing,
  );

  const invalid = validateRoundDraft(draft, campaign);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  await saveRoundDraft(draft);
  return NextResponse.json({
    draft: { ...draft, changes: diffRoundDraft(campaign, draft) },
    published: false,
    note: "Saved as a draft. No favour was created and nobody has been promised a reward.",
  });
}
