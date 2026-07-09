import { getRedis } from "./redis";
import { spendPoints, awardPoints } from "./proof-of-favour";

// PREDICTIONS — polls with a resolvable answer and points at stake.
// The economy's first competitive sink (decision-log 2026-07-05, approved GO).
//
// Rules (explicit, tests enforce them):
// - Stake points on ONE option, once per wallet per prediction.
// - Stakes deduct immediately (spendPoints) and are final once placed.
// - Staking closes at locksAt; resolution is admin-only (ADMIN_SECRET).
// - Payout: winners split the ENTIRE pool pro-rata to their stake.
//   If nobody backed the winning outcome, every staker is refunded.
// - Resolution is idempotent; a prediction can be voided (full refunds).
// - Points only. Never USDC (invariant 1 territory stays untouched).
export const PREDICTION_MIN_STAKE = 5;
export const PREDICTION_MAX_STAKE = 50;

export type Prediction = {
  id: string;
  question: string;
  options: string[];
  createdAt: string;
  locksAt: string;
  status: "open" | "resolved" | "void";
  outcome: string | null;
  creator: string;
  externalId?: string; // links to an external fixture (e.g. ESPN event id) for auto create/resolve
};

export type Stake = { option: string; amount: number };

const P = "prediction:";
const INDEX = "prediction:__index";
const stakesKey = (id: string) => `pstake:${id}`;
const extKey = (externalId: string) => `prediction:ext:${externalId}`;

// Resolve the prediction id previously created for an external fixture, if any.
export async function findPredictionByExternalId(externalId: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  const id = await redis.get(extKey(externalId));
  return typeof id === "string" ? id : null;
}

export function isLocked(p: Prediction, now: number): boolean {
  return p.status !== "open" || new Date(p.locksAt).getTime() <= now;
}

export async function createPrediction(input: {
  question: string;
  options: string[];
  locksAt: string;
  creator: string;
  externalId?: string;
}): Promise<Prediction> {
  const redis = getRedis();
  if (!redis) throw new Error("Store unavailable");
  const p: Prediction = {
    id: crypto.randomUUID(),
    question: input.question,
    options: input.options,
    createdAt: new Date().toISOString(),
    locksAt: input.locksAt,
    status: "open",
    outcome: null,
    creator: input.creator,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
  // Dedupe on external fixtures: reserve the fixture id atomically so a cron
  // re-run (or two overlapping runs) never creates the same match twice.
  if (input.externalId) {
    const reserved = await redis.set(extKey(input.externalId), p.id, { nx: true });
    if (!reserved) {
      const existingId = await redis.get(extKey(input.externalId));
      const existing = existingId ? await getPrediction(String(existingId)) : null;
      if (existing) return existing;
      await redis.set(extKey(input.externalId), p.id); // stale pointer, re-point
    }
  }
  await redis.set(`${P}${p.id}`, JSON.stringify(p));
  await redis.sadd(INDEX, p.id);
  return p;
}

export async function getPrediction(id: string): Promise<Prediction | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${P}${id}`);
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as Prediction) : (raw as Prediction);
}

export async function listPredictions(): Promise<Prediction[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = ((await redis.smembers(INDEX)) || []) as string[];
  const out: Prediction[] = [];
  for (const id of ids) {
    const p = await getPrediction(id);
    if (p) out.push(p);
  }
  return out.sort((a, b) => new Date(a.locksAt).getTime() - new Date(b.locksAt).getTime());
}

export async function getStakes(id: string): Promise<Record<string, Stake>> {
  const redis = getRedis();
  if (!redis) return {};
  const raw = ((await redis.hgetall(stakesKey(id))) || {}) as Record<string, unknown>;
  const out: Record<string, Stake> = {};
  for (const [wallet, v] of Object.entries(raw)) {
    out[wallet] = typeof v === "string" ? (JSON.parse(v) as Stake) : (v as Stake);
  }
  return out;
}

export function poolsFrom(stakes: Record<string, Stake>, options: string[]): Record<string, number> {
  const pools: Record<string, number> = {};
  for (const opt of options) pools[opt] = 0;
  for (const s of Object.values(stakes)) pools[s.option] = (pools[s.option] || 0) + s.amount;
  return pools;
}

export async function placeStake(
  id: string,
  wallet: string,
  option: string,
  amount: number,
  now = Date.now()
): Promise<{ ok: boolean; error?: string; totalPoints?: number }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ok: false, error: "Sign in with your World wallet to stake — no Orb needed." };
  if (!Number.isInteger(amount) || amount < PREDICTION_MIN_STAKE || amount > PREDICTION_MAX_STAKE) {
    return { ok: false, error: `Stake must be ${PREDICTION_MIN_STAKE}-${PREDICTION_MAX_STAKE} pts` };
  }
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Store unavailable" };
  const p = await getPrediction(id);
  if (!p) return { ok: false, error: "Prediction not found" };
  if (isLocked(p, now)) return { ok: false, error: "Stakes are locked" };
  if (!p.options.includes(option)) return { ok: false, error: "Unknown option" };

  // Lowercase ONCE and use it for every points op too (audit F4): the debit
  // must hit the same profile the refund/payout later credit, or a checksummed
  // address would be charged on pof:0xAbC and refunded on pof:0xabc.
  const w = wallet.toLowerCase();

  // Reserve the slot atomically BEFORE spending (audit F5): hsetnx blocks a
  // concurrent second stake from the same wallet debiting twice for one record.
  const reserved = await redis.hsetnx(stakesKey(id), w, JSON.stringify({ option, amount }));
  if (!reserved) return { ok: false, error: "You already staked on this one — stakes are final" };

  const spend = await spendPoints(w, "prediction_stake", amount);
  if (!spend.ok) {
    await redis.hdel(stakesKey(id), w).catch(() => {}); // release the reservation
    return { ok: false, error: spend.error };
  }
  return { ok: true, totalPoints: spend.totalPoints };
}

// Admin resolution. Idempotent: flips status under a lock, pays once.
// Winners split the WHOLE pool pro-rata; no winners -> full refunds.
export async function resolvePrediction(
  id: string,
  outcome: string | "VOID",
  now = Date.now()
): Promise<{ ok: boolean; error?: string; paid?: number; refunded?: number }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Store unavailable" };
  const lock = await redis.set(`plock:${id}`, "1", { nx: true, px: 60_000 });
  if (!lock) return { ok: false, error: "Resolution already in progress" };
  try {
    const p = await getPrediction(id);
    if (!p) return { ok: false, error: "Prediction not found" };
    if (p.status !== "open") return { ok: false, error: `Already ${p.status}` };
    if (outcome !== "VOID" && !p.options.includes(outcome)) return { ok: false, error: "Outcome is not one of the options" };
    // Don't resolve a real outcome before stakes lock (audit F3): a stake
    // landing in the resolve window would be charged but excluded from payout.
    // VOID (full refund) is always allowed, e.g. to cancel early.
    if (outcome !== "VOID" && now < new Date(p.locksAt).getTime()) {
      return { ok: false, error: "Stakes have not locked yet — resolve after locksAt, or VOID" };
    }

    // Flip status BEFORE paying (audit F3): a payout loop over many winners can
    // outlive the 60s lock; without this, a retry after lock-expiry would read
    // status "open" again and pay everyone twice. Persist "resolving" first;
    // each payout is also guarded per-wallet so a mid-loop crash never double-pays.
    p.status = outcome === "VOID" ? "void" : "resolved";
    p.outcome = outcome === "VOID" ? null : outcome;
    await redis.set(`${P}${id}`, JSON.stringify(p));

    const stakes = await getStakes(id);
    const entries = Object.entries(stakes);
    const total = entries.reduce((s, [, st]) => s + st.amount, 0);
    const paidSetKey = `ppaid:${id}`;

    const payOnce = async (wallet: string, action: string, amount: number) => {
      if (amount <= 0) return false;
      const fresh = await redis.sadd(paidSetKey, wallet.toLowerCase());
      if (!fresh) return false; // already paid this wallet for this prediction
      await awardPoints(wallet, action, amount).catch(console.error);
      return true;
    };

    let paid = 0;
    let refunded = 0;
    if (outcome === "VOID") {
      for (const [wallet, st] of entries) if (await payOnce(wallet, "prediction_refund", st.amount)) refunded++;
    } else {
      const winners = entries.filter(([, st]) => st.option === outcome);
      const winningPool = winners.reduce((s, [, st]) => s + st.amount, 0);
      if (winners.length === 0) {
        for (const [wallet, st] of entries) if (await payOnce(wallet, "prediction_refund", st.amount)) refunded++;
      } else {
        for (const [wallet, st] of winners) {
          const payout = Math.floor((total * st.amount) / winningPool);
          if (await payOnce(wallet, "prediction_win", payout)) paid++;
        }
      }
    }
    return { ok: true, paid, refunded };
  } finally {
    await redis.del(`plock:${id}`);
  }
}
