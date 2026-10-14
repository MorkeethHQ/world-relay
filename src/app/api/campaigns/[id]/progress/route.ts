import { NextRequest, NextResponse } from "next/server";
import { isOwnSession } from "@/lib/session";
import { getUnlockProgress } from "@/lib/campaign-unlock";
import { getCampaign } from "@/lib/campaigns";

// Read-only unlock progress for the campaign page progress bar. Progress and
// payouts are written ONLY by the verify-proof pass path and the reconcile
// cron — this route never mutates state, so a caller can probe any address
// without side effects.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Unknown campaign" }, { status: 404 });
  if (!campaign.unlock) return NextResponse.json({ unlock: null });

  const asked = new URL(req.url).searchParams.get("address");
  // Own data only (14 Oct 2026): with SESSION_ENFORCE off, naming any wallet
  // here returned that person's progress, payout and its tx. Another viewer gets the anonymous view.
  const address = asked && isOwnSession(req, asked, Date.now()) ? asked : null;
  if (!address || !address.startsWith("0x") || address.length !== 42) {
    // No (or non-wallet) viewer: static config only, no per-user state.
    return NextResponse.json({
      unlock: {
        threshold: campaign.unlock.unlockThreshold,
        unlockAmount: campaign.unlock.unlockAmount,
        requiresOrb: campaign.unlock.requiresOrb,
        progress: 0,
        paid: false,
        payTx: null,
        potExhausted: false,
      },
    });
  }

  const progress = await getUnlockProgress(id, address);
  return NextResponse.json({
    unlock: progress && {
      threshold: progress.threshold,
      unlockAmount: progress.unlockAmount,
      requiresOrb: campaign.unlock.requiresOrb,
      progress: progress.progress,
      paid: progress.paid,
      payTx: progress.payTx,
      potExhausted: progress.potExhausted,
    },
  });
}
