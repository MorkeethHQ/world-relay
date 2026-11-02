import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { keccak256, toBytes } from "viem";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { usdToUnits } from "@/lib/escrow-v2";
import {
  buildFundCampaignTx,
  currentFeeBps,
  favourPotsAddress,
  feeLine,
  feesAccrued,
  formatUsdc,
  getCampaignRecord,
  minFavourUnits,
  operatorAddress,
  serverOpenCampaign,
  serverPayFromPot,
  splitFee,
  withdrawFeesBestEffort,
} from "@/lib/favour-pots";
import { FAVOUR_POTS_SETTINGS } from "@/lib/favour-pots-v3";
import { trackEvent } from "@/lib/track";

/**
 * Admin campaign pots on FavourPots (rail 4). open / pay / withdraw-fees need ADMIN_SECRET; status and
 * prepare-fund are public (funding a pot is permissionless on-chain).
 *
 *   open           { capUsd }                          server key opens a USDC pot, returns its id
 *   status         { campaignId }                      pot balance, cap, fee, fees waiting
 *   prepare-fund   { campaignId, amountUsd }           MiniKit Permit2 batch: any World App wallet tops up
 *   pay            { campaignId, favour, recipient, amountUsd }
 *                                                      server key pays one favour from the pot to the helper,
 *                                                      then sends accrued fees to the fee address
 *   withdraw-fees  {}                                  sends accrued fees to the fee address
 *
 * The server key is the contract's OPERATOR: it can open pots and pay favours up to each pot's cap.
 * It cannot close or freeze a pot, change the fee or caps, or upgrade: those are admin-key actions
 * run from the Mac.
 */

const isWallet = (a: unknown): a is `0x${string}` => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

function adminOk(secret: unknown): boolean {
  const s = process.env.ADMIN_SECRET;
  if (!s || typeof secret !== "string") return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

function usd(v: unknown): bigint | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return usdToUnits(n);
}

function campaignIdOf(v: unknown): bigint | null {
  try {
    const id = BigInt(String(v));
    return id > BigInt(0) ? id : null;
  } catch {
    return null;
  }
}

function potView(id: bigint, c: NonNullable<Awaited<ReturnType<typeof getCampaignRecord>>>) {
  return {
    campaignId: id.toString(),
    balanceUsd: formatUsdc(c.balance),
    capUsd: formatUsdc(c.cap),
    totalFundedUsd: formatUsdc(c.totalFunded),
    feeBps: c.feeBps,
    closed: c.closed,
    frozen: c.frozen,
  };
}

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_SECRET) return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  const { ok } = await rateLimit(`admin-pots:${getClientIp(req)}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  // status and prepare-fund are public: anyone may fund a pot on-chain anyway, so Oscar's phone
  // never needs the admin secret. Opening pots, paying and fee withdrawal stay behind it.
  const PUBLIC = new Set(["status", "prepare-fund"]);
  if (!PUBLIC.has(body?.action) && !adminOk(body?.secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    switch (body.action) {
      case "open": {
        const cap = usd(body.capUsd);
        if (!cap || cap < minFavourUnits() || cap > FAVOUR_POTS_SETTINGS.maxAmount) {
          return NextResponse.json({ error: "Cap per favour must be between 0.10 and 1000 USDC" }, { status: 400 });
        }
        if (!operatorAddress()) return NextResponse.json({ error: "Server key not configured" }, { status: 503 });
        const { campaignId, txHash } = await serverOpenCampaign(cap);
        trackEvent("favour_pot_opened", { campaignId: campaignId.toString() }).catch(() => {});
        return NextResponse.json({ campaignId: campaignId.toString(), txHash, contract: favourPotsAddress() });
      }

      case "status": {
        const id = campaignIdOf(body.campaignId);
        if (!id) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
        const c = await getCampaignRecord(id);
        if (!c) return NextResponse.json({ error: "No such pot" }, { status: 404 });
        return NextResponse.json({
          ...potView(id, c),
          feesWaitingUsd: formatUsdc(await feesAccrued()),
          currentFeeBps: await currentFeeBps(),
          contract: favourPotsAddress(),
        });
      }

      case "prepare-fund": {
        const id = campaignIdOf(body.campaignId);
        const amount = usd(body.amountUsd);
        if (!id || !amount) return NextResponse.json({ error: "campaignId and amountUsd required" }, { status: 400 });
        if (amount < minFavourUnits()) return NextResponse.json({ error: "The minimum is 0.10 USDC" }, { status: 400 });
        const c = await getCampaignRecord(id);
        if (!c) return NextResponse.json({ error: "No such pot" }, { status: 404 });
        if (c.closed) return NextResponse.json({ error: "This pot is closed" }, { status: 400 });
        return NextResponse.json({ payload: buildFundCampaignTx(id, amount), amount: amount.toString() });
      }

      case "pay": {
        const id = campaignIdOf(body.campaignId);
        const amount = usd(body.amountUsd);
        const favour = typeof body.favour === "string" ? body.favour.trim() : "";
        if (!id || !amount || !favour || !isWallet(body.recipient)) {
          return NextResponse.json({ error: "campaignId, favour, recipient wallet and amountUsd required" }, { status: 400 });
        }
        const c = await getCampaignRecord(id);
        if (!c) return NextResponse.json({ error: "No such pot" }, { status: 404 });
        if (amount < minFavourUnits() || amount > c.cap) {
          return NextResponse.json({ error: `Amount must be between 0.10 and the pot's cap (${formatUsdc(c.cap)} USDC)` }, { status: 400 });
        }
        if (amount > c.balance) return NextResponse.json({ error: "Not enough in the pot" }, { status: 400 });
        // The favour key is namespaced to the pot on-chain; each key pays once.
        const key = keccak256(toBytes(`favour:${favour}`));
        const txHash = await serverPayFromPot(id, key, body.recipient, amount);
        const feeTx = await withdrawFeesBestEffort();
        const { net, fee } = splitFee(amount, c.feeBps);
        trackEvent("favour_pot_paid", { campaignId: id.toString(), amount: formatUsdc(amount) }).catch(() => {});
        return NextResponse.json({
          txHash,
          feeTx,
          paidUsd: formatUsdc(net),
          feeUsd: formatUsdc(fee),
          line: feeLine(amount, c.feeBps),
        });
      }

      case "withdraw-fees": {
        const txHash = await withdrawFeesBestEffort();
        return NextResponse.json({ txHash });
      }

      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    // Contract reverts (AlreadyPaid, CampaignFrozen, InsufficientPot...) surface as a short reason.
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
