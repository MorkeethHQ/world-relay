import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// THE CRON, END TO END, WITH THE FLAG UNSET. Vercel calls GET /api/cron/jury-nudge
// at 17:00 UTC with the cron secret. With JURY_NUDGE_ENFORCE unset it must send
// nothing, even when there are past visitors to nudge. The second case turns the
// flag on with the same audience and must send, so a zero above means "off", not
// "nobody to send to".

const sets = new Map<string, Set<string>>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async () => "OK",
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
  }),
}));
const sends: string[][] = [];
vi.mock("@/lib/notifications", () => ({
  notifyJuryWaiting: async (addresses: string[]) => (sends.push(addresses), addresses.length),
}));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { GET } from "@/app/api/cron/jury-nudge/route";
import { JURY_NUDGE_FLAG } from "@/lib/jury-nudge";

const W = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const cron = () => new NextRequest("http://localhost/api/cron/jury-nudge", { headers: { authorization: "Bearer cron-test" } });

beforeEach(() => {
  sets.clear();
  sends.length = 0;
  process.env.CRON_SECRET = "cron-test";
  delete process.env.NORTH_STAR_EXCLUDE;
  sets.set("visitors:all", new Set([W(1), W(2), W(3)]));
});

describe("GET /api/cron/jury-nudge", () => {
  it("sends nothing when JURY_NUDGE_ENFORCE is unset, with past visitors waiting", async () => {
    delete process.env[JURY_NUDGE_FLAG];
    const res = await GET(cron());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false, sent: 0 });
    expect(sends).toEqual([]);
  });

  it("does send to the same audience when the flag is on, so the zero above is the flag", async () => {
    process.env[JURY_NUDGE_FLAG] = "true";
    const body = await (await GET(cron())).json();
    delete process.env[JURY_NUDGE_FLAG];
    expect(body).toMatchObject({ enabled: true, sent: 3 });
    expect(sends.flat()).toHaveLength(3);
  });
});
