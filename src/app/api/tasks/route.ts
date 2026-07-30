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
import { CUSTODY_RETIRED } from "@/lib/custody";
import { escrowV2Enabled, escrowV2MaxUsd } from "@/lib/escrow-v2";
import {
  resolvePostingPrivilege,
  auditPostingPrivilege,
  seedAuthEnforced,
  SEED_SECRET_HEADER,
} from "@/lib/seeder";

export async function GET() {
  trackEvent("feed_loaded").catch(() => {});
  const tasks = (await listTasks()).filter(isPublicTask);
  // BOARD-RULES.md R1+R5 are enforced here too, so API consumers (agents,
  // integrations) get the same board composition as the app.
  const ordered = orderBoardForApi(tasks, Date.now());
  // Perf (Oscar live-test Jul 8): the board/list view renders only verdict,
  // confidence and reasoning — never the per-model AI breakdown. Dropping
  // verificationResult.models here cuts ~24% off the list payload (~44KB across
  // ~85 tasks, measured on prod). The detail page (/task/[id]) fetches the full
  // task separately, so its model panel is unaffected.
  const list = toApiTasks(ordered).map((t) =>
    t.verificationResult?.models
      ? { ...t, verificationResult: { ...t.verificationResult, models: undefined } }
      : t
  );
  return NextResponse.json({ tasks: list }, {
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

  // Posting PRIVILEGE (authenticated) and agent IDENTITY (AGENT_REGISTRY) are
  // resolved separately. They shared the `agent:` namespace until Jul 15, which
  // both kept the agent layer dark on 107/107 tasks and let any caller mint the
  // seeding exemption by typing "agent:" into a public field. See src/lib/seeder.ts.
  // Enforcement is dormant (SEED_AUTH_ENFORCE) until the seeding caller sends the
  // header; auditPostingPrivilege logs every would-be denial until then.
  const OWNER = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";
  const privilege = resolvePostingPrivilege({
    poster,
    agentId,
    seedSecretHeader: req.headers.get(SEED_SECRET_HEADER),
    adminSecret: process.env.ADMIN_SECRET,
    ownerAddress: OWNER,
    enforced: seedAuthEnforced(),
  });
  auditPostingPrivilege(privilege, poster);
  const resolvedAgentId = privilege.agentId;
  const isAdmin = privilege.isAdmin;
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

  // Money favours, two rails, one rule each:
  //  - Legacy "usdc" (retired proxy escrow): NEVER accepted. Custody stays closed.
  //  - "usdc-v2" (FavourEscrowV2): accepted ONLY while ESCROW_V2_ENABLED=1, and
  //    NO money moves at posting — the poster funds from their own wallet at
  //    claimant-accept (demand-gated custody, escrow-v2-design.md). Rejected,
  //    not silently converted to points — a $5 request quietly stored as 5
  //    points would both misrepresent what the poster asked for and route
  //    around the 1-10 points cap below.
  const isV2Post = rewardType === "usdc-v2";
  if (isV2Post) {
    if (!escrowV2Enabled()) {
      return NextResponse.json({
        error: "USDC favours are not available right now. Post a points favour instead.",
      }, { status: 400 });
    }
    // Poster must be a wallet address: they will be the on-chain funder.
    if (!/^0x[0-9a-fA-F]{40}$/.test(poster)) {
      return NextResponse.json({
        error: "USDC favours require a wallet-verified poster.",
      }, { status: 400 });
    }
    const maxUsd = escrowV2MaxUsd();
    if (bountyNum > maxUsd) {
      return NextResponse.json({
        error: `USDC favours are capped at $${maxUsd} right now.`,
      }, { status: 400 });
    }
    if ((maxCompletions ? Number(maxCompletions) : 1) > 1) {
      return NextResponse.json({
        error: "USDC favours are single-completion — one escrow funds one payout.",
      }, { status: 400 });
    }
  } else if (CUSTODY_RETIRED && rewardType !== "points") {
    return NextResponse.json({
      error: "FAVOUR no longer holds funds in escrow. Post a points favour instead.",
    }, { status: 400 });
  }

  if (rewardType === "points" && !isAdmin) {
    // Points value is capped low (1-10) — points are engagement, not money.
    if (bountyNum < 1 || bountyNum > 10) {
      return NextResponse.json({ error: "Points favours must be between 1 and 10 points." }, { status: 400 });
    }
    // One free points task per poster per 24h. The old copy here told users to
    // "fund the task with USDC" to lift the cap — with custody retired that is
    // an offer the app can no longer honour, so it does not get made.
    const recentPoints = (await listTasks()).filter(
      (t) => t.poster === poster && t.rewardType === "points" && Date.now() - new Date(t.createdAt).getTime() < 86_400_000
    );
    if (recentPoints.length >= 1) {
      return NextResponse.json({ error: "You can post one favour a day. Come back tomorrow." }, { status: 429 });
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

  // Custody retired: no new task may be recorded against the escrow. The
  // encoders already refuse to build the funding transaction, so an onChainId
  // arriving here can only be a stale client or a hand-rolled request — either
  // way it is dropped rather than stored, and the task lands as points. This is
  // the server half of the rule; the UI half is the removed reward picker.
  // See src/lib/custody.ts.
  const isUsdc = !CUSTODY_RETIRED && rewardType !== "points";
  let verifiedOnChainId: number | null =
    CUSTODY_RETIRED ? null : onChainId != null ? Number(onChainId) : null;
  let verifiedEscrowTxHash: string | null = CUSTODY_RETIRED ? null : escrowTxHash || null;
  if (CUSTODY_RETIRED && (onChainId != null || escrowTxHash)) {
    console.error("[Tasks] escrow reference received after custody retirement; dropped");
  }
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
    // A v2 task NEVER stores client-supplied escrow markers: it is born
    // unfunded by design and only /api/escrow-v2 verify-funded (an on-chain
    // read + receipt check) may set them later.
    onChainId: isV2Post ? null : verifiedOnChainId,
    escrowTxHash: isV2Post ? null : verifiedEscrowTxHash,
    taskType: taskType || "standard",
    rewardType: rewardType === "points" ? "points" : isV2Post ? "usdc-v2" : "usdc",
    donOnChainId: donOnChainId != null ? Number(donOnChainId) : null,
    maxCompletions: requestedCompletions,
    campaignId: validCampaignId,
  });

  trackEvent("task_created", { taskId: task.id, poster, bounty: task.bountyUsdc, category: task.category, funded: !!verifiedEscrowTxHash }).catch(() => {});
  postTaskCreated(task).catch(console.error);

  // Award Proof of Favour points for posting a task — but ONLY for a capped
  // points post (throttled to 1/day above) or a genuinely funded USDC post.
  // An unfunded "usdc" post has no daily cap, so awarding it +3 let a farmer
  // mint ~15 pts/min by posting unfunded tasks; gate the reward on real funding.
  const postEarns = rewardType === "points" || verifiedOnChainId != null || !!verifiedEscrowTxHash;
  if (postEarns) recordFavourPosted(poster).catch(console.error);

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
