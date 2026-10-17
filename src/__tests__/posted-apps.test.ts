import { beforeEach, describe, expect, it, vi } from "vitest";

// POSTED APPS (pivot "Product Hunt for World", Oscar's night ruling 17 Oct 2026):
// a posted app is pending; YES votes are keyed by the posted app; at 10 distinct
// outside wallets it is published, once.

import { YES_GATE } from "@/lib/yes-gate";
import { APPS_PENDING, castYes, listPendingApps, markPending, type AppStore } from "@/lib/posted-apps";

const w = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const MAKER = w(999);
const OSCAR = w(0xa);
const ID = "draft_1";
const DRAFT = { id: ID, owner: MAKER, status: "draft", productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app/", brief: "Try it." };

function memStore(): AppStore & { sets: Map<string, Set<string>>; kv: Map<string, string> } {
  const sets = new Map<string, Set<string>>();
  const kv = new Map<string, string>();
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  return {
    sets, kv,
    sadd: async (k, m) => (set(k).has(m) ? 0 : (set(k).add(m), 1)),
    srem: async (k, m) => (set(k).delete(m) ? 1 : 0),
    sismember: async (k, m) => (set(k).has(m) ? 1 : 0),
    smembers: async (k) => [...set(k)],
    get: async (k) => kv.get(k) ?? null,
    setNx: async (k, v) => (kv.has(k) ? false : (kv.set(k, v), true)),
    del: async (k) => void kv.delete(k),
  };
}

let s: ReturnType<typeof memStore>;
const publish = vi.fn();
const NONE = new Set<string>();
const yes = (id: string, wallet: string, exclude = NONE) => castYes(id, wallet, { store: s, publish, exclude, now: 0 });

beforeEach(() => {
  s = memStore();
  s.kv.set(`campaign:draft:${ID}`, JSON.stringify(DRAFT));
  publish.mockReset();
  publish.mockResolvedValue({ ok: true });
});

describe("a posted app is pending", () => {
  it("is listed with its count once marked, and only then", async () => {
    expect(await listPendingApps({ store: s, exclude: NONE })).toEqual([]);
    await markPending(ID, s);
    expect(s.sets.get(APPS_PENDING)?.has(ID)).toBe(true);
    expect(await listPendingApps({ store: s, exclude: NONE })).toEqual([
      { id: ID, productName: "STRIVE", productUrl: DRAFT.productUrl, ask: "Try it.", maker: MAKER, yes: 0, of: YES_GATE, status: "pending" },
    ]);
  });
});

describe("a YES vote on a posted app", () => {
  beforeEach(async () => { await markPending(ID, s); });

  it("refuses an id that is not a pending posted app, and a malformed wallet", async () => {
    expect(await yes("draft_nope", w(1))).toEqual({ ok: false, reason: "unknown_app" });
    expect(await yes(ID, "not a wallet")).toEqual({ ok: false, reason: "wallet_required" });
    expect(s.sets.get(`app:yes:${ID}`)?.size ?? 0).toBe(0);
  });

  it("refuses the maker's own vote", async () => {
    expect(await yes(ID, MAKER.toUpperCase().replace("0X", "0x"))).toEqual({ ok: false, reason: "own_app" });
    expect(s.sets.get(`app:yes:${ID}`)?.size ?? 0).toBe(0);
  });

  it("is keyed by the posted app: a vote on one app does not count for another", async () => {
    s.kv.set("campaign:draft:draft_2", JSON.stringify({ ...DRAFT, id: "draft_2" }));
    await markPending("draft_2", s);
    await yes(ID, w(1));
    expect(s.sets.get(`app:yes:${ID}`)?.size).toBe(1);
    expect(s.sets.get("app:yes:draft_2")?.size ?? 0).toBe(0);
  });

  it("counts a wallet once: a repeat changes nothing", async () => {
    expect(await yes(ID, w(1))).toMatchObject({ ok: true, yes: 1, first: true });
    expect(await yes(ID, w(1))).toMatchObject({ ok: true, yes: 1, first: false });
  });

  it("an excluded wallet is saved but does not count toward the gate", async () => {
    expect(await yes(ID, OSCAR, new Set([OSCAR]))).toMatchObject({ ok: true, yes: 0, status: "pending" });
  });

  it("holds at 9 outside YES and publishes at the 10th, as the maker", async () => {
    for (let i = 1; i < YES_GATE; i++) expect(await yes(ID, w(i))).toMatchObject({ ok: true, status: "pending" });
    expect(publish).not.toHaveBeenCalled();
    expect(await yes(ID, w(YES_GATE))).toMatchObject({ ok: true, yes: YES_GATE, status: "published" });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toBe(MAKER);
    expect(publish.mock.calls[0][1]).toBe(ID);
    expect(s.sets.get(APPS_PENDING)?.has(ID)).toBe(false);
  });

  it("publishes once, even when the 10th YES lands twice at the same moment", async () => {
    for (let i = 1; i < YES_GATE; i++) await yes(ID, w(i));
    await Promise.all([yes(ID, w(50)), yes(ID, w(51))]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("a failed publish keeps the app pending, so the next YES tries again", async () => {
    publish.mockResolvedValueOnce({ ok: false, error: "You can publish one campaign a day.", status: 429 });
    for (let i = 1; i <= YES_GATE; i++) await yes(ID, w(i));
    expect(s.sets.get(APPS_PENDING)?.has(ID)).toBe(true);
    expect(await yes(ID, w(77))).toMatchObject({ ok: true, status: "published" });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("refuses a vote once the app is published", async () => {
    for (let i = 1; i <= YES_GATE; i++) await yes(ID, w(i));
    expect(await yes(ID, w(88))).toEqual({ ok: false, reason: "not_pending" });
  });
});
