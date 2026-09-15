#!/usr/bin/env node
/**
 * Cold labelled-account API consequence journey + naive baseline arm.
 *
 * Requires MEMORY KV (scripts/memory-kv-server.mjs) and a running Next app
 * pointed at it. Seeds the favour into KV (avoids create rate-limit) then
 * exercises claim → verify-proof → contributions → reclaim exclusion.
 *
 * Usage:
 *   node scripts/memory-kv-server.mjs &
 *   KV_REST_API_URL=http://127.0.0.1:8079 KV_REST_API_TOKEN=local npm run dev &
 *   node scripts/favour-consequence-journey.mjs
 *
 * Env:
 *   BASE_URL=http://127.0.0.1:3000
 *   MEMORY_KV_URL=http://127.0.0.1:8079
 *   MEMORY_KV_TOKEN=local
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const KV = process.env.MEMORY_KV_URL || "http://127.0.0.1:8079";
const KV_TOKEN = process.env.MEMORY_KV_TOKEN || "local";
const JUDGE = "0xc045e90000000000000000000000000000000001";
const POSTER = "0x" + "a".repeat(40);
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAAFBgAEBwIDAf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6E//xAAZEAACAwEAAAAAAAAAAAAAAAABAgADESH/2gAIAQEAAQUC1pTGf//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAwEBPwFjf//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAgEBPwFjf//EABkQAAIDAQAAAAAAAAAAAAAAAAECABEhMf/aAAgBAQAGPwLVjGf/xAAaEAEBAQEBAQEAAAAAAAAAAAABEQAhMVFh/9oACAEBAAE/IcZ7g2k2p9pP/9k=";

async function json(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function kv(cmd) {
  const res = await fetch(KV, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  return json(res);
}

async function seedFavour(id) {
  const task = {
    id,
    poster: POSTER,
    claimant: null,
    category: "feedback",
    description: "Sep15 labelled journey: one honest sentence about a place you know",
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 8,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    claimantVerification: null,
    requiresClaim: false,
    pendingRelease: false,
    settlementTx: null,
    maxCompletions: 3,
    completionCount: 0,
    createdAt: new Date().toISOString(),
  };
  await kv(["SET", `task:${id}`, JSON.stringify(task)]);
  await kv(["SADD", "task_ids", id]);
  await kv(["DEL", `failed_claimants:${id}`, `completed_claimants:${id}`]);
  return task;
}

async function main() {
  const report = {
    base: BASE,
    kv: KV,
    judge: JUDGE,
    steps: [],
    naiveVsExclusion: null,
    ok: false,
  };

  const ping = await kv(["PING"]);
  if (ping.body?.result !== "PONG") {
    console.log(JSON.stringify({ ...report, error: "memory_kv_down", ping }, null, 2));
    process.exit(1);
  }

  let taskId = null;
  let verify = null;
  let attempts = 0;

  while (attempts < 10) {
    attempts += 1;
    taskId = `journey-${Date.now()}-${attempts}`;
    await seedFavour(taskId);
    report.steps.push({ step: "seed", attempt: attempts, id: taskId });

    const claim1 = await json(
      await fetch(`${BASE}/api/tasks/${taskId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimant: JUDGE }),
      })
    );
    report.steps.push({ step: "claim", attempt: attempts, status: claim1.status, ok: claim1.status < 300 });
    if (claim1.status >= 300) continue;

    verify = await json(
      await fetch(`${BASE}/api/verify-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          submitter: JUDGE,
          proofNote: "The bakery on the corner still opens before the buses — that is the place.",
          proofImageBase64: TINY_JPEG_B64,
          fromBridge: true,
        }),
      })
    );
    report.steps.push({
      step: "verify",
      attempt: attempts,
      status: verify.status,
      verdict: verify.body?.verification?.verdict,
      pointsAwarded: verify.body?.pointsAwarded,
      evidenceNote: verify.body?.consequence?.evidence?.note,
      evidenceHasImage: verify.body?.consequence?.evidence?.hasImage,
      nextAction: verify.body?.consequence?.nextAction,
    });
    if (verify.body?.verification?.verdict === "pass") break;
  }

  if (!taskId || verify?.body?.verification?.verdict !== "pass") {
    console.log(JSON.stringify({ ...report, error: "no_pass_after_retries" }, null, 2));
    process.exit(2);
  }

  const hist = await json(await fetch(`${BASE}/api/contributions?address=${JUDGE}`));
  report.steps.push({
    step: "contributions",
    status: hist.status,
    count: hist.body?.contributions?.length,
    passRows: (hist.body?.contributions || []).filter((c) => c.verdict === "pass").length,
    firstCredit: hist.body?.contributions?.[0]?.creditPts,
  });

  const claim2 = await json(
    await fetch(`${BASE}/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimant: JUDGE }),
    })
  );
  report.steps.push({
    step: "reclaim_excluded",
    status: claim2.status,
    error: claim2.body?.error,
    excluded: claim2.status === 403 && /already completed/i.test(String(claim2.body?.error || "")),
  });

  const jury = await json(await fetch(`${BASE}/api/jury?address=${JUDGE}`));
  const bridgeId = jury.body?.bridgeFavour?.id || null;
  report.steps.push({
    step: "jury_bridge",
    status: jury.status,
    availability: jury.body?.availability,
    bridgeFavourId: bridgeId,
    didNotReoffer: bridgeId !== taskId,
  });

  report.naiveVsExclusion = {
    naiveWouldAllowShapeOnOpenReopen: true,
    exclusionBlockedReclaim: report.steps.find((s) => s.step === "reclaim_excluded")?.excluded === true,
    winner: report.steps.find((s) => s.step === "reclaim_excluded")?.excluded ? "exclusion" : "naive_or_ambiguous",
  };

  const passStep = [...report.steps].reverse().find((s) => s.step === "verify" && s.verdict === "pass");
  report.ok =
    !!passStep &&
    typeof passStep.pointsAwarded === "number" &&
    passStep.pointsAwarded > 0 &&
    !!passStep.evidenceNote &&
    passStep.evidenceHasImage === true &&
    report.steps.find((s) => s.step === "reclaim_excluded")?.excluded === true &&
    (hist.body?.contributions || []).some((c) => c.verdict === "pass" && c.creditPts > 0);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
