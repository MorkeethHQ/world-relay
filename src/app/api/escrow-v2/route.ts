import { NextRequest, NextResponse } from "next/server";
import {
  ESCROW_V2_ADDRESS,
  escrowV2Enabled,
  escrowV2TaskId,
  getEscrowV2Record,
  verifyEscrowV2Funded,
  buildFundTransaction,
  buildReleaseTransaction,
  refundExpiredEscrowV2,
} from "@/lib/escrow-v2";

/**
 * FavourEscrowV2 intake surface — SHIP-DARK.
 *
 * ESCROW_V2_ENABLED is absent from the production environment, so every
 * branch here returns 404 in prod. Custody stays retired (src/lib/custody.ts)
 * until Oscar's explicit ruling; this route is the pre-wired path for that
 * morning flip, not a way around it.
 */

export async function GET(req: NextRequest) {
  if (!escrowV2Enabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const appTaskId = req.nextUrl.searchParams.get("taskId");
  if (!appTaskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const record = await getEscrowV2Record(appTaskId);
  return NextResponse.json({
    address: ESCROW_V2_ADDRESS,
    taskId: escrowV2TaskId(appTaskId),
    record: record && {
      funder: record.funder,
      recipient: record.recipient,
      amount: record.amount.toString(),
      deadline: record.deadline.toString(),
      status: record.status,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!escrowV2Enabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: {
    action?: string;
    taskId?: string;
    recipient?: string;
    amount?: string;
    deadline?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { action, taskId, recipient, amount, deadline } = body;
  if (!action || !taskId) {
    return NextResponse.json({ error: "action and taskId required" }, { status: 400 });
  }

  switch (action) {
    case "prepare-fund": {
      if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient) || !amount || !deadline) {
        return NextResponse.json(
          { error: "recipient, amount, deadline required" },
          { status: 400 }
        );
      }
      const tx = buildFundTransaction(
        taskId,
        recipient as `0x${string}`,
        BigInt(amount),
        BigInt(deadline)
      );
      return NextResponse.json({ transaction: tx });
    }

    case "prepare-release": {
      const tx = buildReleaseTransaction(taskId);
      return NextResponse.json({ transaction: tx });
    }

    case "verify-funded": {
      if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient) || !amount) {
        return NextResponse.json(
          { error: "recipient and amount required" },
          { status: 400 }
        );
      }
      const funded = await verifyEscrowV2Funded(
        taskId,
        recipient as `0x${string}`,
        BigInt(amount)
      );
      return NextResponse.json({ funded });
    }

    case "refund-expired": {
      // Cron/ops only: destination is chain-enforced to the bound funder,
      // but the trigger still sits behind the cron secret like other sweeps.
      const auth = req.headers.get("authorization");
      if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const result = await refundExpiredEscrowV2(taskId);
      return NextResponse.json({ refunded: !!result, txHash: result?.txHash ?? null });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
