import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";
import { generateLocationBriefing } from "@/lib/ai-chat";
import { addMessage } from "@/lib/messages";
import { postTaskCreated } from "@/lib/xmtp";
import { broadcastEvent } from "@/lib/sse";
import { recordFavourPosted } from "@/lib/proof-of-favour";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { trackEvent } from "@/lib/track";
import { getCampaign } from "@/lib/campaigns";
import { isEscrowTaskFunded } from "@/lib/escrow";
import { isTemplateCopy, MIN_DESCRIPTION_LENGTH } from "@/lib/post-templates";
import { toApiTasks, isPublicTask } from "@/lib/task-serializer";
import { orderBoardForApi } from "@/lib/board-rank";

export async function GET() {
  trackEvent("feed_loaded").catch(() => {});
  const tasks = (await listTasks()).filter(isPublicTask);
  // BOARD-RULES.md R1+R5 are enforced here too, so API consumers (agents,
  // integrations) get the same board composition as the app.
  const ordered = orderBoardForApi(tasks, Date.now());
  return NextResponse.json({ tasks: toApiTasks(ordered) }, {
    headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" },
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`create:${ip}`, 5, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  const body = await req.json();
  const { poster, category, lat, lng, bountyUsdc, deadlineHours, onChainId, escrowTxHash, taskType, rewardType, donOnChainId, agentId, maxCompletions, campaignId } = body;

  // Only accept a campaignId that maps to a real campaign; ignore anything else
  // so a task can't be linked to a non-existent campaign.
  const validCampaignId = campaignId && getCampaign(campaignId) ? campaignId : undefined;

  // Sanitize text inputs
  const description = sanitizeInput(body.description || "", 500);
  const location = sanitizeInput(body.location || "", 200);

  if (!poster || !description || !bountyUsdc) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Authentication: require a valid poster identity (wallet address or known agent prefix)
  if (!poster || poster.length < 5) {
    return NextResponse.json({ error: "Valid poster identity required" }, { status: 401 });
  }

  // Input validation
  const bountyNum = Number(bountyUsdc);
  if (!Number.isFinite(bountyNum) || bountyNum <= 0 || bountyNum > 10000) {
    return NextResponse.json({ error: "Bounty must be between $0.01 and $10,000" }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: "Description too long (max 2000 chars)" }, { status: 400 });
  }
  if (location.length > 500) {
    return NextResponse.json({ error: "Location too long (max 500 chars)" }, { status: 400 });
  }
  if (lat !== undefined && lat !== null && (Number(lat) < -90 || Number(lat) > 90)) {
    return NextResponse.json({ error: "Invalid latitude" }, { status: 400 });
  }
  if (lng !== undefined && lng !== null && (Number(lng) < -180 || Number(lng) > 180)) {
    return NextResponse.json({ error: "Invalid longitude" }, { status: 400 });
  }

  const resolvedAgentId = agentId || (poster?.startsWith("agent:") ? poster.replace("agent:", "") : null);

  // Free points tasks are throttled so they can't spam the feed or inflate points.
  // Admin (platform owner) and agents are exempt so campaigns can still be seeded.
  const OWNER = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";
  const isAdmin = !!resolvedAgentId || (typeof poster === "string" && poster.toLowerCase() === OWNER);
  // Board quality: user posts must be written in the poster's own words.
  // Verbatim template copy and near-empty descriptions clutter the board with
  // identical tasks (agents/admin are exempt — seeding has its own copy).
  if (!isAdmin) {
    if (description.trim().length < MIN_DESCRIPTION_LENGTH) {
      return NextResponse.json({ error: "Describe your favour in a bit more detail so people know what counts as done." }, { status: 400 });
    }
    if (isTemplateCopy(description)) {
      return NextResponse.json({ error: "Describe your favour in your own words — template text can't be posted as-is." }, { status: 400 });
    }
  }

  if (rewardType === "points" && !isAdmin) {
    // Points value is capped low (1-10) — points are engagement, not money.
    if (bountyNum < 1 || bountyNum > 10) {
      return NextResponse.json({ error: "Points tasks must be between 1 and 10 points. To offer more, fund the task with USDC." }, { status: 400 });
    }
    // One free points task per poster per 24h; fund with USDC to post more.
    const recentPoints = (await listTasks()).filter(
      (t) => t.poster === poster && t.rewardType === "points" && Date.now() - new Date(t.createdAt).getTime() < 86_400_000
    );
    if (recentPoints.length >= 1) {
      return NextResponse.json({ error: "You can post 1 free points task per day. Fund a task with USDC to post more." }, { status: 429 });
    }
  }

  // Server-side funding gate: never trust the client's escrowTxHash. A USDC task
  // is only stored as funded if the on-chain escrow task (by onChainId) actually
  // exists and holds a deposited bounty that covers the requested amount. If it
  // cannot be verified on-chain, strip the escrow markers so the task is not
  // shown or processed as funded. Points tasks and DoN (donOnChainId) are
  // unaffected by this gate.
  // maxCompletions guards. A single escrow deposit funds exactly one payout, so
  // a funded task must be single-completion — otherwise the 2nd+ completer is
  // marked paid with the 1st completer's cached settlement tx and receives $0.
  // Points tasks may repeat but are capped to bound leaderboard inflation.
  const requestedCompletions = maxCompletions ? Number(maxCompletions) : 1;
  const taskIsFunded = onChainId != null || !!escrowTxHash;
  if (taskIsFunded && requestedCompletions > 1) {
    return NextResponse.json({ error: "Funded USDC tasks must be single-completion. Post a points task for multi-completion." }, { status: 400 });
  }
  if (!Number.isFinite(requestedCompletions) || requestedCompletions < 1 || requestedCompletions > 1000) {
    return NextResponse.json({ error: "maxCompletions must be between 1 and 1000" }, { status: 400 });
  }

  const isUsdc = rewardType !== "points";
  let verifiedOnChainId: number | null = onChainId != null ? Number(onChainId) : null;
  let verifiedEscrowTxHash: string | null = escrowTxHash || null;
  if (isUsdc && verifiedOnChainId !== null) {
    const funded = await isEscrowTaskFunded(verifiedOnChainId, bountyNum).catch(() => false);
    if (!funded) {
      console.error(`[Tasks] Funding unverifiable on-chain for onChainId ${verifiedOnChainId}; not storing as funded`);
      verifiedOnChainId = null;
      verifiedEscrowTxHash = null;
    }
  } else if (isUsdc && verifiedEscrowTxHash) {
    // A tx hash with no on-chain id cannot be verified, so do not treat as funded.
    console.error("[Tasks] escrowTxHash provided without onChainId; not storing as funded");
    verifiedEscrowTxHash = null;
  }

  const task = await createTask({
    poster,
    category: category || "custom",
    description,
    location: location || "Anywhere",
    lat: lat ? Number(lat) : null,
    lng: lng ? Number(lng) : null,
    bountyUsdc: Number(bountyUsdc),
    deadlineHours: Number(deadlineHours) || 24,
    agentId: resolvedAgentId,
    onChainId: verifiedOnChainId,
    escrowTxHash: verifiedEscrowTxHash,
    taskType: taskType || "standard",
    rewardType: rewardType === "points" ? "points" : "usdc",
    donOnChainId: donOnChainId != null ? Number(donOnChainId) : null,
    maxCompletions: requestedCompletions,
    campaignId: validCampaignId,
  });

  trackEvent("task_created", { taskId: task.id, poster, bounty: task.bountyUsdc, category: task.category, funded: !!verifiedEscrowTxHash }).catch(() => {});
  postTaskCreated(task).catch(console.error);

  // Award Proof of Favour points for posting a task
  recordFavourPosted(poster).catch(console.error);

  // Fire-and-forget AI scout briefing (with agent personality if available)
  generateLocationBriefing(task, task.agent?.id || undefined).then(briefing => {
    if (briefing) addMessage(task.id, "relay-bot", briefing);
  }).catch(console.error);

  broadcastEvent("task:created", {
    taskId: task.id,
    description: task.description.slice(0, 60),
    location: task.location,
    bountyUsdc: task.bountyUsdc,
    status: task.status,
    timestamp: task.createdAt,
  });

  return NextResponse.json({ task }, { status: 201 });
}
