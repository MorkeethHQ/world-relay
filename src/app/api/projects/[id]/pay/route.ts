import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getPublishedCampaign } from "@/lib/campaign-drafts";
import { getPayPlan, listPaySlots, takePaySlot } from "@/lib/pay-slots";
import { buildFundBatch, fundSummary, publicSlots, slotCounts, slotState } from "@/lib/pay-plan";
import { ESCROW_V2_FUND_DISCLOSURE, escrowV2Address, escrowV2DeadlineFor, escrowV2Enabled, escrowV2TaskId } from "@/lib/escrow-v2";
import { trackEvent } from "@/lib/track";

// PAID REVIEWS of one project (19 Oct 2026). Two things only live here:
//   GET            the plan, the slots and what the signed-in wallet may do.
//   POST take      a reviewer takes one slot (one per wallet, never the builder).
//   POST prepare-fund  the builder gets ONE transaction batch that funds every
//                  taken, unfunded slot, plus the summary shown before confirm.
// Everything after the builder signs goes through the EXISTING /api/escrow-v2
// route per slot (verify-funded, prepare-release, verify-released, prepare-refund,
// verify-refunded). No new contract, no new money path, FAVOUR holds nothing.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await getPayPlan(id).catch(() => null);
  if (!plan) return NextResponse.json({ plan: null }, { headers: { "Cache-Control": "no-store" } });
  const owner = await ownerOf(id);
  const me = getAuthedAddress(req, Date.now());
  const slots = await listPaySlots(id).catch(() => [] as Awaited<ReturnType<typeof listPaySlots>>);
  const pub = publicSlots(slots, me, owner ?? "");
  const isOwner = !!me && !!owner && me.toLowerCase() === owner.toLowerCase();
  const mine = me ? slots.find((t) => t.claimant?.toLowerCase() === me.toLowerCase()) : undefined;
  const unfunded = slots.filter((t) => slotState(t) === "taken" && !!t.claimant);
  return NextResponse.json(
    {
      plan,
      open: escrowV2Enabled(),
      counts: slotCounts(pub, plan),
      slots: pub,
      isOwner,
      mine: mine ? { taskId: mine.id, state: slotState(mine) } : null,
      fund: isOwner ? fundSummary(plan, unfunded, Date.now()) : null,
      disclosure: ESCROW_V2_FUND_DISCLOSURE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = getAuthedAddress(req, Date.now());
  if (!me) return NextResponse.json({ error: "Sign in first.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(me)) {
    return NextResponse.json({ error: "Open FAVOUR in World App for paid reviews.", code: "wallet_required" }, { status: 403 });
  }
  const limit = await rateLimit(`pay:${getClientIp(req)}`, 20, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  if (!escrowV2Enabled()) return NextResponse.json({ error: "Paid reviews are not open right now." }, { status: 404 });

  const body = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown };
  const campaign = await getPublishedCampaign(id).catch(() => null);
  if (!campaign) return NextResponse.json({ error: "This project is not live yet." }, { status: 404 });
  const owner = await ownerOf(id);
  if (!owner) return NextResponse.json({ error: "This project has no builder on record." }, { status: 404 });

  switch (body.action) {
    case "take": {
      const r = await takePaySlot(id, owner, campaign.productName ?? campaign.company, campaign.brief, me);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      trackEvent("pay_slot_taken", { campaignId: id, taskId: r.task.id }).catch(() => {});
      return NextResponse.json({ taskId: r.task.id, state: slotState(r.task) }, { status: 201 });
    }
    case "prepare-fund": {
      if (me.toLowerCase() !== owner.toLowerCase()) return NextResponse.json({ error: "Only the builder can fund reviews." }, { status: 403 });
      const plan = await getPayPlan(id);
      if (!plan) return NextResponse.json({ error: "This project has no paid reviews." }, { status: 404 });
      const slots = await listPaySlots(id);
      const unfunded = slots.filter((t) => slotState(t) === "taken" && t.claimant && /^0x[0-9a-fA-F]{40}$/.test(t.claimant));
      if (unfunded.length === 0) return NextResponse.json({ error: "No reviewer is waiting for funding." }, { status: 409 });
      const nowMs = Date.now();
      const items = unfunded.map((t) => ({
        taskId: t.id,
        recipient: t.claimant as `0x${string}`,
        usd: plan.perReviewUsd,
        deadline: escrowV2DeadlineFor(t.deadline, nowMs),
      }));
      const payload = buildFundBatch(items);
      if (!payload) return NextResponse.json({ error: "Paid reviews are not open right now." }, { status: 404 });
      trackEvent("pay_prepare_fund", { campaignId: id, count: items.length, usd: items.length * plan.perReviewUsd }).catch(() => {});
      return NextResponse.json({
        payload,
        contract: escrowV2Address(),
        summary: fundSummary(plan, unfunded, nowMs),
        slots: items.map((i) => ({ taskId: i.taskId, taskIdHash: escrowV2TaskId(i.taskId), amount: i.usd, deadline: i.deadline.toString() })),
        disclosure: ESCROW_V2_FUND_DISCLOSURE,
      });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}

/** The builder's wallet: the draft's owner. Read through the draft store, which
 *  the public campaign shape leaves out on purpose. */
async function ownerOf(id: string): Promise<string | null> {
  const { getRedis } = await import("@/lib/redis");
  const { DRAFT_PREFIX } = await import("@/lib/campaign-drafts");
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${DRAFT_PREFIX}${id}`).catch(() => null);
  if (!raw) return null;
  try {
    const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as { owner?: string };
    return typeof d.owner === "string" ? d.owner : null;
  } catch {
    return null;
  }
}
