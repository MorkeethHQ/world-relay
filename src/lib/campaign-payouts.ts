// PIECE PAYOUTS (2026-09-27): the payment state of one accepted piece of a company
// campaign. This module moves no money and no HTTP route can write "paid".
//
// THE PATH. An AI pass earns points at once, as before (verify-proof). The
// company then ACCEPTS the piece, from its own campaign page, and that acceptance
// is what creates a payout record. Independent acceptance is the company's, not
// the AI's and not the participant's. Inv 5 (SECURITY-INVARIANTS) still holds:
// only a result whose AI verdict is "pass" can be accepted for payment. A flagged
// proof the poster cleared by hand earns points and never reaches this ledger.
//
// The record starts "pending" and says why. The pool funded state comes from
// campaign-funding.ts (the pay step, closed until FAVOUR_POOL_ADDRESS is set).
// Moving a record to "paid" is scripts/mark-piece-paid.mjs, run by an operator
// with a transfer hash. Which wallet pays, under what custody, and with what fee
// are HELD FOR OSCAR; nothing here picks them.
//
// Keys, all in their own namespace and never on the draft record:
//   campaign:payout:<campaignId>          hash resultId -> PiecePayout JSON
//   campaign:payout:by:<address>          list "<campaignId>/<resultId>", newest first
// The full participant address per result is campaign-drafts' private map.

import { getRedis } from "./redis";
import { getPublishedCampaign, listCampaignResults, isCampaignOwner, getResultAddress } from "./campaign-drafts";
import { getCampaignFunding } from "./campaign-funding";
import { piecePayoutUsdc, type PiecePayout, type PayoutReason } from "./campaign-payouts-shape";
import { addNotification } from "./notifications-store";
import { notifyPieceAccepted, notifyPiecePaid } from "./notifications";

export const PAYOUT_PREFIX = "campaign:payout:";
export const PAYOUT_BY_PREFIX = "campaign:payout:by:";
export const PAYOUTS_PER_PERSON_MAX = 100;

type Env = Record<string, string | undefined>;

function parse(raw: unknown): PiecePayout | null {
  if (raw == null || raw === "") return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" && typeof (v as PiecePayout).id === "string" ? (v as PiecePayout) : null;
  } catch {
    return null;
  }
}

function isTest(env: Env): boolean {
  return env.NODE_ENV !== "production";
}

async function readAll(campaignId: string): Promise<PiecePayout[]> {
  const redis = getRedis();
  if (!redis) return [];
  // A read that fails (store down, or a test double without hashes) shows no
  // payouts rather than breaking the campaign page. Nothing is written here.
  let h: Record<string, unknown> = {};
  try {
    h = (await redis.hgetall<Record<string, unknown>>(`${PAYOUT_PREFIX}${campaignId}`)) || {};
  } catch {
    return [];
  }
  const out: PiecePayout[] = [];
  for (const v of Object.values(h)) {
    const p = parse(v);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
}

// A pending record's reason follows the pool: accepted before funding, it reads
// pool_unfunded; once the pool is funded it reads awaiting_payout. Derived on read
// so the stored record never lies about a funding step that happened later.
function withLiveReason(p: PiecePayout, funded: boolean): PiecePayout {
  if (p.status !== "pending") return p;
  const reason: PayoutReason = funded ? "awaiting_payout" : "pool_unfunded";
  return p.reason === reason ? p : { ...p, reason };
}

export async function listCampaignPayouts(campaignId: string, env: Env = process.env): Promise<PiecePayout[]> {
  const all = await readAll(campaignId);
  if (all.length === 0) return all;
  const funding = await getCampaignFunding(campaignId, env);
  const funded = funding?.status === "paid";
  return all.map((p) => withLiveReason(p, funded));
}

// USDC already committed to this pool: pending and paid records both count, so a
// pool can never be promised twice. Failed records commit nothing.
export function committedUsdc(payouts: PiecePayout[]): number {
  return payouts.filter((p) => p.status !== "failed").reduce((n, p) => n + Math.round(p.amountUsdc * 100), 0) / 100;
}

export type AcceptOutcome =
  | { ok: true; payout: PiecePayout; created: boolean }
  | { ok: false; error: string; status: number };

// THE COMPANY ACCEPTS A PIECE. Owner only. Only an AI-pass result. Once per result.
export async function acceptCampaignPiece(
  owner: string,
  campaignId: string,
  resultId: string,
  now: number,
  env: Env = process.env,
): Promise<AcceptOutcome> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Payments cannot be recorded right now.", status: 503 };
  if (!(await isCampaignOwner(campaignId, owner))) return { ok: false, error: "No such campaign.", status: 404 };
  const campaign = await getPublishedCampaign(campaignId);
  if (!campaign) return { ok: false, error: "No such campaign.", status: 404 };

  const results = await listCampaignResults(campaignId, 100);
  const result = results.find((r) => r.id === resultId);
  if (!result) return { ok: false, error: "No such reviewed piece.", status: 404 };
  if (result.verdict !== "pass") {
    return { ok: false, error: "Only a piece the AI check passed can be accepted for payment.", status: 409 };
  }
  const address = await getResultAddress(campaignId, resultId);
  if (!address) return { ok: false, error: "This piece has no participant on record.", status: 409 };

  const key = `${PAYOUT_PREFIX}${campaignId}`;
  const existingRaw = await redis.hget(key, resultId).catch(() => null);
  const existing = parse(existingRaw);
  if (existing) {
    const funding = await getCampaignFunding(campaignId, env);
    return { ok: true, payout: withLiveReason(existing, funding?.status === "paid"), created: false };
  }

  // THE POOL CAP IS HELD UNDER A PER-CAMPAIGN LOCK (Codex review, 2026-09-27).
  // HSETNX alone makes one record per result; it does not stop two accepts of two
  // DIFFERENT results reading the same committed total and both writing pending,
  // which would promise 30 of a 20 USDC pool. So the read-compute-write below
  // runs under one lock per campaign, the way publishDraft does. A caller that
  // cannot get the lock after a few short waits is told to try again; nothing is
  // written for it.
  const lockKey = `${PAYOUT_LOCK_PREFIX}${campaignId}`;
  let locked: unknown = null;
  for (let attempt = 0; attempt < 8 && !locked; attempt++) {
    locked = await redis.set(lockKey, "1", { nx: true, px: 10_000 });
    if (!locked) await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
  }
  if (!locked) return { ok: false, error: "Another acceptance is being recorded. Try again in a moment.", status: 409 };
  try {
    return await acceptUnderLock(owner, campaignId, resultId, campaign, result, address, now, env);
  } finally {
    await redis.del(lockKey).catch(() => 0);
  }
}

export const PAYOUT_LOCK_PREFIX = "campaign:payout:lock:";

async function acceptUnderLock(
  owner: string,
  campaignId: string,
  resultId: string,
  campaign: NonNullable<Awaited<ReturnType<typeof getPublishedCampaign>>>,
  result: Awaited<ReturnType<typeof listCampaignResults>>[number],
  address: string,
  now: number,
  env: Env,
): Promise<AcceptOutcome> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Payments cannot be recorded right now.", status: 503 };
  const key = `${PAYOUT_PREFIX}${campaignId}`;
  // Re-read under the lock: the record may have been written while we waited.
  const raced0 = parse(await redis.hget(key, resultId).catch(() => null));
  if (raced0) {
    const funding = await getCampaignFunding(campaignId, env);
    return { ok: true, payout: withLiveReason(raced0, funding?.status === "paid"), created: false };
  }

  const totalPieces = campaign.pieces.reduce((n, p) => n + p.count, 0);
  const amountUsdc = piecePayoutUsdc(campaign.proposedPoolUsdc, totalPieces);
  const funding = await getCampaignFunding(campaignId, env);
  const funded = funding?.status === "paid";
  const others = await readAll(campaignId);
  const committed = committedUsdc(others);
  const poolUsdc = funding?.poolUsdc ?? campaign.proposedPoolUsdc;

  let status: PiecePayout["status"] = "pending";
  let reason: PayoutReason = funded ? "awaiting_payout" : "pool_unfunded";
  if (Math.round((committed + amountUsdc) * 100) > Math.round(poolUsdc * 100)) {
    status = "failed";
    reason = "pool_exhausted";
  }

  const payout: PiecePayout = {
    id: resultId,
    campaignId,
    taskId: result.taskId,
    kind: result.kind,
    participant: result.participant,
    amountUsdc,
    status,
    reason,
    acceptedAt: new Date(now).toISOString(),
    ...(status === "failed" ? { failedAt: new Date(now).toISOString() } : {}),
    ...(isTest(env) ? { test: true as const } : {}),
  };

  // HSETNX: one payout per result, whatever the interleaving.
  const wrote = await redis.hsetnx(key, resultId, JSON.stringify(payout));
  if (Number(wrote) !== 1) {
    const raced = parse(await redis.hget(key, resultId).catch(() => null));
    if (raced) return { ok: true, payout: withLiveReason(raced, funded), created: false };
    return { ok: false, error: "Payments cannot be recorded right now.", status: 503 };
  }
  const byKey = `${PAYOUT_BY_PREFIX}${address.toLowerCase()}`;
  await redis.lpush(byKey, `${campaignId}/${resultId}`);
  await redis.ltrim(byKey, 0, PAYOUTS_PER_PERSON_MAX - 1);

  // Both parties hear about it. In-app always; push through the transport,
  // which logs instead of sending outside production.
  const label = `${campaign.company} campaign`;
  const line = status === "failed"
    ? `Accepted, but the pool cannot cover it: the accepted pieces already use the whole ${poolUsdc} USDC.`
    : funded
      ? `Accepted. ${amountUsdc} USDC is pending payout from the funded pool.`
      : `Accepted. ${amountUsdc} USDC is pending until the company funds the pool.`;
  await Promise.all([
    addNotification({ userId: address, type: status === "failed" ? "proof_rejected" : "verified", title: status === "failed" ? "Payment failed" : "Piece accepted", body: `${label}: ${line}`, taskId: result.taskId }).catch(console.error),
    addNotification({ userId: owner.toLowerCase(), type: "funded", title: "You accepted a piece", body: `${result.participant} · ${amountUsdc} USDC ${status === "failed" ? "failed: pool exhausted" : `pending (${reason.replace("_", " ")})`}.`, taskId: result.taskId }).catch(console.error),
    notifyPieceAccepted(address, campaign.company, amountUsdc, status, reason).catch(console.error),
  ]);

  return { ok: true, payout, created: true };
}

// The participant's own payment history, newest first.
export async function listPayoutsFor(address: string, env: Env = process.env): Promise<PiecePayout[]> {
  const redis = getRedis();
  if (!redis || !address) return [];
  const refs = ((await redis.lrange(`${PAYOUT_BY_PREFIX}${address.toLowerCase()}`, 0, PAYOUTS_PER_PERSON_MAX - 1).catch(() => [])) as string[]) || [];
  const out: PiecePayout[] = [];
  const fundedByCampaign = new Map<string, boolean>();
  for (const ref of refs) {
    const slash = ref.indexOf("/");
    if (slash < 0) continue;
    const campaignId = ref.slice(0, slash);
    const resultId = ref.slice(slash + 1);
    const p = parse(await redis.hget(`${PAYOUT_PREFIX}${campaignId}`, resultId).catch(() => null));
    if (!p) continue;
    if (!fundedByCampaign.has(campaignId)) {
      const f = await getCampaignFunding(campaignId, env);
      fundedByCampaign.set(campaignId, f?.status === "paid");
    }
    out.push(withLiveReason(p, fundedByCampaign.get(campaignId) === true));
  }
  return out;
}

// OPERATOR ONLY, from scripts/mark-piece-paid.mjs after reading the transfer on
// World Chain. Refuses unless the pool itself is recorded paid. Refuses a hash
// already used. Never called from a route; the guard test checks that.
export async function markPiecePaid(
  campaignId: string,
  resultId: string,
  txHash: string,
  now: number,
  env: Env = process.env,
): Promise<{ ok: true; payout: PiecePayout } | { ok: false; error: string }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Payments cannot be recorded right now." };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, error: "That is not a transaction hash." };
  const funding = await getCampaignFunding(campaignId, env);
  if (!funding || funding.status !== "paid") return { ok: false, error: "The pool is not recorded as funded. Nothing can be paid from it." };
  const key = `${PAYOUT_PREFIX}${campaignId}`;
  const p = parse(await redis.hget(key, resultId).catch(() => null));
  if (!p) return { ok: false, error: "No such payout." };
  if (p.status === "paid") return { ok: false, error: "This piece is already paid." };
  // A piece the pool could not cover is never paid from it (Codex review,
  // 2026-09-27): that would put the paid total above the pool. Only a pending
  // record, or a failed transfer being retried, may be marked paid.
  if (p.status === "failed" && p.reason === "pool_exhausted") {
    return { ok: false, error: "This piece failed because the pool is exhausted. It cannot be paid from this pool." };
  }
  const added = await redis.sadd(`${PAYOUT_PREFIX}txs`, txHash.toLowerCase());
  if (Number(added) !== 1) return { ok: false, error: "This transaction is already used for a payout." };
  const paid: PiecePayout = { ...p, status: "paid", reason: undefined, paidAt: new Date(now).toISOString(), paidTxHash: txHash };
  await redis.hset(key, { [resultId]: JSON.stringify(paid) });
  const address = await getResultAddress(campaignId, resultId);
  if (address) {
    await addNotification({ userId: address, type: "payment_released", title: "Paid", body: `${p.amountUsdc} USDC for your piece was sent. Tx ${txHash.slice(0, 10)}…`, taskId: p.taskId }).catch(console.error);
    await notifyPiecePaid(address, p.amountUsdc).catch(console.error);
  }
  return { ok: true, payout: paid };
}

export async function markPieceFailed(
  campaignId: string,
  resultId: string,
  now: number,
): Promise<{ ok: true; payout: PiecePayout } | { ok: false; error: string }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Payments cannot be recorded right now." };
  const key = `${PAYOUT_PREFIX}${campaignId}`;
  const p = parse(await redis.hget(key, resultId).catch(() => null));
  if (!p) return { ok: false, error: "No such payout." };
  if (p.status === "paid") return { ok: false, error: "This piece is already paid." };
  const failed: PiecePayout = { ...p, status: "failed", reason: "payout_failed", failedAt: new Date(now).toISOString() };
  await redis.hset(key, { [resultId]: JSON.stringify(failed) });
  const address = await getResultAddress(campaignId, resultId);
  if (address) {
    await addNotification({ userId: address, type: "proof_rejected", title: "Payment failed", body: `The ${p.amountUsdc} USDC transfer for your piece did not go through. FAVOUR will retry.`, taskId: p.taskId }).catch(console.error);
  }
  return { ok: true, payout: failed };
}
