import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// JURY NUDGE: one World App notification that asks past visitors back to the
// jury. Ships dark (JURY_NUDGE_ENFORCE unset = nothing is read, nothing sent).
// With the flag on: only signed-in wallets, never someone already here today,
// never a wallet in NORTH_STAR_EXCLUDE, at most once per wallet per 7 days, at
// most one pass per UTC day, at most JURY_NUDGE_SEND_CAP wallets per pass.

const strings = new Map<string, string>();
const sets = new Map<string, Set<string>>();
let smembersCalls = 0;

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (k: string, v: string, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && strings.has(k)) return null;
      strings.set(k, v);
      return "OK";
    },
    sadd: async (k: string, ...v: string[]) => {
      if (!sets.has(k)) sets.set(k, new Set());
      v.forEach((x) => sets.get(k)!.add(x));
      return v.length;
    },
    smembers: async (k: string) => {
      smembersCalls++;
      return [...(sets.get(k) ?? [])];
    },
    expire: async () => 1,
  }),
}));

const sends: string[][] = [];
vi.mock("@/lib/notifications", () => ({
  notifyJuryWaiting: async (addresses: string[]) => {
    sends.push(addresses);
    return addresses.length;
  },
}));

const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
vi.mock("@/lib/track", () => ({
  trackEvent: async (event: string, data?: Record<string, unknown>) => {
    events.push({ event, data });
  },
}));

import { runJuryNudgePass, JURY_NUDGE_FLAG, JURY_NUDGE_SEND_CAP } from "@/lib/jury-nudge";

const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const NOW = Date.parse("2026-10-17T17:00:00Z");
const DAY = 86400_000;

function seed(key: string, members: string[]) {
  sets.set(key, new Set(members));
}

beforeEach(() => {
  strings.clear();
  sets.clear();
  sends.length = 0;
  events.length = 0;
  smembersCalls = 0;
  delete process.env[JURY_NUDGE_FLAG];
  delete process.env.NORTH_STAR_EXCLUDE;
});
afterEach(() => {
  delete process.env[JURY_NUDGE_FLAG];
  delete process.env.NORTH_STAR_EXCLUDE;
});

describe("jury nudge", () => {
  it("ships dark: no flag, no store read, no send", async () => {
    seed("visitors:all", [W(1), W(2)]);
    const r = await runJuryNudgePass(NOW);
    expect(r).toMatchObject({ enabled: false, sent: 0 });
    expect(sends).toHaveLength(0);
    expect(smembersCalls).toBe(0);
  });

  it("sends to past visitors, minus today's visitors, today's jurors, excluded wallets and non-wallets", async () => {
    process.env[JURY_NUDGE_FLAG] = "true";
    process.env.NORTH_STAR_EXCLUDE = W(5).toUpperCase().replace("0X", "0x");
    seed("visitors:all", [W(1), W(2), W(3), W(4), W(5), "dev-user", W(1).toUpperCase().replace("0X", "0x")]);
    seed("visitors:2026-10-17", [W(2)]);
    seed("ns:jurors:2026-10-17", [W(3)]);
    const r = await runJuryNudgePass(NOW);
    expect(r).toMatchObject({ enabled: true, audience: 2, sent: 2 });
    expect(sends.flat().sort()).toEqual([W(1), W(4)]);
    expect(events.find((e) => e.event === "jury_nudge")?.data).toMatchObject({ audience: 2, sent: 2 });
  });

  it("runs once per UTC day", async () => {
    process.env[JURY_NUDGE_FLAG] = "true";
    seed("visitors:all", [W(1)]);
    await runJuryNudgePass(NOW);
    const second = await runJuryNudgePass(NOW + 60_000);
    expect(second.deduped).toBe(true);
    expect(sends.flat()).toEqual([W(1)]);
  });

  it("nudges one wallet at most once in 7 days", async () => {
    process.env[JURY_NUDGE_FLAG] = "true";
    seed("visitors:all", [W(1)]);
    await runJuryNudgePass(NOW);
    const nextDay = await runJuryNudgePass(NOW + DAY);
    expect(nextDay.sent).toBe(0);
    expect(sends.flat()).toEqual([W(1)]);
  });

  it("caps one pass at JURY_NUDGE_SEND_CAP wallets", async () => {
    process.env[JURY_NUDGE_FLAG] = "true";
    seed("visitors:all", Array.from({ length: JURY_NUDGE_SEND_CAP + 50 }, (_, i) => W(i + 1)));
    const r = await runJuryNudgePass(NOW);
    expect(r.sent).toBe(JURY_NUDGE_SEND_CAP);
    expect(new Set(sends.flat()).size).toBe(JURY_NUDGE_SEND_CAP);
  });
});
