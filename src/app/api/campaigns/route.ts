import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/store";
import { getAuthedAddress, addressMatches } from "@/lib/session";
import { sanitizeInput } from "@/lib/sanitize";
import { uploadCampaignImage } from "@/lib/image-upload";
import {
  listRequesterCampaigns,
  ownerMayCreateCampaign,
  persistRequesterCampaign,
  validateRequesterCampaignPolicy,
  type RequesterCampaign,
} from "@/lib/campaign-store";
import type { TaskCategory } from "@/lib/types";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { gibberishReason } from "@/lib/post-quality";

const CATEGORIES: TaskCategory[] = ["photo", "delivery", "check-in", "custom", "feedback", "review", "social", "errand"];

export async function GET() {
  return NextResponse.json({ campaigns: await listRequesterCampaigns() });
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 1_500_000) return NextResponse.json({ error: "Campaign request is too large." }, { status: 413 });
  const { ok } = await rateLimit(`campaign:create:${getClientIp(req)}`, 3, 86_400_000);
  if (!ok) return NextResponse.json({ error: "Campaign creation limit reached. Try again tomorrow." }, { status: 429 });
  // Requester campaigns create many point slots. This gate is deliberately
  // stricter than the global SESSION_ENFORCE switch: no signed wallet session,
  // no organization/campaign posting privilege.
  const authed = getAuthedAddress(req, Date.now());
  if (!authed) return NextResponse.json({ error: "A verified wallet session is required." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !addressMatches(authed, body.requester)) {
    return NextResponse.json({ error: "The requester must match the signed-in wallet." }, { status: 403 });
  }

  const name = sanitizeInput(body.name, 80);
  const requesterName = sanitizeInput(body.requesterName, 80);
  const requesterKind = sanitizeInput(body.requesterKind, 160);
  const ask = sanitizeInput(body.ask, 500);
  const proof = sanitizeInput(body.proof, 300);
  const repeats = sanitizeInput(body.repeats, 300);
  const location = sanitizeInput(body.location || "Worldwide", 100);
  const completion = Array.isArray(body.completion)
    ? body.completion.slice(0, 6).map((value: unknown) => sanitizeInput(String(value), 180)).filter(Boolean)
    : [];
  const rewardPoints = Number(body.rewardPoints);
  const completionsPerCycle = Number(body.completionsPerCycle);
  const intervalHours = Number(body.intervalHours);
  const totalCycles = Number(body.totalCycles);
  const category = CATEGORIES.includes(body.category) ? body.category as TaskCategory : "custom";

  if (!name || !requesterName || !requesterKind || ask.length < 20 || !proof || !repeats || completion.length === 0) {
    return NextResponse.json({ error: "Name the requester, ask, completion criteria, proof and why it repeats." }, { status: 400 });
  }
  const gibberish = gibberishReason(ask);
  if (gibberish) return NextResponse.json({ error: gibberish }, { status: 400 });
  const policyError = validateRequesterCampaignPolicy({ rewardPoints, completionsPerCycle, intervalHours, totalCycles });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
  if (!(await ownerMayCreateCampaign(authed))) {
    return NextResponse.json({ error: "You already have the maximum of 3 active campaigns." }, { status: 429 });
  }

  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "campaign"}-${crypto.randomUUID().slice(0, 8)}`;
  let media: RequesterCampaign["media"];
  if (body.mediaDataUrl) {
    try {
      media = {
        url: await uploadCampaignImage(String(body.mediaDataUrl), id),
        alt: sanitizeInput(body.mediaAlt || "Requester-uploaded campaign image", 140),
        source: "requester-upload",
      };
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid campaign media." }, { status: 400 });
    }
  }

  const createdAt = new Date().toISOString();
  const campaign: RequesterCampaign = {
    id,
    name,
    brand: requesterName,
    tagline: `${completionsPerCycle} verified completions every ${intervalHours} hours`,
    description: ask,
    heroGradient: "from-gray-950 via-gray-900 to-gray-800",
    accentColor: "#111827",
    icon: "◎",
    totalBudget: rewardPoints * completionsPerCycle * totalCycles,
    rewardPerTask: rewardPoints,
    rewardKind: "points",
    taskCount: completionsPerCycle * totalCycles,
    categories: [category],
    taskDescriptions: [ask],
    location,
    endsAt: new Date(Date.now() + intervalHours * totalCycles * 3600_000).toISOString(),
    featured: false,
    owner: authed,
    createdAt,
    ...(media ? { media } : {}),
    cadence: { completionsPerCycle, intervalHours, totalCycles },
    commission: {
      requester: requesterName,
      requesterKind,
      asks: ask,
      completion,
      proof,
      repeats,
      repeatsMechanic: `Each cycle fills with ${completionsPerCycle} different verified wallets. When full, the next ${intervalHours}-hour cycle opens.`,
    },
  };

  // The campaign policy is the only daily-cap lift: one bounded points task,
  // with a fixed completion target and fixed number of cycles. It cannot create
  // USDC tasks or arbitrary board inventory.
  await persistRequesterCampaign(campaign);
  const task = await createTask({
    poster: authed,
    category,
    description: ask,
    location,
    bountyUsdc: rewardPoints,
    deadlineHours: intervalHours,
    rewardType: "points",
    maxCompletions: completionsPerCycle,
    campaignId: id,
    recurring: { intervalHours, totalRuns: totalCycles },
  });

  return NextResponse.json({ campaign, task }, { status: 201 });
}
