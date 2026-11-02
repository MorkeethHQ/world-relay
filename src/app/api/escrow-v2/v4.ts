import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  FAVOUR_POTS_DISCLOSURE,
  FAVOUR_POTS_VERSION,
  FavourStatus,
  EVENT_FAVOUR_FUNDED,
  EVENT_FAVOUR_RELEASED,
  EVENT_FAVOUR_REFUNDED,
  buildFundFavourTx,
  buildRefundFavourTx,
  buildReleaseFavourTx,
  currentFeeBps,
  favourIdFor,
  favourPotsAddress,
  feeLine,
  findPotsEventTx,
  getFavourRecord,
  minFavourUnits,
  newFundingRailVersion,
  operatorAddress,
  serverRefundFavour,
  serverReleaseFavour,
  splitFee,
  verifyPotsReceipt,
  withdrawFeesBestEffort,
} from "@/lib/favour-pots";
import { escrowV2DeadlineFor, usdToUnits } from "@/lib/escrow-v2";
import { USDC_ADDRESS } from "@/lib/contracts";
import { markEscrowV2Funded, markEscrowV2Refunded, markEscrowV2Settled } from "@/lib/store";
import { ownerRefusal, getAuthedAddress } from "@/lib/session";
import { recordCompletion, getReputation } from "@/lib/reputation";
import { recordFavourCompleted, completionPointsFor } from "@/lib/proof-of-favour";
import { notifyPaymentReleased } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";
import { trackEvent } from "@/lib/track";
import type { Task } from "@/lib/types";

/**
 * FavourPots (rail version 4) branch of /api/escrow-v2.
 *
 * Which tasks come here: a task PINNED to version 4, or an unfunded usdc-v2 task while new
 * fundings go to FavourPots (newFundingRailVersion() === 4). A task pinned to version 3 (V2_1)
 * never reaches this file, so every old escrow keeps its exact V2_1 behaviour.
 *
 * Same trust model as V2_1: prepare-* only builds; verify-* changes the task only after the chain
 * record AND an event log for this favour id agree.
 */

const isWallet = (a: unknown): a is `0x${string}` => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

export function isV4Task(task: Task | undefined | null): boolean {
  if (!task || task.rewardType !== "usdc-v2") return false;
  if (task.escrowV2Version != null) return task.escrowV2Version === FAVOUR_POTS_VERSION;
  // Unfunded: follows the rail new fundings go to.
  return !task.escrowTxHash && newFundingRailVersion() === FAVOUR_POTS_VERSION;
}

function idFor(task: Task): `0x${string}` | null {
  return isWallet(task.poster) ? favourIdFor(task.poster, task.id) : null;
}

function addressFor(task: Task): `0x${string}` {
  return (task.escrowV2Address as `0x${string}` | null) ?? favourPotsAddress();
}

function adminOk(secret: unknown): boolean {
  const s = process.env.ADMIN_SECRET;
  if (!s || typeof secret !== "string") return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Books a verified payout exactly once (same side effects as the V2_1 release). */
async function bookRelease(task: Task, txHash: string) {
  const updated = await markEscrowV2Settled(task.id, txHash);
  if (updated && task.claimant) {
    recordCompletion(task.claimant, task.bountyUsdc, task.verificationResult?.confidence ?? 0.75, task.claimantVerification || undefined, true).catch(console.error);
    getReputation(task.claimant)
      .then((rep) => recordFavourCompleted(task.claimant!, rep.currentStreak, completionPointsFor(task.rewardType, task.bountyUsdc)))
      .catch(console.error);
    notifyPaymentReleased(task.claimant, task.bountyUsdc).catch(console.error);
    addNotification({
      userId: task.claimant,
      type: "payment_released",
      title: "Payment released!",
      body: `USDC for "${task.description.slice(0, 40)}..." was sent to your wallet.`,
      taskId: task.id,
    }).catch(console.error);
  }
  // Fees reach Oscar's fee address only when withdrawn; do it right after each payout.
  withdrawFeesBestEffort().catch(() => {});
  trackEvent("favour_pots_released", { taskId: task.id, bounty: task.bountyUsdc }).catch(() => {});
  return updated;
}

/** GET ?taskId= state for a version-4 task, same shape as V2_1 plus the fee. */
export async function v4State(req: NextRequest, task: Task) {
  const id = idFor(task);
  const address = addressFor(task);
  const rec = id ? await getFavourRecord(id, address) : null;
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  const feeBps = rec && rec.status !== FavourStatus.None ? rec.feeBps : await currentFeeBps(address);
  const gross = rec && rec.status !== FavourStatus.None ? rec.amount : usdToUnits(task.bountyUsdc);
  const me = getAuthedAddress(req, Date.now())?.toLowerCase();
  const party = !!me && [task.poster, task.claimant].some((w) => typeof w === "string" && w.toLowerCase() === me);
  return NextResponse.json({
    rail: FAVOUR_POTS_VERSION,
    address,
    favourId: id,
    disclosure: FAVOUR_POTS_DISCLOSURE,
    feeBps,
    feeLine: feeLine(gross, feeBps),
    netToHelper: splitFee(gross, feeBps).net.toString(),
    record:
      rec && rec.status !== FavourStatus.None
        ? {
            ...(party ? { funder: rec.funder, recipient: task.claimant ?? null } : {}),
            amount: rec.amount.toString(),
            deadline: rec.deadline.toString(),
            status: rec.status,
            refundable: rec.status === FavourStatus.Funded && nowS > rec.deadline,
          }
        : null,
  });
}

export async function handleV4(
  req: NextRequest,
  action: string,
  task: Task,
  body: { poster?: string; txHash?: string; secret?: string }
): Promise<NextResponse> {
  const id = idFor(task);
  const address = addressFor(task);
  const { poster, txHash } = body;

  switch (action) {
    // Poster funds the favour from their own wallet. Unlike V2_1, no helper is needed yet:
    // the helper is chosen at release. Allowed while open or claimed.
    case "prepare-fund": {
      if (!poster || poster !== task.poster || !id) {
        return NextResponse.json({ error: "Only the poster can fund" }, { status: 403 });
      }
      const authErr = ownerRefusal(req, poster, Date.now());
      if (authErr) return NextResponse.json(authErr, { status: 403 });
      if (task.status !== "open" && task.status !== "claimed") {
        return NextResponse.json({ error: "This favour can no longer be funded" }, { status: 400 });
      }
      if (task.escrowTxHash) return NextResponse.json({ error: "Already funded" }, { status: 409 });
      const releaser = operatorAddress();
      if (!releaser) return NextResponse.json({ error: "Payments are not configured on this server" }, { status: 503 });
      const existing = await getFavourRecord(id, favourPotsAddress());
      if (existing && existing.status !== FavourStatus.None) {
        return NextResponse.json({ error: "Escrow slot already used on-chain" }, { status: 409 });
      }
      const amount = usdToUnits(task.bountyUsdc);
      if (amount < minFavourUnits()) {
        return NextResponse.json({ error: "The minimum is 0.10 USDC" }, { status: 400 });
      }
      const deadline = escrowV2DeadlineFor(task.deadline);
      const feeBps = await currentFeeBps();
      trackEvent("favour_pots_prepare_fund", { taskId: task.id, bounty: task.bountyUsdc }).catch(() => {});
      return NextResponse.json({
        rail: FAVOUR_POTS_VERSION,
        payload: buildFundFavourTx(task.id, amount, deadline, releaser),
        contract: favourPotsAddress(),
        favourId: id,
        amount: amount.toString(),
        deadline: deadline.toString(),
        feeBps,
        feeLine: feeLine(amount, feeBps),
        disclosure: FAVOUR_POTS_DISCLOSURE,
      });
    }

    case "verify-funded": {
      if (task.escrowTxHash && task.escrowV2Address) return NextResponse.json({ funded: true, already: true });
      if (!id) return NextResponse.json({ funded: false, error: "Poster has no wallet" }, { status: 400 });
      const rec = await getFavourRecord(id, favourPotsAddress());
      const releaser = operatorAddress();
      const ok =
        !!rec &&
        rec.status === FavourStatus.Funded &&
        rec.funder.toLowerCase() === task.poster.toLowerCase() &&
        rec.amount === usdToUnits(task.bountyUsdc) &&
        rec.token.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
        (!releaser || rec.releaser.toLowerCase() === releaser.toLowerCase());
      if (!ok) return NextResponse.json({ funded: false, error: "On-chain state does not match" }, { status: 409 });
      let confirmed = await findPotsEventTx(EVENT_FAVOUR_FUNDED, id);
      if (!confirmed && txHash && (await verifyPotsReceipt(txHash, EVENT_FAVOUR_FUNDED, id))) confirmed = txHash;
      if (!confirmed) {
        return NextResponse.json({ funded: false, error: "Could not corroborate the funding transaction yet, try again shortly" }, { status: 409 });
      }
      const updated = await markEscrowV2Funded(task.id, {
        contractAddress: favourPotsAddress(),
        version: FAVOUR_POTS_VERSION,
        fundTxHash: confirmed,
      });
      trackEvent("favour_pots_funded", { taskId: task.id, bounty: task.bountyUsdc }).catch(() => {});
      if (task.claimant) {
        addNotification({
          userId: task.claimant,
          type: "task_claimed",
          title: "Favour funded!",
          body: `$${task.bountyUsdc} USDC is waiting on-chain for "${task.description.slice(0, 40)}...".`,
          taskId: task.id,
        }).catch(console.error);
      }
      return NextResponse.json({ funded: !!updated });
    }

    // Poster pays the helper (the claimant) from their own wallet.
    case "prepare-release": {
      if (!task.escrowV2Address || !id) return NextResponse.json({ error: "Not a funded favour" }, { status: 400 });
      if (!poster || poster !== task.poster) return NextResponse.json({ error: "Only the poster can release" }, { status: 403 });
      const authErr = ownerRefusal(req, poster, Date.now());
      if (authErr) return NextResponse.json(authErr, { status: 403 });
      if (!isWallet(task.claimant)) return NextResponse.json({ error: "Nobody has done this favour yet" }, { status: 400 });
      const rec = await getFavourRecord(id, address);
      if (!rec || rec.status !== FavourStatus.Funded) {
        return NextResponse.json({ error: "Escrow is not in a releasable state" }, { status: 409 });
      }
      return NextResponse.json({
        rail: FAVOUR_POTS_VERSION,
        payload: buildReleaseFavourTx(id, task.claimant, address),
        recipient: task.claimant,
        amount: rec.amount.toString(),
        feeLine: feeLine(rec.amount, rec.feeBps),
      });
    }

    // Admin or FAVOUR review: the server key releases as the releaser the poster named.
    case "review-release": {
      if (!adminOk(body.secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      if (!task.escrowV2Address || !id) return NextResponse.json({ error: "Not a funded favour" }, { status: 400 });
      if (!isWallet(task.claimant)) return NextResponse.json({ error: "Nobody has done this favour yet" }, { status: 400 });
      const rec = await getFavourRecord(id, address);
      if (!rec || rec.status !== FavourStatus.Funded) {
        return NextResponse.json({ error: "Escrow is not in a releasable state" }, { status: 409 });
      }
      const hash = await serverReleaseFavour(id, task.claimant);
      const updated = await bookRelease(task, hash);
      return NextResponse.json({ released: !!updated, txHash: hash });
    }

    case "verify-released": {
      if (!task.escrowV2Address || !id) return NextResponse.json({ error: "Not a funded favour" }, { status: 400 });
      if (task.settlementTx) return NextResponse.json({ released: true, already: true });
      const rec = await getFavourRecord(id, address);
      if (!rec || rec.status !== FavourStatus.Released) {
        return NextResponse.json({ released: false, error: "Chain does not show Released" }, { status: 409 });
      }
      let confirmed = await findPotsEventTx(EVENT_FAVOUR_RELEASED, id, address);
      if (!confirmed && txHash && (await verifyPotsReceipt(txHash, EVENT_FAVOUR_RELEASED, id, address))) confirmed = txHash;
      if (!confirmed) {
        return NextResponse.json({ released: false, error: "Could not corroborate the release transaction yet, try again shortly" }, { status: 409 });
      }
      const updated = await bookRelease(task, confirmed);
      return NextResponse.json({ released: !!updated });
    }

    case "prepare-refund": {
      if (!task.escrowV2Address || !id) return NextResponse.json({ error: "Not a funded favour" }, { status: 400 });
      const rec = await getFavourRecord(id, address);
      const nowS = BigInt(Math.floor(Date.now() / 1000));
      if (!rec || rec.status !== FavourStatus.Funded || nowS <= rec.deadline) {
        return NextResponse.json({ error: "Escrow is not refundable yet" }, { status: 409 });
      }
      return NextResponse.json({ rail: FAVOUR_POTS_VERSION, payload: buildRefundFavourTx(id, address), amount: rec.amount.toString() });
    }

    case "verify-refunded": {
      if (!task.escrowV2Address || !id) return NextResponse.json({ error: "Not a funded favour" }, { status: 400 });
      if (task.escrowV2RefundTx) return NextResponse.json({ refunded: true, already: true });
      const rec = await getFavourRecord(id, address);
      if (!rec || rec.status !== FavourStatus.Refunded) {
        return NextResponse.json({ refunded: false, error: "Chain does not show Refunded" }, { status: 409 });
      }
      let confirmed = await findPotsEventTx(EVENT_FAVOUR_REFUNDED, id, address);
      if (!confirmed && txHash && (await verifyPotsReceipt(txHash, EVENT_FAVOUR_REFUNDED, id, address))) confirmed = txHash;
      if (!confirmed) {
        return NextResponse.json({ refunded: false, error: "Could not corroborate the refund transaction yet, try again shortly" }, { status: 409 });
      }
      const updated = await markEscrowV2Refunded(task.id, confirmed);
      trackEvent("favour_pots_refunded", { taskId: task.id, bounty: task.bountyUsdc }).catch(() => {});
      addNotification({
        userId: task.poster,
        type: "flagged",
        title: "Escrow refunded",
        body: `$${task.bountyUsdc} USDC returned to your wallet for "${task.description.slice(0, 40)}...".`,
        taskId: task.id,
      }).catch(console.error);
      return NextResponse.json({ refunded: !!updated });
    }

    case "refund-expired": {
      const auth = req.headers.get("authorization");
      if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const result = await refundExpiredV4(task);
      return NextResponse.json({ refunded: !!result, txHash: result?.txHash ?? null });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}

/** Cron sweep for a pinned version-4 task: refunds to the funder after the deadline. */
export async function refundExpiredV4(task: Task): Promise<{ txHash: string } | null> {
  const id = idFor(task);
  if (!id || task.escrowV2Version !== FAVOUR_POTS_VERSION) return null;
  const rec = await getFavourRecord(id, addressFor(task));
  if (!rec || rec.status !== FavourStatus.Funded) return null;
  if (BigInt(Math.floor(Date.now() / 1000)) <= rec.deadline) return null;
  const txHash = await serverRefundFavour(id);
  await markEscrowV2Refunded(task.id, txHash).catch(console.error);
  return { txHash };
}
