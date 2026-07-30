/**
 * FavourEscrowV2 — the new money rail (World Chain mainnet, chain id 480).
 *
 * THIS MODULE IS THE ONLY CONFIG SOURCE FOR THE RAIL. The contract address,
 * version, and launch caps all resolve here and nowhere else — a guard test
 * (escrow-v2-address.guard.test.ts) fails the suite if the literal address
 * appears in any other source file. That is deliberate: the rail must be
 * replaceable by config, never by a migration.
 *
 * WHY WE ARE NOT CORNERED (the lesson of the retired proxy):
 *   - Per-favour escrow state is EPHEMERAL: every escrow has two guaranteed
 *     exits (release by the funder any time; refund by anyone post-deadline,
 *     always to the funder). Nothing accumulates in the contract.
 *   - Each funded task PINS the contract address + version it was funded on
 *     (task.escrowV2Address / task.escrowV2Version), and every later chain
 *     read for that task uses the pinned address.
 *   - Therefore a v2.1 (e.g. dispute resolution) is: deploy + verify the new
 *     contract, flip ESCROW_V2_CONTRACT in env. Old escrows drain naturally
 *     against their pinned address; new fundings go to the new one. Zero
 *     migration, zero stranded funds, no upgradeability anywhere.
 *
 * Contract (current default): 0x61041dfC405D6CeA57653B8E8BCBDA209214682f
 *   (FavourEscrowV2_1 — INCIDENT 2026-07-31 successor of
 *   0x4a86A95E91AD92e47C7c08edBb01dcB2219bC47C, which had no Permit2 fund
 *   path; the retired address was never funded by anyone but the deploy
 *   self-test, verified drained by event-log probe.)
 *   - Immutable: no proxy, no owner, no admin, no pause, no fee. The deployer
 *     key has zero power over it. Source is verified on the explorer:
 *     https://worldchain-mainnet.explorer.alchemy.com/address/0x61041dfC405D6CeA57653B8E8BCBDA209214682f?tab=contract
 *   - Task-bound: funds bind to (taskId, recipient, amount) at fund time.
 *     release/refund take ONLY the task id — no caller-supplied destination
 *     exists anywhere in the ABI (this kills the redirect/question-swap class).
 *   - Exits: release (funder ONLY — the ABI has no permissionless release;
 *     `NotFunder` reverts anyone else) or refund (anyone, after deadline,
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
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  toEventSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { USDC_ADDRESS, WORLD_CHAIN_ID } from "./contracts";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

/** Rail version stamped onto every funded task record. 3 = FavourEscrowV2_1
 *  (Permit2 AllowanceTransfer fund path added after INCIDENT 2026-07-31). */
export const ESCROW_V2_VERSION = 3;

/**
 * The deployed, source-verified default. The ONLY place this literal may
 * exist outside its own guard test. Everything else calls escrowV2Address().
 */
const DEFAULT_ESCROW_V2_ADDRESS =
  "0x61041dfC405D6CeA57653B8E8BCBDA209214682f" as const;

/**
 * Canonical Permit2 (same address on every chain; bytecode presence on World
 * Chain verified by eth_getCode probe, 2026-07-31). World App auto-approves
 * ERC-20s to Permit2 at the token level; mini apps move tokens by batching a
 * permit2.approve(token, spender, amount, 0) with the contract call that pulls
 * via permit2.transferFrom (docs.world.org/mini-apps/commands/send-transaction,
 * "Permit2 Allowance Transfers (Recommended)").
 */
export const PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/**
 * CONFIG SOURCE for the contract address. ESCROW_V2_CONTRACT in env overrides
 * the default — that one flip is how a future v2.1 contract goes live.
 */
export function escrowV2Address(): `0x${string}` {
  const env = process.env.ESCROW_V2_CONTRACT;
  if (env && /^0x[0-9a-fA-F]{40}$/.test(env)) return env as `0x${string}`;
  return DEFAULT_ESCROW_V2_ADDRESS;
}

/**
 * Launch caps — env-configurable, UNLIMITED by default (0 or absent = no cap).
 * Campaigns funding large bounties are a first-class use case; the protection
 * at the fund step is honesty (the poster sees exactly the exit rules) plus
 * the contract's own guarantees, not an arbitrary dollar ceiling.
 */
export function escrowV2MaxUsd(): number {
  const n = Number(process.env.ESCROW_V2_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/** Max concurrent FUNDED escrows per poster. 0/absent = unlimited. */
export function escrowV2MaxConcurrent(): number {
  const n = Number(process.env.ESCROW_V2_MAX_CONCURRENT);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/** The one line of honesty every funder sees at the fund step. */
export const ESCROW_V2_FUND_DISCLOSURE =
  "Released when you confirm completion. Auto-refundable to you after the deadline.";

/** Contract-enforced ceiling on how far out a deadline may sit (180 days). */
export const ESCROW_V2_MAX_DURATION_S = 180 * 24 * 3600;

/** Grace period after the task deadline before the escrow becomes refundable —
 *  the poster's window to confirm late-but-good work before anyone can sweep
 *  the refund. */
export const ESCROW_V2_CONFIRM_GRACE_S = 72 * 3600;

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
    name: "fundWithPermit2",
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

/** Permit2 AllowanceTransfer.approve — the exact ABI from the docs example
 *  ("You must use this method of Allowance Transfers"). */
const PERMIT2_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/** Event selectors for receipt verification (topic0). */
export const ESCROW_V2_EVENT_FUNDED = toEventSelector(
  "Funded(bytes32,address,address,uint256,uint64)"
);
export const ESCROW_V2_EVENT_RELEASED = toEventSelector(
  "Released(bytes32,address,uint256)"
);
export const ESCROW_V2_EVENT_REFUNDED = toEventSelector(
  "Refunded(bytes32,address,uint256)"
);

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

/** USDC dollars (app-side number) -> 6-decimal on-chain units, exact. */
export function usdToUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

/**
 * Escrow deadline for a task: the task's proof deadline plus a confirm grace
 * window, clamped inside the contract's MAX_DURATION so fund() cannot revert
 * on DeadlineInvalid.
 */
export function escrowV2DeadlineFor(
  taskDeadlineIso: string,
  nowMs: number = Date.now()
): bigint {
  const nowS = Math.floor(nowMs / 1000);
  const taskS = Math.floor(new Date(taskDeadlineIso).getTime() / 1000);
  const want = Math.max(taskS, nowS + 3600) + ESCROW_V2_CONFIRM_GRACE_S;
  const max = nowS + ESCROW_V2_MAX_DURATION_S - 3600; // 1h safety margin
  return BigInt(Math.min(want, max));
}

function publicClient() {
  return createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
}

/**
 * Read the on-chain escrow record for an app task. Null when the rail is dark.
 * `contractAddress` lets funded tasks read against their PINNED address even
 * after the config default moves to a newer contract.
 */
export async function getEscrowV2Record(
  appTaskId: string,
  contractAddress?: `0x${string}`
): Promise<EscrowV2Record | null> {
  if (!escrowV2Enabled()) return null;
  const rec = await publicClient().readContract({
    address: contractAddress ?? escrowV2Address(),
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
 * the on-chain record must exist, be Funded, and match the recipient, amount,
 * AND funder the app expects (funder = poster: a stranger funding someone
 * else's task would leave release control with the stranger, so it fails
 * closed). The chain is the source of truth, never the client.
 */
export async function verifyEscrowV2Funded(
  appTaskId: string,
  expected: {
    recipient: `0x${string}`;
    amount: bigint;
    funder: `0x${string}`;
  },
  contractAddress?: `0x${string}`
): Promise<EscrowV2Record | null> {
  const rec = await getEscrowV2Record(appTaskId, contractAddress);
  if (!rec) return null;
  const ok =
    rec.status === EscrowV2Status.Funded &&
    rec.recipient.toLowerCase() === expected.recipient.toLowerCase() &&
    rec.funder.toLowerCase() === expected.funder.toLowerCase() &&
    rec.amount === expected.amount;
  return ok ? rec : null;
}

/**
 * Verify that a client-supplied tx hash really is the escrow event it claims
 * to be: mined, successful, emitted by THIS escrow contract, for THIS task id.
 * Used before storing any tx hash on a task record — a hash the chain does
 * not corroborate is never stored.
 */
export async function verifyEscrowV2Receipt(
  txHash: string,
  eventTopic0: `0x${string}`,
  appTaskId: string,
  contractAddress?: `0x${string}`
): Promise<boolean> {
  if (!escrowV2Enabled()) return false;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;
  const address = (contractAddress ?? escrowV2Address()).toLowerCase();
  const taskIdHash = escrowV2TaskId(appTaskId).toLowerCase();
  try {
    const receipt = await publicClient().getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") return false;
    return receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === address &&
        log.topics[0]?.toLowerCase() === eventTopic0.toLowerCase() &&
        log.topics[1]?.toLowerCase() === taskIdHash
    );
  } catch {
    return false;
  }
}

/** MiniKit.sendTransaction payload: raw calldata, matching the shape the rest
 *  of the app already sends (see contracts.ts encodeCreateTask). */
export type MiniKitTxPayload = {
  chainId: number;
  transactions: Array<{ to: `0x${string}`; data: `0x${string}` }>;
};

/**
 * MiniKit transaction batch for the poster's wallet to fund a task — the
 * canonical World App Permit2 Allowance Transfer pattern
 * (docs.world.org/mini-apps/commands/send-transaction):
 * [0] permit2.approve(USDC, escrow, amount, 0) — expiration 0 means the
 *     allowance lives only inside this batch ("the approval will be consumed
 *     in the same transaction"); nothing durable is left behind.
 * [1] escrow.fundWithPermit2(taskIdHash, recipient, amount, deadline), which
 *     pulls via permit2.transferFrom(msg.sender, escrow, amount, USDC).
 * The POSTER is the funder and signs this from their own wallet — the server
 * never takes custody and holds no key that can move these funds anywhere
 * except the addresses bound here.
 *
 * Dev Portal requirements (Permissions page), or World App blocks the batch
 * with `invalid_contract`:
 *   - Contract Entrypoints: the escrow address AND Permit2
 *     (0x000000000022D473030F116dDEE9F6B43aC78BA3) — both are direct call
 *     targets of this batch.
 *   - Permit2 Tokens: World Chain USDC — "every ERC-20 token your app
 *     transfers via Permit2".
 */
export function buildFundTransactions(
  appTaskId: string,
  recipient: `0x${string}`,
  amountUsdc6: bigint,
  deadlineUnix: bigint
): MiniKitTxPayload | null {
  if (!escrowV2Enabled()) return null;
  const escrow = escrowV2Address();
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      {
        to: PERMIT2_ADDRESS,
        data: encodeFunctionData({
          abi: PERMIT2_APPROVE_ABI,
          functionName: "approve",
          args: [USDC_ADDRESS, escrow, amountUsdc6, 0],
        }),
      },
      {
        to: escrow,
        data: encodeFunctionData({
          abi: ESCROW_V2_ABI,
          functionName: "fundWithPermit2",
          args: [escrowV2TaskId(appTaskId), recipient, amountUsdc6, deadlineUnix],
        }),
      },
    ],
  };
}

/** MiniKit payload for the poster to release payment to the bound recipient.
 *  Chain-enforced funder-only (`NotFunder`) — a server relayer CANNOT release. */
export function buildReleaseTransaction(
  appTaskId: string,
  contractAddress?: `0x${string}`
): MiniKitTxPayload | null {
  if (!escrowV2Enabled()) return null;
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      {
        to: contractAddress ?? escrowV2Address(),
        data: encodeFunctionData({
          abi: ESCROW_V2_ABI,
          functionName: "release",
          args: [escrowV2TaskId(appTaskId)],
        }),
      },
    ],
  };
}

/** MiniKit payload for the poster to reclaim an expired escrow. The contract
 *  lets ANYONE call refund post-deadline (destination is always the funder),
 *  so surfacing it to the poster grants nothing extra. */
export function buildRefundTransaction(
  appTaskId: string,
  contractAddress?: `0x${string}`
): MiniKitTxPayload | null {
  if (!escrowV2Enabled()) return null;
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      {
        to: contractAddress ?? escrowV2Address(),
        data: encodeFunctionData({
          abi: ESCROW_V2_ABI,
          functionName: "refund",
          args: [escrowV2TaskId(appTaskId)],
        }),
      },
    ],
  };
}

/**
 * Server-derived tx hash for an escrow event: query the chain's own logs for
 * (contract, event, taskId) instead of trusting any client-supplied hash.
 * Returns the REAL transaction hash or null. This is the primary source for
 * the hashes stored on task records; a client hash is only a fallback that
 * still has to survive verifyEscrowV2Receipt.
 *
 * INCIDENT 2026-07-31 hardening: the public World Chain RPC rejects
 * eth_getLogs ranges over 100 blocks, so the original fromBlock:0 sweep
 * ALWAYS threw (silently, into the catch) — the primary source was dead on
 * arrival and verification would have leaned forever on a client hash the
 * client doesn't have (MiniKit returns a userOpHash, not a tx hash). Probe:
 * a full-range request returns `-32600 "up to a 100 block range"`. The walk
 * below scans backwards in RPC-sized chunks; verify actions run within the
 * signing session, so the event is always near the head.
 */
const LOG_SCAN_CHUNK = BigInt(100); // public RPC hard cap per eth_getLogs request
const LOG_SCAN_CHUNKS = 30; // ~3000 blocks ≈ 100 minutes of World Chain

export async function findEscrowV2EventTx(
  appTaskId: string,
  eventTopic0: `0x${string}`,
  contractAddress?: `0x${string}`
): Promise<string | null> {
  if (!escrowV2Enabled()) return null;
  try {
    const client = publicClient();
    const head = await client.getBlockNumber();
    const taskIdHash = escrowV2TaskId(appTaskId).toLowerCase();
    const address = contractAddress ?? escrowV2Address();
    for (let i = 0; i < LOG_SCAN_CHUNKS; i++) {
      const toBlock = head - LOG_SCAN_CHUNK * BigInt(i);
      if (toBlock < BigInt(0)) break;
      const fromBlock =
        toBlock >= LOG_SCAN_CHUNK - BigInt(1) ? toBlock - (LOG_SCAN_CHUNK - BigInt(1)) : BigInt(0);
      const logs = await client.getLogs({ address, fromBlock, toBlock });
      const hit = logs.find(
        (log) =>
          log.topics[0]?.toLowerCase() === eventTopic0.toLowerCase() &&
          log.topics[1]?.toLowerCase() === taskIdHash
      );
      if (hit?.transactionHash) return hit.transactionHash;
      if (fromBlock === BigInt(0)) break;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Server-executed refund sweep for an expired escrow. refund() is
 * anyone-callable by design and ALWAYS pays the bound funder, so running it
 * from the relayer key grants that key no power over destinations. Uses the
 * same server key that already pays gas for ops crons.
 */
export async function refundExpiredEscrowV2(
  appTaskId: string,
  contractAddress?: `0x${string}`
): Promise<{ txHash: string } | null> {
  if (!escrowV2Enabled()) return null;
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) return null;
  const formatted = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  const account = privateKeyToAccount(formatted);

  const rec = await getEscrowV2Record(appTaskId, contractAddress);
  if (!rec || rec.status !== EscrowV2Status.Funded) return null;
  if (BigInt(Math.floor(Date.now() / 1000)) <= rec.deadline) return null;

  const client = createWalletClient({
    account,
    chain: worldchain,
    transport: http(RPC_URL),
  });
  const txHash = await client.writeContract({
    address: contractAddress ?? escrowV2Address(),
    abi: ESCROW_V2_ABI,
    functionName: "refund",
    args: [escrowV2TaskId(appTaskId)],
  });
  return { txHash };
}
