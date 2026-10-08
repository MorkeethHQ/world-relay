import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CANDIDATES, castVote, tallies, voteRows, type VoteStore } from "@/lib/product-votes";

const W1 = "0x" + "a".repeat(40);
const W2 = "0x" + "B".repeat(40);

function memory(): VoteStore & { sets: Map<string, Set<string>> } {
  const sets = new Map<string, Set<string>>();
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  return {
    sets,
    add: async (k, m) => { const had = set(k).has(m); set(k).add(m); return had ? 0 : 1; },
    count: async (k) => set(k).size,
    has: async (k, m) => (set(k).has(m) ? 1 : 0),
  };
}
const broken: VoteStore = { add: async () => { throw new Error("down"); }, count: async () => { throw new Error("down"); }, has: async () => { throw new Error("down"); } };

describe("the prefilled list", () => {
  it("holds only public https links and unique ids, and nothing else about a product", () => {
    expect(CANDIDATES.length).toBeGreaterThan(0);
    expect(new Set(CANDIDATES.map((c) => c.id)).size).toBe(CANDIDATES.length);
    for (const c of CANDIDATES) {
      expect(Object.keys(c).sort()).toEqual(["id", "url"]);
      expect(new URL(c.url).protocol).toBe("https:");
    }
  });
});

describe("a vote", () => {
  it("counts one wallet once per product, whatever the letter case", async () => {
    const s = memory();
    expect(await castVote("strive", W1, s)).toEqual({ ok: true, votes: 1, first: true });
    expect(await castVote("strive", W1.toUpperCase().replace("0X", "0x"), s)).toEqual({ ok: true, votes: 1, first: false });
    expect(await castVote("strive", W2, s)).toEqual({ ok: true, votes: 2, first: true });
    expect(await castVote("wave-radio", W1, s)).toEqual({ ok: true, votes: 1, first: true });
  });

  it("refuses a product that is not on the list, and writes nothing", async () => {
    const s = memory();
    for (const id of ["nope", "", null, { id: "strive" }, "strive/../x"]) expect(await castVote(id, W1, s)).toEqual({ ok: false, reason: "unknown_product" });
    expect(s.sets.size).toBe(0);
  });

  it("refuses a caller who is not a World wallet", async () => {
    const s = memory();
    for (const w of [null, "", "0x123", "alice", "0x" + "g".repeat(40)]) expect(await castVote("strive", w, s)).toEqual({ ok: false, reason: "wallet_required" });
    expect(s.sets.size).toBe(0);
  });

  it("says so when the vote could not be saved", async () => {
    expect(await castVote("strive", W1, broken)).toEqual({ ok: false, reason: "unavailable" });
    expect(await castVote("strive", W1, null)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("the counts", () => {
  it("gives each product its count and whether this wallet voted", async () => {
    const s = memory();
    await castVote("strive", W1, s); await castVote("strive", W2, s);
    const t = await tallies(W2, s);
    expect(t.strive).toEqual({ votes: 2, mine: true });
    expect(t["wave-radio"]).toEqual({ votes: 0, mine: false });
    expect((await tallies(null, s)).strive).toEqual({ votes: 2, mine: false });
  });

  it("gives null, never zero, for a count that could not be read", async () => {
    for (const s of [broken, null]) {
      const t = await tallies(W1, s);
      for (const c of CANDIDATES) expect(t[c.id]).toEqual({ votes: null, mine: false });
    }
  });
});

describe("the rows on the screen", () => {
  const page = (name: string | null) => ({ ok: true as const, proposal: { name, line: "Its own line.", image: null, icon: null } });

  it("uses the name and line from the product's page, most votes first", () => {
    const rows = voteRows(
      { strive: page("STRIVE"), "wave-radio": page("Wave Radio"), "oscar-labs": page("Oscar Labs") },
      { strive: { votes: 1, mine: false }, "wave-radio": { votes: 3, mine: true }, "oscar-labs": { votes: null, mine: false } },
    );
    expect(rows.map((r) => [r.id, r.name, r.votes, r.mine])).toEqual([["wave-radio", "Wave Radio", 3, true], ["strive", "STRIVE", 1, false], ["oscar-labs", "Oscar Labs", null, false]]);
    expect(rows[0].line).toBe("Its own line.");
    expect(rows[1].host).toBe("agentic-strava.vercel.app");
  });

  it("leaves out a product whose page could not be read or gives no name", () => {
    const rows = voteRows({ strive: { ok: false }, "wave-radio": page(null), "oscar-labs": page("Oscar Labs") }, {});
    expect(rows.map((r) => r.id)).toEqual(["oscar-labs"]);
    expect(rows[0]).toMatchObject({ votes: null, mine: false });
  });
});

describe("voting on the first page, and its route", () => {
  const list = readFileSync(join(__dirname, "..", "components", "TopProducts.tsx"), "utf8");
  const live = readFileSync(join(__dirname, "..", "components", "TopProductsLive.tsx"), "utf8");
  const route = readFileSync(join(__dirname, "..", "app", "api", "votes", "route.ts"), "utf8");

  it("shows the server's count after a vote, and no number for a count that is unknown", () => {
    expect(live).toMatch(/votes: data\.votes, mine: true/);
    expect(live).not.toMatch(/votes \+ 1|\(r\.votes \?\? 0\) \+/);
    expect(list).toMatch(/row\.votes === null \? "Voted"/);
  });

  it("keeps one dark button: every pill in a row is grey", () => {
    // The dark pill is the kit's `tone="dark"` since the 8 Oct 2026 redesign, and
    // only the lead card may ask for it. A row never names a tone of its own that is dark.
    expect((list.match(/bg-gray-900/g) || []).length).toBe(0);
    expect((list.match(/"dark"/g) || []).length).toBe(1);
    expect(list).not.toMatch(/<Row[\s\S]*?pillTone=\{[^}]*"dark"/);
  });

  it("does not list a product to vote for that is already on FAVOUR", () => {
    expect(list).toMatch(/!onFavour\.has\(v\.host\)/);
  });

  it("takes the voter from the session and the link from the fixed list", () => {
    expect(route).toMatch(/getAuthedAddress\(req/);
    expect(route).not.toMatch(/body\?\.(wallet|address|url)/);
    expect(route).toMatch(/fetchProduct\(url\)/);
  });
});
