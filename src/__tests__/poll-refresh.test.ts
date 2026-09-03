import { describe, it, expect } from "vitest";
import {
  POLL_MIN_ACTIVE,
  POLL_MAX_PER_RUN,
  POLL_MAX_PER_DAY,
  POLL_DURATION_HOURS,
  POLL_REASK_COOLDOWN_DAYS,
  FALLBACK_POLLS,
  normaliseQuestion,
  activePolls,
  planPollRefresh,
  avoidQuestions,
  validatePollSpec,
  generatePollSpecs,
} from "@/lib/poll-refresh";
import type { Poll } from "@/lib/polls-store";

const NOW = Date.parse("2026-09-03T12:00:00Z");

function poll(over: Partial<Poll> = {}): Poll {
  const createdAt = over.createdAt ?? new Date(NOW - 3600_000).toISOString();
  return {
    id: Math.random().toString(36).slice(2),
    question: `Question ${Math.random()}`,
    options: ["A", "B"],
    votes: { A: 0, B: 0 },
    voters: {},
    creator: "favour",
    category: "general",
    createdAt,
    endsAt: over.endsAt ?? new Date(NOW + 86_400_000).toISOString(),
    totalVotes: 0,
    ...over,
  };
}

// The live state on 2026-09-03: 12 polls, 11 of them ended. This fixture is the
// all-ended shape, which is where the tab was heading the moment the one
// remaining user poll lapsed — it ended at 22:32 the same day.
const ENDED_GRAVEYARD = Array.from({ length: 12 }, (_, i) =>
  poll({
    question: `Who wins the World Cup 2026? #${i}`,
    createdAt: new Date(Date.parse("2026-07-01T00:00:00Z")).toISOString(),
    endsAt: new Date(Date.parse("2026-07-04T00:00:00Z")).toISOString(),
  }),
);

describe("activePolls — ended polls are not supply", () => {
  it("counts only polls whose window is still open", () => {
    expect(activePolls(ENDED_GRAVEYARD, NOW)).toHaveLength(0);
    expect(activePolls([...ENDED_GRAVEYARD, poll()], NOW)).toHaveLength(1);
  });
});

describe("planPollRefresh — the decision", () => {
  it("a full graveyard is a full deficit, not a full board", () => {
    const plan = planPollRefresh({ polls: ENDED_GRAVEYARD, usedToday: 0, now: NOW });
    expect(plan.activeCount).toBe(0);
    expect(plan.deficit).toBe(POLL_MIN_ACTIVE);
    expect(plan.createCount).toBe(Math.min(POLL_MIN_ACTIVE, POLL_MAX_PER_RUN));
  });

  it("is a no-op at or above the floor", () => {
    const polls = Array.from({ length: POLL_MIN_ACTIVE }, () => poll());
    const plan = planPollRefresh({ polls, usedToday: 0, now: NOW });
    expect(plan.deficit).toBe(0);
    expect(plan.createCount).toBe(0);
  });

  it("respects the daily cap", () => {
    const spent = planPollRefresh({ polls: [], usedToday: POLL_MAX_PER_DAY, now: NOW });
    expect(spent.createCount).toBe(0);
    const nearly = planPollRefresh({ polls: [], usedToday: POLL_MAX_PER_DAY - 1, now: NOW });
    expect(nearly.createCount).toBe(1);
  });
});

describe("avoidQuestions — no re-asking what is live or recent", () => {
  it("avoids active polls and recent ones, releases cold ended ones", () => {
    const active = poll({ question: "Is this live?" });
    const recentEnded = poll({
      question: "Asked last week?",
      createdAt: new Date(NOW - 7 * 86_400_000).toISOString(),
      endsAt: new Date(NOW - 1000).toISOString(),
    });
    const coldEnded = poll({
      question: "Asked long ago?",
      createdAt: new Date(NOW - (POLL_REASK_COOLDOWN_DAYS + 5) * 86_400_000).toISOString(),
      endsAt: new Date(NOW - 4 * 86_400_000).toISOString(),
    });
    const avoid = avoidQuestions([active, recentEnded, coldEnded], NOW);
    expect(avoid.has(normaliseQuestion("Is this live?"))).toBe(true);
    expect(avoid.has(normaliseQuestion("Asked last week?"))).toBe(true);
    expect(avoid.has(normaliseQuestion("Asked long ago?"))).toBe(false);
  });
});

describe("validatePollSpec — what a poll must be", () => {
  it("accepts a well-formed spec", () => {
    expect(validatePollSpec({ question: "What do you actually do?", options: ["A thing", "Another"] }))
      .toEqual({ question: "What do you actually do?", options: ["A thing", "Another"], category: "general" });
  });

  it("rejects one option, five options, and duplicate options", () => {
    expect(validatePollSpec({ question: "Only one choice here?", options: ["A"] })).toBeNull();
    expect(validatePollSpec({ question: "Too many choices here?", options: ["A", "B", "C", "D", "E"] })).toBeNull();
    // A duplicated option would split one tally across two identical rows.
    expect(validatePollSpec({ question: "Same option twice here?", options: ["Yes", "yes"] })).toBeNull();
  });

  it("rejects a question that is too short or too long", () => {
    expect(validatePollSpec({ question: "Why?", options: ["A", "B"] })).toBeNull();
    expect(validatePollSpec({ question: "x".repeat(121), options: ["A", "B"] })).toBeNull();
  });
});

describe("the pool is the floor", () => {
  it("every fallback poll passes the validator it will be checked against", () => {
    for (const p of FALLBACK_POLLS) expect(validatePollSpec(p), p.question).not.toBeNull();
  });

  it("is evergreen — no fallback poll names a date, season or tournament", () => {
    // The World Cup polls are why this test exists: a topical poll is dead the
    // day the event ends, and the tab had no other supply for 46 days.
    const dated = /\b(world cup|olympic|election|christmas|summer|winter|20\d\d|season)\b/i;
    for (const p of FALLBACK_POLLS) expect(dated.test(p.question), p.question).toBe(false);
  });

  it("has no duplicate questions", () => {
    const keys = FALLBACK_POLLS.map((p) => normaliseQuestion(p.question));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deep enough to cover a full day of runs on its own", () => {
    expect(FALLBACK_POLLS.length).toBeGreaterThanOrEqual(POLL_MAX_PER_DAY);
  });

  it("with no API key, generation falls back to the pool and honours the avoid set", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const avoid = new Set([normaliseQuestion(FALLBACK_POLLS[0].question)]);
      const out = await generatePollSpecs(3, avoid);
      expect(out.specs).toHaveLength(3);
      expect(out.generated).toBe(0);
      expect(out.reason).toBe("no ANTHROPIC_API_KEY");
      expect(out.specs.map((s) => normaliseQuestion(s.question))).not.toContain([...avoid][0]);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("editorial polls outlive the user default", () => {
  it("runs a week, not the 72-hour default that emptied the tab", () => {
    expect(POLL_DURATION_HOURS).toBeGreaterThan(72);
  });
});
