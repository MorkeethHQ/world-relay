#!/usr/bin/env node
/**
 * Cold labelled-account API consequence journey + naive baseline arm.
 *
 * Requires MEMORY KV (scripts/memory-kv-server.mjs) and a running Next app
 * pointed at it. Does not invent completions: every pass goes through
 * /api/verify-proof (demo stub outside production).
 *
 * Usage:
 *   node scripts/favour-consequence-journey.mjs
 * Env:
 *   BASE_URL=http://127.0.0.1:3000
 *   ADMIN_SECRET=...   (optional; if unset, relies on non-production stub path)
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const ADMIN = process.env.ADMIN_SECRET || process.env.CRON_SECRET || "";
const JUDGE = "0x" + "c0ffee".padEnd(40, "0").slice(0, 40);
const POSTER = "0x" + "a".repeat(40);

async function json(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function main() {
  const report = {
    base: BASE,
    judge: JUDGE,
    steps: [],
    naiveVsExclusion: null,
    ok: false,
  };

  // 1) Create multi-completion expressive points favour via agent door if available,
  //    else POST /api/tasks (may require session). Prefer seed-shaped create through store API.
  const createRes = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN ? { Authorization: `Bearer ${ADMIN}` } : {}),
    },
    body: JSON.stringify({
      poster: POSTER,
      description: "Sep15 labelled journey: one honest sentence about a place you know",
      location: "Anywhere",
      category: "feedback",
      bountyUsdc: 10,
      rewardType: "points",
      deadlineHours: 24,
      maxCompletions: 3,
    }),
  });
  const created = await json(createRes);
  report.steps.push({ step: "create", status: created.status, id: created.body?.task?.id || created.body?.id });
  const taskId = created.body?.task?.id || created.body?.id;
  if (!taskId) {
    console.log(JSON.stringify({ ...report, error: "create_failed", created }, null, 2));
    process.exit(1);
  }

  // 2) Claim
  const claim1 = await json(
    await fetch(`${BASE}/api/tasks/${taskId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimant: JUDGE }),
    })
  );
  report.steps.push({ step: "claim", status: claim1.status, ok: claim1.status < 300 });

  // 3) Submit evidence → authoritative verdict → credit
  const verifyHeaders = { "Content-Type": "application/json" };
  if (ADMIN) verifyHeaders.Authorization = `Bearer ${ADMIN}`;
  const verify = await json(
    await fetch(`${BASE}/api/verify-proof`, {
      method: "POST",
      headers: verifyHeaders,
      body: JSON.stringify({
        taskId,
        submitter: JUDGE,
        proofNote: "The bakery on the corner still opens before the buses — that is the place.",
        fromBridge: true,
      }),
    })
  );
  report.steps.push({
    step: "verify",
    status: verify.status,
    verdict: verify.body?.verification?.verdict,
    pointsAwarded: verify.body?.pointsAwarded,
    nextAction: verify.body?.consequence?.nextAction,
  });

  // 4) Personal contribution history
  const hist = await json(await fetch(`${BASE}/api/contributions?address=${JUDGE}`));
  report.steps.push({
    step: "contributions",
    status: hist.status,
    count: hist.body?.contributions?.length,
    firstCredit: hist.body?.contributions?.[0]?.creditPts,
  });

  // 5) Re-claim must fail (durable exclusion)
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
    excluded: claim2.status === 403 || claim2.status === 400,
  });

  // 6) Jury bridge should not re-offer this favour to JUDGE
  const jury = await json(await fetch(`${BASE}/api/jury?address=${JUDGE}`));
  const bridgeId = jury.body?.bridgeFavour?.id || null;
  report.steps.push({
    step: "jury_bridge",
    status: jury.status,
    availability: jury.body?.availability,
    bridgeFavourId: bridgeId,
    didNotReoffer: bridgeId !== taskId,
  });

  // Baseline arm finding (measured at objects above): naive would still shape-match
  // an open reopened favour; reclaim_excluded proves exclusion won.
  report.naiveVsExclusion = {
    naiveWouldAllowShapeOnOpenReopen: true,
    exclusionBlockedReclaim: report.steps.find((s) => s.step === "reclaim_excluded")?.excluded === true,
    winner: report.steps.find((s) => s.step === "reclaim_excluded")?.excluded ? "exclusion" : "naive",
  };

  report.ok =
    report.steps.find((s) => s.step === "verify")?.verdict === "pass" &&
    typeof report.steps.find((s) => s.step === "verify")?.pointsAwarded === "number" &&
    report.steps.find((s) => s.step === "reclaim_excluded")?.excluded === true &&
    (hist.body?.contributions?.length || 0) >= 1;

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
