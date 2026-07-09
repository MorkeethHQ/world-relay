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

// Leagues to pull. World Cup is live now; add domestic leagues here later
// (eng.1 EPL, esp.1 La Liga, uefa.champions, usa.1 MLS, ...).
export const FOOTBALL_LEAGUES = ["fifa.world"];

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
    const e = ev as Record<string, unknown>;
    const comp = (e.competitions as Record<string, unknown>[] | undefined)?.[0];
    if (!comp) continue;
    const competitors = (comp.competitors as Record<string, unknown>[] | undefined) || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const status = ((comp.status as Record<string, unknown>)?.type || {}) as Record<string, unknown>;
    const state = String(status.state || "pre");
    const completed = status.completed === true;
    const homeName = String((home.team as Record<string, unknown>)?.displayName || "Home");
    const awayName = String((away.team as Record<string, unknown>)?.displayName || "Away");
    const hs = home.score != null ? Number(home.score) : null;
    const as = away.score != null ? Number(away.score) : null;
    let winner: Fixture["winner"] = null;
    if (completed) {
      if (home.winner === true) winner = "home";
      else if (away.winner === true) winner = "away";
      else winner = "draw";
    }
    out.push({
      id: String(e.id),
      league,
      home: homeName,
      away: awayName,
      kickoff: String(e.date),
      state,
      completed,
      homeScore: Number.isFinite(hs as number) ? hs : null,
      awayScore: Number.isFinite(as as number) ? as : null,
      winner,
    });
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
  const byId = new Map<string, Fixture>();
  for (const league of FOOTBALL_LEAGUES) {
    for (const date of dates) {
      const fixtures = await fetchDay(league, date);
      for (const f of fixtures) byId.set(f.id, f); // later (fresher) day wins
    }
  }
  return [...byId.values()];
}
