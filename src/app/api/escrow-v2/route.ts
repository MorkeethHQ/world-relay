import { NextRequest, NextResponse } from "next/server";
import {
  ESCROW_V2_VERSION,
  ESCROW_V2_FUND_DISCLOSURE,
  ESCROW_V2_EVENT_FUNDED,
  ESCROW_V2_EVENT_RELEASED,
  ESCROW_V2_EVENT_REFUNDED,
  EscrowV2Status,
  escrowV2Address,
  escrowV2Enabled,
  escrowV2MaxUsd,
  escrowV2MaxConcurrent,
  escrowV2TaskId,
  escrowV2DeadlineFor,
  usdToUnits,
  getEscrowV2Record,
  verifyEscrowV2Funded,
  verifyEscrowV2Receipt,
  findEscrowV2EventTx,
  buildFundTransactions,
  buildReleaseTransaction,
  buildRefundTransaction,
  refundExpiredEscrowV2,
} from "@/lib/escrow-v2";
import {
  getTask,
  listTasks,
  markEscrowV2Funded,
  markEscrowV2Settled,
  markEscrowV2Refunded,
} from "@/lib/store";
import { ownershipError } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordCompletion, getReputation } from "@/lib/reputation";
import { recordFavourCompleted, completionPointsFor } from "@/lib/proof-of-favour";
import { notifyPaymentReleased } from "@/lib/notifications";
import { addNotification } from "@/lib/notifications-store";
import { trackEvent } from "@/lib/track";
import type { Task } from "@/lib/types";

/**
 * FavourEscrowV2 intake surface — the demand-gated USDC flow.
 *
 * ESCROW_V2_ENABLED absent => every branch here returns 404 (rail is DARK).
 * Custody stays retired (src/lib/custody.ts) — this rail never takes custody:
 * the poster funds the verified escrow contract from their OWN wallet, and
 * the contract binds recipient + amount at fund time.
 *
 * Trust model, every action:
 *   - prepare-* only BUILDS transactions; the poster signs in World App.
 *   - verify-* changes app state ONLY after (a) the on-chain escrow record
 *     matches what the app expects AND (b) the reported tx hash carries the
 *     matching event from the escrow contract for this task id. The client's
 *     word is never sufficient (the "mark paid without chain state" failure
 *     class, SECURITY-INVARIANTS.md method).
 *   - Funded tasks resolve against their PINNED contract address
 *     (task.escrowV2Address), so a future config flip strands nothing.
 */

function dark() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

function pinnedAddress(task: Task): `0x${string}` {
  return (task.escrowV2Address ?? escrowV2Address()) as `0x${string}`;
}

/** Funded, not yet exited (neither released nor refunded). */
function isOpenFundedV2(t: Task): boolean {
  return (
    t.rewardType === "usdc-v2" &&
    !!t.escrowTxHash &&
    !t.settlementTx &&
    !t.escrowV2RefundTx
  );
}

export async function GET(req: NextRequest) {
  if (!escrowV2Enabled()) return dark();
  const appTaskId = req.nextUrl.searchParams.get("taskId");
  if (!appTaskId) {
    // Feature-detection surface for the client: rail is open, here are the
    // launch parameters. When the rail is dark this whole route 404s, so the
    // client treats "404" as "USDC favours unavailable".
    const maxUsd = escrowV2MaxUsd();
    const maxConcurrent = escrowV2MaxConcurrent();
    return NextResponse.json({
      enabled: true,
      contract: escrowV2Address(),
      version: ESCROW_V2_VERSION,
      maxUsd: Number.isFinite(maxUsd) ? maxUsd : null,
      maxConcurrent: Number.isFinite(maxConcurrent) ? maxConcurrent : null,
      disclosure: ESCROW_V2_FUND_DISCLOSURE,
    });
  }
  const task = await getTask(appTaskId);
  const address = task ? pinnedAddress(task) : escrowV2Address();
  const record = await getEscrowV2Record(appTaskId, address);
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  return NextResponse.json({
    address,
    taskId: escrowV2TaskId(appTaskId),
    disclosure: ESCROW_V2_FUND_DISCLOSURE,
    record: record && {
      funder: record.funder,
      recipient: record.recipient,
      amount: record.amount.toString(),
      deadline: record.deadline.toString(),
      status: record.status,
      refundable: record.status === EscrowV2Status.Funded && nowS > record.deadline,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!escrowV2Enabled()) return dark();

  const ip = getClientIp(req);
  const { ok } = await rateLimit(`escrow-v2:${ip}`, 20, 60_000);
  if (!ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }

  let body: {
    action?: string;
    taskId?: string;
    poster?: string;
    txHash?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { action, taskId, poster, txHash } = body;
  if (!action || !taskId) {
    return NextResponse.json({ error: "action and taskId required" }, { status: 400 });
  }

  const task = await getTask(taskId);

  switch (action) {
    // -----------------------------------------------------------------------
    // POSTER: build approve+fund for MiniKit after a claimant accepted.
    // -----------------------------------------------------------------------
    case "prepare-fund": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2") {
        return NextResponse.json({ error: "Not an escrow-v2 task" }, { status: 400 });
      }
      if (!poster || poster !== task.poster) {
        return NextResponse.json({ error: "Only the poster can fund" }, { status: 403 });
      }
      const authErr = ownershipError(req, poster, Date.now());
      if (authErr) return NextResponse.json({ error: authErr }, { status: 403 });
      if (task.status !== "claimed" || !task.claimant) {
        // Demand-gated custody: money moves ONLY once a matched counterparty
        // exists. No claimant, no fund step — ever.
        return NextResponse.json({ error: "Fund after someone accepts the favour" }, { status: 400 });
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(task.claimant)) {
        return NextResponse.json({ error: "Claimant has no wallet address" }, { status: 400 });
      }
      if (task.escrowTxHash) {
        return NextResponse.json({ error: "Already funded" }, { status: 409 });
      }
      // Concurrency cap (env-configurable; unlimited when unset).
      const maxConcurrent = escrowV2MaxConcurrent();
      if (Number.isFinite(maxConcurrent)) {
        const openFunded = (await listTasks()).filter(
          (t) => t.poster === task.poster && isOpenFundedV2(t)
        ).length;
        if (openFunded >= maxConcurrent) {
          return NextResponse.json({
            error: `You have ${openFunded} funded favours in flight — settle one before funding another.`,
          }, { status: 429 });
        }
      }
      // Double-fund fail-closed: the contract reverts TaskAlreadyFunded, but
      // refuse to even build the transaction if the slot is taken on-chain.
      const existing = await getEscrowV2Record(taskId, pinnedAddress(task));
      if (existing && existing.status !== EscrowV2Status.None) {
        return NextResponse.json({ error: "Escrow slot already used on-chain" }, { status: 409 });
      }
      const amount = usdToUnits(task.bountyUsdc);
      const deadline = escrowV2DeadlineFor(task.deadline);
      const payload = buildFundTransactions(
        taskId,
        task.claimant as `0x${string}`,
        amount,
        deadline
      );
      trackEvent("escrow_v2_prepare_fund", { taskId, bounty: task.bountyUsdc }).catch(() => {});
      return NextResponse.json({
        payload,
        contract: escrowV2Address(),
        taskIdHash: escrowV2TaskId(taskId),
        recipient: task.claimant,
        amount: amount.toString(),
        deadline: deadline.toString(),
        disclosure: ESCROW_V2_FUND_DISCLOSURE,
      });
    }

    // -----------------------------------------------------------------------
    // ANYONE: report a fund tx. State changes only on verified chain truth.
    // -----------------------------------------------------------------------
    case "verify-funded": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2" || !task.claimant) {
        return NextResponse.json({ error: "Not a fundable escrow-v2 task" }, { status: 400 });
      }
      if (task.escrowTxHash && task.escrowV2Address) {
        return NextResponse.json({ funded: true, already: true });
      }
      const address = escrowV2Address();
      // (a) The escrow record: Funded, bound to THIS claimant as recipient,
      //     THIS poster as funder, for exactly the advertised amount. An
      //     accept-swap after fund makes recipient mismatch => fail closed.
      const record = await verifyEscrowV2Funded(
        taskId,
        {
          recipient: task.claimant as `0x${string}`,
          amount: usdToUnits(task.bountyUsdc),
          funder: task.poster as `0x${string}`,
        },
        address
      );
      if (!record) {
        return NextResponse.json({ funded: false, error: "On-chain state does not match" }, { status: 409 });
      }
      // (b) The stored hash comes from the CHAIN's own logs first (zero client
      //     trust); a client-supplied hash is only a fallback and still has to
      //     carry this escrow's Funded event for this task id. World App often
      //     returns a userOpHash, which is why the log query is primary.
      let confirmedTx = await findEscrowV2EventTx(taskId, ESCROW_V2_EVENT_FUNDED, address);
      if (!confirmedTx && txHash && (await verifyEscrowV2Receipt(txHash, ESCROW_V2_EVENT_FUNDED, taskId, address))) {
        confirmedTx = txHash;
      }
      if (!confirmedTx) {
        return NextResponse.json({ funded: false, error: "Could not corroborate the funding transaction yet — try again shortly" }, { status: 409 });
      }
      const updated = await markEscrowV2Funded(taskId, {
        contractAddress: address,
        version: ESCROW_V2_VERSION,
        fundTxHash: confirmedTx,
      });
      trackEvent("escrow_v2_funded", { taskId, bounty: task.bountyUsdc }).catch(() => {});
      addNotification({
        userId: task.claimant,
        type: "task_claimed",
        title: "Escrow funded!",
        body: `$${task.bountyUsdc} USDC is locked on-chain for "${task.description.slice(0, 40)}...". It releases when the poster confirms.`,
        taskId,
      }).catch(console.error);
      return NextResponse.json({ funded: !!updated });
    }

    // -----------------------------------------------------------------------
    // POSTER: confirm completion => build the release tx (funder-only on-chain).
    // -----------------------------------------------------------------------
    case "prepare-release": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2" || !task.escrowV2Address) {
        return NextResponse.json({ error: "Not a funded escrow-v2 task" }, { status: 400 });
      }
      if (!poster || poster !== task.poster) {
        return NextResponse.json({ error: "Only the poster can release" }, { status: 403 });
      }
      const authErr = ownershipError(req, poster, Date.now());
      if (authErr) return NextResponse.json({ error: authErr }, { status: 403 });
      const record = await getEscrowV2Record(taskId, pinnedAddress(task));
      if (!record || record.status !== EscrowV2Status.Funded) {
        return NextResponse.json({ error: "Escrow is not in a releasable state" }, { status: 409 });
      }
      return NextResponse.json({
        payload: buildReleaseTransaction(taskId, pinnedAddress(task)),
        recipient: record.recipient,
        amount: record.amount.toString(),
      });
    }

    // -----------------------------------------------------------------------
    // ANYONE: report a release tx. Books the payment only on chain truth.
    // -----------------------------------------------------------------------
    case "verify-released": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2" || !task.escrowV2Address) {
        return NextResponse.json({ error: "Not a funded escrow-v2 task" }, { status: 400 });
      }
      if (task.settlementTx) {
        return NextResponse.json({ released: true, already: true });
      }
      const address = pinnedAddress(task);
      const record = await getEscrowV2Record(taskId, address);
      if (!record || record.status !== EscrowV2Status.Released) {
        return NextResponse.json({ released: false, error: "Chain does not show Released" }, { status: 409 });
      }
      let confirmedTx = await findEscrowV2EventTx(taskId, ESCROW_V2_EVENT_RELEASED, address);
      if (!confirmedTx && txHash && (await verifyEscrowV2Receipt(txHash, ESCROW_V2_EVENT_RELEASED, taskId, address))) {
        confirmedTx = txHash;
      }
      if (!confirmedTx) {
        return NextResponse.json({ released: false, error: "Could not corroborate the release transaction yet — try again shortly" }, { status: 409 });
      }
      const updated = await markEscrowV2Settled(taskId, confirmedTx);
      if (updated && task.claimant) {
        // Book the dollars HERE and only here (see reward.ts: hasOnChainEscrow
        // stays false for v2, so the AI proof-pass path cannot double-book).
        recordCompletion(
          task.claimant,
          task.bountyUsdc,
          task.verificationResult?.confidence ?? 0.75,
          task.claimantVerification || undefined,
          true
        ).catch(console.error);
        getReputation(task.claimant)
          .then((rep) =>
            recordFavourCompleted(
              task.claimant!,
              rep.currentStreak,
              completionPointsFor(task.rewardType, task.bountyUsdc)
            )
          )
          .catch(console.error);
        notifyPaymentReleased(task.claimant, task.bountyUsdc).catch(console.error);
        addNotification({
          userId: task.claimant,
          type: "payment_released",
          title: "Payment released!",
          body: `$${task.bountyUsdc} USDC sent to your wallet.`,
          taskId,
        }).catch(console.error);
      }
      trackEvent("escrow_v2_released", { taskId, bounty: task.bountyUsdc }).catch(() => {});
      return NextResponse.json({ released: !!updated });
    }

    // -----------------------------------------------------------------------
    // POSTER: reclaim an expired escrow (chain allows anyone post-deadline;
    // destination is always the funder).
    // -----------------------------------------------------------------------
    case "prepare-refund": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2" || !task.escrowV2Address) {
        return NextResponse.json({ error: "Not a funded escrow-v2 task" }, { status: 400 });
      }
      const record = await getEscrowV2Record(taskId, pinnedAddress(task));
      const nowS = BigInt(Math.floor(Date.now() / 1000));
      if (!record || record.status !== EscrowV2Status.Funded || nowS <= record.deadline) {
        return NextResponse.json({ error: "Escrow is not refundable yet" }, { status: 409 });
      }
      return NextResponse.json({
        payload: buildRefundTransaction(taskId, pinnedAddress(task)),
        funder: record.funder,
        amount: record.amount.toString(),
      });
    }

    // -----------------------------------------------------------------------
    // ANYONE: report a refund tx. State changes only on chain truth.
    // -----------------------------------------------------------------------
    case "verify-refunded": {
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      if (task.rewardType !== "usdc-v2" || !task.escrowV2Address) {
        return NextResponse.json({ error: "Not a funded escrow-v2 task" }, { status: 400 });
      }
      if (task.escrowV2RefundTx) {
        return NextResponse.json({ refunded: true, already: true });
      }
      const address = pinnedAddress(task);
      const record = await getEscrowV2Record(taskId, address);
      if (!record || record.status !== EscrowV2Status.Refunded) {
        return NextResponse.json({ refunded: false, error: "Chain does not show Refunded" }, { status: 409 });
      }
      let confirmedTx = await findEscrowV2EventTx(taskId, ESCROW_V2_EVENT_REFUNDED, address);
      if (!confirmedTx && txHash && (await verifyEscrowV2Receipt(txHash, ESCROW_V2_EVENT_REFUNDED, taskId, address))) {
        confirmedTx = txHash;
      }
      if (!confirmedTx) {
        return NextResponse.json({ refunded: false, error: "Could not corroborate the refund transaction yet — try again shortly" }, { status: 409 });
      }
      const updated = await markEscrowV2Refunded(taskId, confirmedTx);
      trackEvent("escrow_v2_refunded", { taskId, bounty: task.bountyUsdc }).catch(() => {});
      addNotification({
        userId: task.poster,
        type: "flagged",
        title: "Escrow refunded",
        body: `$${task.bountyUsdc} USDC returned to your wallet for "${task.description.slice(0, 40)}...".`,
        taskId,
      }).catch(console.error);
      return NextResponse.json({ refunded: !!updated });
    }

    // -----------------------------------------------------------------------
    // CRON: sweep an expired escrow with the relayer key. Destination is
    // chain-enforced to the bound funder; the trigger sits behind CRON_SECRET
    // like other sweeps.
    // -----------------------------------------------------------------------
    case "refund-expired": {
      const auth = req.headers.get("authorization");
      if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const result = await refundExpiredEscrowV2(
        taskId,
        task ? pinnedAddress(task) : undefined
      );
      if (result && task) {
        await markEscrowV2Refunded(taskId, result.txHash).catch(console.error);
      }
      return NextResponse.json({ refunded: !!result, txHash: result?.txHash ?? null });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
