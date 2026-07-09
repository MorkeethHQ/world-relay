import { NextRequest, NextResponse } from "next/server";
import { fetchFixtures } from "@/lib/football";
import { createPrediction, resolvePrediction, findPredictionByExternalId } from "@/lib/predictions";

// Football polls, keyless (Oscar Jul 10). One hourly cron does both sides:
//  - CREATE a prediction for each upcoming fixture (home / Draw / away), locking
//    at kickoff. Deduped by ESPN event id, so re-runs are safe.
//  - RESOLVE each of our fixture-linked predictions once its match is final,
//    reusing the existing pro-rata payout engine (points only).
// The predictions are editorial "creator: favour", same as the admin path.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const created: string[] = [];
  const resolved: string[] = [];
  const errors: string[] = [];

  let fixtures;
  try {
    fixtures = await fetchFixtures(1, 4);
  } catch (err) {
    return NextResponse.json({ error: "fixture fetch failed", detail: String(err) }, { status: 502 });
  }

  for (const f of fixtures) {
    try {
      // CREATE upcoming matches (not yet kicked off).
      if (f.state === "pre" && new Date(f.kickoff).getTime() > now) {
        const before = await findPredictionByExternalId(f.id);
        const p = await createPrediction({
          question: `${f.home} vs ${f.away} — who wins?`,
          options: [f.home, "Draw", f.away],
          locksAt: f.kickoff,
          creator: "favour",
          externalId: f.id,
        });
        if (!before) created.push(p.id);
      }

      // RESOLVE finished matches we have a prediction for.
      if (f.completed && f.winner) {
        const id = await findPredictionByExternalId(f.id);
        if (id) {
          const outcome = f.winner === "home" ? f.home : f.winner === "away" ? f.away : "Draw";
          const r = await resolvePrediction(id, outcome, now);
          if (r.ok) resolved.push(id);
        }
      }
    } catch (err) {
      errors.push(`${f.id}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    checkedFixtures: fixtures.length,
    created: created.length,
    createdIds: created,
    resolved: resolved.length,
    resolvedIds: resolved,
    errors,
    checkedAt: new Date().toISOString(),
  });
}
