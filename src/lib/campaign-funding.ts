// THE PAY STEP (2026-09-26). A company sends USDC on World Chain to the address
// in FAVOUR_POOL_ADDRESS. This module moves no money. Nothing in the app can
// mark a pool paid. Only scripts/mark-campaign-paid.mjs, run by Oscar after he
// reads the transfer on World Chain, writes a funding record.
//
// Funding state lives only under campaign:funding:* and never on the draft
// record (campaign:draft:<id>). CampaignDraft gains no field here.
//
// CUSTODY NOTE. src/lib/custody.ts says "FAVOUR no longer takes custody of
// anyone's money", and SECURITY-INVARIANTS.md has no line on a company paying
// a pool. Receiving a company pool into a FAVOUR address is Oscar's ruling,
// expressed by setting FAVOUR_POOL_ADDRESS. Until then the step is closed.
//
// Paying people from a funded pool is not in this module. Accepted pieces
// still earn points.

import { getRedis } from "./redis";
import { getPublishedCampaign } from "./campaign-drafts";
import {
  fundingQuote,
  isTxHash,
  poolAddressOrNull,
  type CampaignFunding,
} from "./campaign-funding-shape";

export const FUNDING_PREFIX = "campaign:funding:";
export const FUNDING_TXS = "campaign:funding:txs";

const CLOSED = "The pay step is closed until FAVOUR_POOL_ADDRESS is set.";

type Env = Record<string, string | undefined>;

type FundingRecord = {
  txHash: string;
  amountUsdc: number;
  paidAt: string;
  poolUsdc: number;
  feeUsdc: number;
  toAddress: string;
};

function parseRecord(raw: unknown): FundingRecord | null {
  if (raw == null || raw === "") return null;
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<FundingRecord>;
  if (typeof r.txHash !== "string" || typeof r.paidAt !== "string" || typeof r.amountUsdc !== "number") return null;
  return r as FundingRecord;
}

export async function getCampaignFunding(id: string, env: Env = process.env): Promise<CampaignFunding | null> {
  const campaign = await getPublishedCampaign(id);
  if (!campaign) return null;
  const quote = fundingQuote(campaign.proposedPoolUsdc);
  const address = poolAddressOrNull(env.FAVOUR_POOL_ADDRESS);
  const open = address !== null;
  const redis = getRedis();
  const raw = redis ? await redis.get(`${FUNDING_PREFIX}${id}`).catch(() => null) : null;
  const record = parseRecord(raw);
  const funding: CampaignFunding = {
    status: record ? "paid" : "unpaid",
    open,
    poolUsdc: quote.poolUsdc,
    feeUsdc: quote.feeUsdc,
    totalUsdc: quote.totalUsdc,
    reference: id,
    token: "USDC",
    network: "World Chain",
  };
  if (open && address) funding.address = address;
  if (record) {
    funding.paidTxHash = record.txHash;
    funding.paidAmountUsdc = record.amountUsdc;
    funding.paidAt = record.paidAt;
  }
  return funding;
}

export async function markCampaignPaid(
  id: string,
  txHash: string,
  amountUsdc: number,
  now: number,
  env: Env = process.env,
): Promise<{ ok: true; funding: CampaignFunding } | { ok: false; error: string }> {
  const toAddress = poolAddressOrNull(env.FAVOUR_POOL_ADDRESS);
  if (!toAddress) return { ok: false, error: CLOSED };
  if (!isTxHash(txHash)) return { ok: false, error: "That is not a transaction hash." };

  const campaign = await getPublishedCampaign(id);
  if (!campaign) return { ok: false, error: "This campaign is not published." };
  if (campaign.hidden) return { ok: false, error: "This campaign is hidden." };

  const quote = fundingQuote(campaign.proposedPoolUsdc);
  const paidCents = Math.round(amountUsdc * 100);
  if (!Number.isFinite(amountUsdc) || paidCents < Math.round(quote.totalUsdc * 100)) {
    return { ok: false, error: "The amount is below the pool plus the FAVOUR fee." };
  }

  const redis = getRedis();
  if (!redis) return { ok: false, error: "Funding cannot be recorded right now." };

  const key = `${FUNDING_PREFIX}${id}`;
  const existing = await redis.get(key).catch(() => null);
  if (existing != null && existing !== "") return { ok: false, error: "This campaign is already funded." };

  const txKey = txHash.toLowerCase();
  const added = await redis.sadd(FUNDING_TXS, txKey);
  if (Number(added) !== 1) return { ok: false, error: "This transaction is already used for a campaign." };

  const record: FundingRecord = {
    txHash,
    amountUsdc,
    paidAt: new Date(now).toISOString(),
    poolUsdc: quote.poolUsdc,
    feeUsdc: quote.feeUsdc,
    toAddress,
  };
  const wrote = await redis.set(key, JSON.stringify(record), { nx: true });
  if (!wrote) {
    await redis.srem(FUNDING_TXS, txKey).catch(() => 0);
    return { ok: false, error: "This campaign is already funded." };
  }

  const funding = await getCampaignFunding(id, env);
  if (!funding) return { ok: false, error: "This campaign is not published." };
  return { ok: true, funding };
}
