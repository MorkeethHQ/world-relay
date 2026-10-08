// PRODUCTS PEOPLE CAN VOTE ON (Oscar, 8 Oct 2026: "we already need to prefill it
// with products for people to vote and have favours for").
//
// The list below is the prefill. Every entry is a real, live product, and only
// its link is written here: the name, the line and the picture are read from the
// product's own page (DESIGN-SYSTEM.md, rule 7: the words come from the product).
// A page that cannot be read leaves that product out; nothing is filled in.
//
// A vote is one signed-in World wallet saying "I want this on FAVOUR". One vote
// per wallet per product, kept as a set, so a count is a count of wallets and a
// second vote changes nothing. A vote pays nothing and moves no money. A product
// with votes is NOT a campaign: it takes reviews only after its maker posts it.
//
// The first list is the products of FAVOUR's own maker, and the screen says so.

import { getRedis } from "@/lib/redis";

export type Candidate = { id: string; url: string };

// Oscar's own live products. He chooses this list; change it here.
export const CANDIDATES: readonly Candidate[] = [
  { id: "strive", url: "https://agentic-strava.vercel.app/" },
  { id: "wave-radio", url: "https://waveradio-five.vercel.app/" },
  { id: "oscar-labs", url: "https://oscar-labs.vercel.app/" },
];
export const CANDIDATES_FROM = "From the maker of FAVOUR";

export const VOTE_PREFIX = "product:votes:";
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export function candidateOrNull(id: unknown): Candidate | null {
  return typeof id === "string" ? CANDIDATES.find((c) => c.id === id) ?? null : null;
}

export type VoteStore = {
  add: (key: string, member: string) => Promise<unknown>;
  count: (key: string) => Promise<number>;
  has: (key: string, member: string) => Promise<unknown>;
};

function store(): VoteStore | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    add: (key, member) => redis.sadd(key, member),
    count: (key) => redis.scard(key),
    has: (key, member) => redis.sismember(key, member),
  };
}

export type VoteResult = { ok: true; votes: number; first: boolean } | { ok: false; reason: "unknown_product" | "wallet_required" | "unavailable" };

/** One wallet, one vote per product. A repeat is not an error and adds nothing. */
export async function castVote(id: unknown, wallet: unknown, s: VoteStore | null = store()): Promise<VoteResult> {
  const candidate = candidateOrNull(id);
  if (!candidate) return { ok: false, reason: "unknown_product" };
  if (typeof wallet !== "string" || !WALLET.test(wallet)) return { ok: false, reason: "wallet_required" };
  if (!s) return { ok: false, reason: "unavailable" };
  try {
    const key = `${VOTE_PREFIX}${candidate.id}`;
    const added = await s.add(key, wallet.toLowerCase());
    return { ok: true, votes: await s.count(key), first: Number(added) === 1 };
  } catch {
    return { ok: false, reason: "unavailable" }; // the caller says the vote was not saved
  }
}

export type Tally = { votes: number | null; mine: boolean }; // null: the count could not be read

/** The count for each product, and whether this wallet voted. A failed read is null, never zero. */
export async function tallies(wallet: string | null, s: VoteStore | null = store()): Promise<Record<string, Tally>> {
  const me = wallet && WALLET.test(wallet) ? wallet.toLowerCase() : null;
  const out: Record<string, Tally> = {};
  await Promise.all(CANDIDATES.map(async (c) => {
    if (!s) { out[c.id] = { votes: null, mine: false }; return; }
    try {
      const key = `${VOTE_PREFIX}${c.id}`;
      const [votes, mine] = await Promise.all([s.count(key), me ? s.has(key, me) : 0]);
      out[c.id] = { votes: Number(votes) || 0, mine: Number(mine) === 1 };
    } catch {
      out[c.id] = { votes: null, mine: false };
    }
  }));
  return out;
}

export type VoteRow = {
  id: string; name: string; line: string | null; url: string; host: string;
  image: string | null; icon: string | null; votes: number | null; mine: boolean;
};

type Read = { ok: true; proposal: { name: string | null; line: string | null; image: string | null; icon: string | null } } | { ok: false };

/** The rows the screen shows: most votes first, then the order of the list. */
export function voteRows(read: Record<string, Read | undefined>, tally: Record<string, Tally>): VoteRow[] {
  const rows: VoteRow[] = [];
  for (const c of CANDIDATES) {
    const r = read[c.id];
    if (!r || !r.ok || !r.proposal.name) continue; // no name from its page: left out
    const t = tally[c.id] ?? { votes: null, mine: false };
    rows.push({
      id: c.id, name: r.proposal.name, line: r.proposal.line, url: c.url, host: new URL(c.url).hostname.replace(/^www\./, ""),
      image: r.proposal.image, icon: r.proposal.icon, votes: t.votes, mine: t.mine,
    });
  }
  const order = new Map(CANDIDATES.map((c, i) => [c.id, i]));
  return rows.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || order.get(a.id)! - order.get(b.id)!);
}
