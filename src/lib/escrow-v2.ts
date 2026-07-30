/**
 * FavourEscrowV2 — the new money rail (World Chain mainnet, chain id 480).
 *
 * Contract: 0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C
 *   - Immutable: no proxy, no owner, no admin, no pause, no fee. The deployer
 *     key has zero power over it. Source is verified on the explorer:
 *     https://worldchain-mainnet.explorer.alchemy.com/address/0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C?tab=contract
 *   - Task-bound: funds bind to (taskId, recipient, amount) at fund time.
 *     release/refund take ONLY the task id — no caller-supplied destination
 *     exists anywhere in the ABI (this kills the redirect/question-swap class).
 *   - Exits: release (funder, any time) or refund (anyone, after deadline,
 *     always to the funder).
 *
 * SHIP-DARK: every entry point here is gated on ESCROW_V2_ENABLED, which is
 * ABSENT from the production environment. Custody remains retired
 * (src/lib/custody.ts) until Oscar's explicit ruling flips intake open.
 * This module deliberately does NOT import or weaken the custody gate.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export const ESCROW_V2_ADDRESS =
  "0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C" as const;

export const ESCROW_V2_ABI = [
  {
    name: "fund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint96" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getEscrow",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "funder", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint96" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export enum EscrowV2Status {
  None = 0,
  Funded = 1,
  Released = 2,
  Refunded = 3,
}

export interface EscrowV2Record {
  funder: `0x${string}`;
  recipient: `0x${string}`;
  amount: bigint; // USDC, 6 decimals
  deadline: bigint; // unix seconds
  status: EscrowV2Status;
}

/** The only switch. Absent from prod env => every entry point below is dead. */
export function escrowV2Enabled(): boolean {
  return process.env.ESCROW_V2_ENABLED === "1";
}

/** Deterministic on-chain task id for an app task. One app task, one escrow slot. */
export function escrowV2TaskId(appTaskId: string): `0x${string}` {
  return keccak256(toBytes(`favour:${appTaskId}`));
}

function publicClient() {
  return createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
}

/** Read the on-chain escrow record for an app task. Null when the rail is dark. */
export async function getEscrowV2Record(
  appTaskId: string
): Promise<EscrowV2Record | null> {
  if (!escrowV2Enabled()) return null;
  const rec = await publicClient().readContract({
    address: ESCROW_V2_ADDRESS,
    abi: ESCROW_V2_ABI,
    functionName: "getEscrow",
    args: [escrowV2TaskId(appTaskId)],
  });
  return {
    funder: rec.funder,
    recipient: rec.recipient,
    amount: rec.amount,
    deadline: rec.deadline,
    status: Number(rec.status) as EscrowV2Status,
  };
}

/**
 * Server-side truth check before the app treats a task as paid-funded:
 * the on-chain record must exist, be Funded, and match the recipient and
 * amount the app expects. The chain is the source of truth, never the client.
 */
export async function verifyEscrowV2Funded(
  appTaskId: string,
  expectedRecipient: `0x${string}`,
  expectedAmount: bigint
): Promise<boolean> {
  const rec = await getEscrowV2Record(appTaskId);
  if (!rec) return false;
  return (
    rec.status === EscrowV2Status.Funded &&
    rec.recipient.toLowerCase() === expectedRecipient.toLowerCase() &&
    rec.amount === expectedAmount
  );
}

/**
 * MiniKit transaction payload for the poster's wallet to fund a task.
 * The POSTER is the funder and signs this from their own wallet — the server
 * never takes custody and holds no key that can move these funds anywhere
 * except the addresses bound here.
 */
export function buildFundTransaction(
  appTaskId: string,
  recipient: `0x${string}`,
  amountUsdc6: bigint,
  deadlineUnix: bigint
): { address: string; abi: typeof ESCROW_V2_ABI; functionName: "fund"; args: readonly [string, string, string, string] } | null {
  if (!escrowV2Enabled()) return null;
  return {
    address: ESCROW_V2_ADDRESS,
    abi: ESCROW_V2_ABI,
    functionName: "fund",
    args: [
      escrowV2TaskId(appTaskId),
      recipient,
      amountUsdc6.toString(),
      deadlineUnix.toString(),
    ],
  };
}

/** MiniKit payload for the poster to release payment to the bound recipient. */
export function buildReleaseTransaction(
  appTaskId: string
): { address: string; abi: typeof ESCROW_V2_ABI; functionName: "release"; args: readonly [string] } | null {
  if (!escrowV2Enabled()) return null;
  return {
    address: ESCROW_V2_ADDRESS,
    abi: ESCROW_V2_ABI,
    functionName: "release",
    args: [escrowV2TaskId(appTaskId)],
  };
}

/**
 * Server-executed refund sweep for an expired escrow. refund() is
 * anyone-callable by design and ALWAYS pays the bound funder, so running it
 * from the relayer key grants that key no power over destinations. Uses the
 * same server key that already pays gas for ops crons.
 */
export async function refundExpiredEscrowV2(
  appTaskId: string
): Promise<{ txHash: string } | null> {
  if (!escrowV2Enabled()) return null;
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) return null;
  const formatted = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  const account = privateKeyToAccount(formatted);

  const rec = await getEscrowV2Record(appTaskId);
  if (!rec || rec.status !== EscrowV2Status.Funded) return null;
  if (BigInt(Math.floor(Date.now() / 1000)) <= rec.deadline) return null;

  const client = createWalletClient({
    account,
    chain: worldchain,
    transport: http(RPC_URL),
  });
  const txHash = await client.writeContract({
    address: ESCROW_V2_ADDRESS,
    abi: ESCROW_V2_ABI,
    functionName: "refund",
    args: [escrowV2TaskId(appTaskId)],
  });
  return { txHash };
}
