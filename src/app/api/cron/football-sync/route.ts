import { NextRequest, NextResponse } from "next/server";
import { fetchFixtures } from "@/lib/football";
import { resolvePrediction, findPredictionByExternalId, getPrediction } from "@/lib/predictions";

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

  // Resolve first, so a match that just finished frees a slot for the next one
  // in the same run rather than waiting an hour.
  for (const f of fixtures) {
    try {
      // RESOLVE finished matches we have a prediction for. Resolve by option
      // POSITION from the STORED prediction (options[0]=home, options[2]=away),
      // never the live team name: ESPN can rename a team between the create and
      // resolve fetches, and a name that no longer matches p.options would be
      // rejected forever, freezing every stake on the match.
      if (f.completed && f.winner) {
        const id = await findPredictionByExternalId(f.id);
        const p = id ? await getPrediction(id) : null;
        if (id && p && p.status === "open") {
          const outcome = f.winner === "home" ? p.options[0] : f.winner === "away" ? p.options[2] : "Draw";
          const r = await resolvePrediction(id, outcome, now);
          if (r.ok) resolved.push(id);
        }
      }
    } catch (err) {
      errors.push(`${f.id}: ${String(err)}`);
    }
  }

  // Oscar, 7 October: no new predictions. Keep this cron for existing settlements.
  return NextResponse.json({
    supplyRetired: true,
    checkedFixtures: fixtures.length,
    created: created.length,
    createdIds: created,
    resolved: resolved.length,
    resolvedIds: resolved,
    errors,
    checkedAt: new Date().toISOString(),
  });
}
