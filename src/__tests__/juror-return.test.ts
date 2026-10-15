import { beforeEach, describe, expect, it, vi } from "vitest";

// DO OUTSIDE JURORS COME BACK THE NEXT DAY (15 Oct 2026). The daily jury game
// bets on a streak. Of the outside jurors on day N, how many judge again on
// day N+1? A count, no wallet. The newest day has no next day yet: null.
// Kill line (queue FAVOUR.txt DEEP 3): under 15% over the first 7 days.

const store = vi.hoisted(() => ({ sets: new Map<string, Set<string>>() }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ smembers: async (k: string) => [...(store.sets.get(k) ?? [])] }),
}));

import { jurorsBackNextDay, nsJurorsKey, readNorthStar } from "@/lib/north-star";

const A = "0x" + "1".repeat(40), B = "0x" + "2".repeat(40), C = "0x" + "3".repeat(40);
const OSCAR = "0x" + "a".repeat(40), FIXTURE = "0x7e57da7a000000000000000000000000000000b2";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const put = (day: string, ...w: string[]) => store.sets.set(nsJurorsKey(day), new Set(w));

beforeEach(() => store.sets.clear());

describe("jurorsBackNextDay", () => {
  it("counts outside jurors of day N who judged on day N+1, in any case", () => {
    expect(jurorsBackNextDay([A, B, C], [A.toUpperCase().replace("0X", "0x"), C, OSCAR], new Set())).toBe(2);
  });
  it("the excluded and TEST DATA wallets never count", () => {
    expect(jurorsBackNextDay([OSCAR, FIXTURE, A], [OSCAR, FIXTURE], new Set([OSCAR]))).toBe(0);
  });
});

describe("readNorthStar carries it per day, with no wallet", () => {
  it("each day says how many came back the day after; the newest day is null", async () => {
    put("2026-10-14", A, B, OSCAR);
    put("2026-10-15", A, OSCAR, C);
    put("2026-10-16", C);
    const days = await readNorthStar(3, NOW, new Set([OSCAR]));
    expect(days.map((d) => [d.day, d.outsideJurors, d.jurorsBackNextDay])).toEqual([
      ["2026-10-16", 1, null],
      ["2026-10-15", 2, 1],
      ["2026-10-14", 2, 1],
    ]);
    expect(JSON.stringify(days)).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});
