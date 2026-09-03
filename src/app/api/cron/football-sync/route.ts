import { NextRequest, NextResponse } from "next/server";
import { fetchFixtures } from "@/lib/football";
import { createPrediction, resolvePrediction, findPredictionByExternalId, getPrediction, listPredictions } from "@/lib/predictions";

// Supply caps. One tournament league yielded a handful of fixtures a week; six
// domestic leagues over a 6-day window yield dozens, which would bury the
// predictions tab and split the points pools too thin to be worth staking.
// Soonest kickoff wins, so the board always shows matches people can still
// stake on.
const MAX_CREATE_PER_RUN = 4;
const MAX_OPEN_PREDICTIONS = 12;

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

  // CREATE upcoming matches (not yet kicked off), soonest kickoff first, under
  // both caps. Skip placeholder bracket fixtures ("TBD", "Winner Group X") and
  // any where the option strings aren't distinct — options are [home, "Draw",
  // away] and a collision (two "TBD" sides, or a team literally named "Draw")
  // would merge pools and pay the wrong stakers.
  const openNow = (await listPredictions()).filter((p) => p.status === "open").length;
  let slots = Math.min(MAX_CREATE_PER_RUN, Math.max(0, MAX_OPEN_PREDICTIONS - openNow));

  const upcoming = fixtures
    .filter((f) => {
      const distinctTeams = f.home !== f.away && f.home !== "Draw" && f.away !== "Draw";
      const placeholder = /\b(tbd|winner|loser)\b/i.test(f.home) || /\b(tbd|winner|loser)\b/i.test(f.away);
      return f.state === "pre" && new Date(f.kickoff).getTime() > now && distinctTeams && !placeholder;
    })
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());

  for (const f of upcoming) {
    if (slots <= 0) break;
    try {
      const before = await findPredictionByExternalId(f.id);
      if (before) continue;
      const p = await createPrediction({
        question: `${f.home} vs ${f.away} — who wins?`,
        options: [f.home, "Draw", f.away],
        locksAt: f.kickoff,
        creator: "favour",
        externalId: f.id,
      });
      created.push(p.id);
      slots -= 1;
    } catch (err) {
      errors.push(`${f.id}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    openBefore: openNow,
    checkedFixtures: fixtures.length,
    created: created.length,
    createdIds: created,
    resolved: resolved.length,
    resolvedIds: resolved,
    errors,
    checkedAt: new Date().toISOString(),
  });
}
