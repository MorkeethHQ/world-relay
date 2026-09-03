// Keyless football data via ESPN's public scoreboard API (no token, no signup).
// Prototype source (Oscar Jul 10: "start keyless, see if we need better later").
// If we outgrow it, swap this one module for football-data.org / API-Football —
// nothing else needs to change, callers only see the normalized Fixture shape.
//
// Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates=YYYYMMDD
// Shape confirmed live Jul 2026 (World Cup): events[].id, events[].date,
// competitions[0].competitors[] {homeAway, team.displayName, score, winner},
// competitions[0].status.type {state: pre|in|post, completed: bool}.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// Leagues to pull. The World Cup 2026 final was Jul 19; from Jul 20 the only
// configured league ("fifa.world") returned ZERO events, so the hourly cron ran
// for 46 days and created nothing — every prediction on the board was resolved
// and the surface was dead. A tournament league is a SEASONAL source and must
// never be the only one. These six are year-round domestic/continental
// competitions with overlapping seasons, verified live against ESPN on
// 2026-09-03 (fifa.world: 0 events; eng.1 2, esp.1 4, usa.1 3, ita.1 3, ger.1 2,
// fra.1 3 for 2026-09-13). Add a tournament league back for its window; do not
// remove the domestic ones when it ends.
export const FOOTBALL_LEAGUES = [
  "eng.1",           // Premier League
  "esp.1",           // La Liga
  "ita.1",           // Serie A
  "ger.1",           // Bundesliga
  "fra.1",           // Ligue 1
  "uefa.champions",  // Champions League (empty out of window — that is fine)
];

export type Fixture = {
  id: string; // ESPN event id — stable, used as the prediction externalId
  league: string;
  home: string;
  away: string;
  kickoff: string; // ISO
  state: "pre" | "in" | "post" | string;
  completed: boolean;
  homeScore: number | null;
  awayScore: number | null;
  winner: "home" | "away" | "draw" | null;
};

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseEvents(json: unknown, league: string): Fixture[] {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: Fixture[] = [];
  for (const ev of events) {
    try {
      const e = ev as Record<string, unknown>;
      const comp = (e.competitions as Record<string, unknown>[] | undefined)?.[0];
      if (!comp) continue;
      const competitors = Array.isArray(comp.competitors) ? (comp.competitors as Record<string, unknown>[]) : [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;
      const status = ((comp.status as Record<string, unknown>)?.type || {}) as Record<string, unknown>;
      const state = String(status.state || "pre");
      const completed = status.completed === true;
      const homeName = String((home.team as Record<string, unknown>)?.displayName || "Home");
      const awayName = String((away.team as Record<string, unknown>)?.displayName || "Away");
      const hsRaw = home.score != null ? Number(home.score) : null;
      const asRaw = away.score != null ? Number(away.score) : null;
      const homeScore = Number.isFinite(hsRaw as number) ? (hsRaw as number) : null;
      const awayScore = Number.isFinite(asRaw as number) ? (asRaw as number) : null;
      let winner: Fixture["winner"] = null;
      if (completed) {
        // Trust ESPN's winner flag first, then the score. Only equal scores are
        // a draw. If completed but still unclear (no flag AND no scores — a brief
        // data-lag window), leave null so the cron SKIPS and retries next hour
        // rather than resolving wrongly: a resolution is irreversible and moves
        // points. This avoids paying "Draw" on a knockout during the lag window.
        if (home.winner === true) winner = "home";
        else if (away.winner === true) winner = "away";
        else if (homeScore != null && awayScore != null) winner = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "draw";
        else winner = null;
      }
      out.push({
        id: String(e.id),
        league,
        home: homeName,
        away: awayName,
        kickoff: String(e.date),
        state,
        completed,
        homeScore,
        awayScore,
        winner,
      });
    } catch {
      continue; // one malformed event must never blank the whole day's fixtures
    }
  }
  return out;
}

async function fetchDay(league: string, date: string): Promise<Fixture[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${ESPN}/${league}/scoreboard?dates=${date}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    return parseEvents(await res.json(), league);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Fetch fixtures across the configured leagues for a window: `daysBack` days
// ago through `daysAhead` days from now. Back-days catch matches that finished
// so we can resolve them; ahead-days catch upcoming matches to create.
// Deduped by ESPN event id.
export async function fetchFixtures(daysBack = 1, daysAhead = 4, now = new Date()): Promise<Fixture[]> {
  const dates: string[] = [];
  for (let d = -daysBack; d <= daysAhead; d++) {
    dates.push(yyyymmdd(new Date(now.getTime() + d * 86400_000)));
  }
  // Fetch every league×date concurrently (independent calls) so latency doesn't
  // scale linearly with the window and blow the cron's function budget.
  const jobs: Promise<{ date: string; fixtures: Fixture[] }>[] = [];
  for (const league of FOOTBALL_LEAGUES) {
    for (const date of dates) {
      jobs.push(fetchDay(league, date).then((fixtures) => ({ date, fixtures })));
    }
  }
  const results = await Promise.all(jobs);
  // Merge with the later date winning, independent of fetch completion order.
  results.sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map<string, Fixture>();
  for (const { fixtures } of results) for (const f of fixtures) byId.set(f.id, f);
  return [...byId.values()];
}
