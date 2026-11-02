/**
 * FavourPots rail (version 4): FAVOUR v3 money on World Chain mainnet.
 *
 * Contract config lives in ./favour-pots-v3.ts (address, ABI, settings). This module builds the
 * MiniKit payloads, reads chain state and runs the few server-signed actions. It sits NEXT TO the
 * V2_1 rail (./escrow-v2.ts, version 3), which stays untouched: every funded task is pinned to the
 * contract + version it was funded on (task.escrowV2Address / escrowV2Version), so old V2_1
 * escrows keep releasing and refunding against V2_1 forever.
 *
 * What is different from V2_1:
 *  - Single favours bind no recipient at fund time. The helper is chosen at release.
 *  - The on-chain id is keccak256(abi.encode(funder, key)), key = keccak256(appTaskId). It is
 *    derived, never stored from client input, and a stranger cannot squat a key.
 *  - The funder names a releaser at fund time: the FAVOUR server key (OPERATOR on the contract),
 *    so the app can release after review. The server key can never redirect anyone's escrow
 *    elsewhere than a helper the app names, and can never touch a refund (always to the funder).
 *  - A 2.5% fee (pinned per escrow / pot at open) is taken on payout, never on deposit or refund.
 *    Fees accrue in the contract until withdrawFees(USDC) sends them to Oscar's fee address.
 *  - Campaign pots: the server opens a pot; anyone funds it (Permit2); the server pays a favour
 *    from it to a helper, at most the pot's cap.
 *
 * Signing keys:
 *  - MiniKit (the user's World App wallet): fund favour, fund pot, release (as funder), refund.
 *  - Server (XMTP_WALLET_KEY = OPERATOR): open pot, pay from pot, release as named releaser,
 *    refund after deadline, withdraw fees.
 *  - Admin key (DEFAULT_ADMIN_ROLE) is NOT on the server: freeze/close a pot, change fee or caps,
 *    early refunds and upgrades are run from the Mac with cast.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  toEventSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { USDC_ADDRESS, WORLD_CHAIN_ID } from "./contracts";
import { PERMIT2_ADDRESS, PERMIT2_APPROVE_ABI, type MiniKitTxPayload } from "./escrow-v2";
import { FAVOUR_POTS_ABI, FAVOUR_POTS_ADDRESS, FAVOUR_POTS_SETTINGS } from "./favour-pots-v3";

/** Rail version stamped onto every task funded on FavourPots. V2_1 tasks stay version 3. */
export const FAVOUR_POTS_VERSION = 4;

/** RPC: public World Chain by default; FAVOUR_RPC_URL points the fork run at a local anvil. */
export function favourRpcUrl(): string {
  return process.env.FAVOUR_RPC_URL || "https://worldchain-mainnet.g.alchemy.com/public";
}

export function favourPotsAddress(): `0x${string}` {
  return FAVOUR_POTS_ADDRESS;
}

/**
 * New fundings go to FavourPots unless FAVOUR_RAIL=v2 (the one-line rollback to V2_1).
 * Existing tasks never consult this: they follow their pinned version.
 */
export function newFundingRailVersion(): 3 | 4 {
  return process.env.FAVOUR_RAIL === "v2" ? 3 : 4;
}

export const FAVOUR_POTS_DISCLOSURE =
  "Your USDC waits in the FAVOUR contract. You (or FAVOUR's review) pay the helper; 2.5% goes to FAVOUR at payout. Refundable to you after the deadline.";

export enum FavourStatus {
  None = 0,
  Funded = 1,
  Released = 2,
  Refunded = 3,
}

export interface FavourRecord {
  funder: `0x${string}`;
  deadline: bigint;
  feeBps: number;
  status: FavourStatus;
  releaser: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
}

export interface CampaignRecord {
  token: `0x${string}`;
  feeBps: number;
  closed: boolean;
  frozen: boolean;
  cap: bigint;
  balance: bigint;
  totalFunded: bigint;
  remainingAtClose: bigint;
}

export const EVENT_FAVOUR_FUNDED = toEventSelector(
  "FavourFunded(bytes32,bytes32,address,address,uint256,address,uint64)"
);
export const EVENT_FAVOUR_RELEASED = toEventSelector("FavourReleased(bytes32,address,uint256,uint256,address)");
export const EVENT_FAVOUR_REFUNDED = toEventSelector("FavourRefunded(bytes32,address,uint256,address)");
export const EVENT_CAMPAIGN_OPENED = toEventSelector("CampaignOpened(uint256,address,uint256,uint16)");
export const EVENT_CAMPAIGN_FUNDED = toEventSelector("CampaignFunded(uint256,address,uint256)");
export const EVENT_FAVOUR_PAID = toEventSelector("FavourPaid(uint256,bytes32,address,uint256,uint256,address)");

// ---------------------------------------------------------------------------
// ids, amounts, fee math (pure)
// ---------------------------------------------------------------------------

/** App task id -> the key the funder passes on-chain. Same derivation as the V2_1 task id. */
export function favourKey(appTaskId: string): `0x${string}` {
  return keccak256(toBytes(appTaskId));
}

/** Same derivation as FavourPots.favourId(funder, key). */
export function favourIdFor(funder: `0x${string}`, appTaskId: string): `0x${string}` {
  // Lowercase first: stored wallets can be mixed-case without a valid checksum, which viem rejects.
  const f = funder.toLowerCase() as `0x${string}`;
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [f, favourKey(appTaskId)]));
}

/** Payout split for a gross amount at a fee in bps. Mirrors the contract's floor division. */
export function splitFee(gross: bigint, feeBps: number): { net: bigint; fee: bigint } {
  const fee = (gross * BigInt(feeBps)) / BigInt(10_000);
  return { net: gross - fee, fee };
}

export function formatUsdc(units: bigint): string {
  const whole = units / BigInt(1_000_000);
  const frac = (units % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}` : `${whole}.00`;
}

/** One sentence for the pay screen, from the pinned fee. */
export function feeLine(gross: bigint, feeBps: number): string {
  const { net, fee } = splitFee(gross, feeBps);
  return `Helper receives $${formatUsdc(net)}. FAVOUR fee ${(feeBps / 100).toFixed(1)}% ($${formatUsdc(fee)}) is taken at payout, never on deposit or refund.`;
}

export function minFavourUnits(): bigint {
  return FAVOUR_POTS_SETTINGS.minAmount;
}

// ---------------------------------------------------------------------------
// clients and keys
// ---------------------------------------------------------------------------

function publicClient() {
  return createPublicClient({ chain: worldchain, transport: http(favourRpcUrl()) });
}

function operatorAccount() {
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) return null;
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
}

/** Public address of the server key (the contract's OPERATOR). Never exposes the key. */
export function operatorAddress(): `0x${string}` | null {
  return operatorAccount()?.address ?? null;
}

function walletClient() {
  const account = operatorAccount();
  if (!account) throw new Error("server key not configured");
  return createWalletClient({ account, chain: worldchain, transport: http(favourRpcUrl()) });
}

async function writeAndWait(functionName: string, args: readonly unknown[]): Promise<`0x${string}`> {
  const wc = walletClient();
  const hash = await wc.writeContract({
    address: favourPotsAddress(),
    abi: FAVOUR_POTS_ABI,
    // viem's generic typing on a large `as const` ABI is not worth fighting here; the ABI itself
    // constrains the call at runtime and the fork tests exercise every path.
    functionName: functionName as never,
    args: args as never,
  } as never);
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return hash;
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export async function getFavourRecord(id: `0x${string}`, address = favourPotsAddress()): Promise<FavourRecord | null> {
  try {
    const r = (await publicClient().readContract({
      address,
      abi: FAVOUR_POTS_ABI,
      functionName: "getFavour",
      args: [id],
    })) as unknown as FavourRecord;
    return {
      funder: r.funder,
      deadline: BigInt(r.deadline),
      feeBps: Number(r.feeBps),
      status: Number(r.status) as FavourStatus,
      releaser: r.releaser,
      token: r.token,
      amount: BigInt(r.amount),
    };
  } catch {
    return null;
  }
}

export async function getCampaignRecord(id: bigint, address = favourPotsAddress()): Promise<CampaignRecord | null> {
  try {
    const c = (await publicClient().readContract({
      address,
      abi: FAVOUR_POTS_ABI,
      functionName: "getCampaign",
      args: [id],
    })) as unknown as CampaignRecord;
    if (/^0x0{40}$/i.test(c.token)) return null;
    return {
      token: c.token,
      feeBps: Number(c.feeBps),
      closed: c.closed,
      frozen: c.frozen,
      cap: BigInt(c.cap),
      balance: BigInt(c.balance),
      totalFunded: BigInt(c.totalFunded),
      remainingAtClose: BigInt(c.remainingAtClose),
    };
  } catch {
    return null;
  }
}

export async function currentFeeBps(address = favourPotsAddress()): Promise<number> {
  try {
    return Number(await publicClient().readContract({ address, abi: FAVOUR_POTS_ABI, functionName: "feeBps" }));
  } catch {
    return FAVOUR_POTS_SETTINGS.feeBps;
  }
}

export async function feesAccrued(address = favourPotsAddress()): Promise<bigint> {
  return BigInt(
    (await publicClient().readContract({
      address,
      abi: FAVOUR_POTS_ABI,
      functionName: "feesAccrued",
      args: [USDC_ADDRESS],
    })) as bigint
  );
}

/**
 * Real tx hash of an event for this indexed id (topic1), from the chain's own logs, scanned
 * backwards in 100-block chunks (public RPC cap; same pattern as escrow-v2 findEscrowV2EventTx).
 */
export async function findPotsEventTx(
  topic0: `0x${string}`,
  topic1: `0x${string}`,
  address = favourPotsAddress()
): Promise<string | null> {
  try {
    const client = publicClient();
    const head = await client.getBlockNumber();
    const chunk = BigInt(100);
    for (let i = 0; i < 30; i++) {
      const toBlock = head - chunk * BigInt(i);
      if (toBlock < BigInt(0)) break;
      const fromBlock = toBlock >= chunk - BigInt(1) ? toBlock - (chunk - BigInt(1)) : BigInt(0);
      const logs = await client.getLogs({ address, fromBlock, toBlock });
      const hit = logs.find(
        (l) => l.topics[0]?.toLowerCase() === topic0.toLowerCase() && l.topics[1]?.toLowerCase() === topic1.toLowerCase()
      );
      if (hit?.transactionHash) return hit.transactionHash;
      if (fromBlock === BigInt(0)) break;
    }
    return null;
  } catch {
    return null;
  }
}

/** A client-reported hash counts only if its receipt carries this event for this id from this contract. */
export async function verifyPotsReceipt(
  txHash: string,
  topic0: `0x${string}`,
  topic1: `0x${string}`,
  address = favourPotsAddress()
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;
  try {
    const r = await publicClient().getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (r.status !== "success") return false;
    return r.logs.some(
      (l) =>
        l.address.toLowerCase() === address.toLowerCase() &&
        l.topics[0]?.toLowerCase() === topic0.toLowerCase() &&
        l.topics[1]?.toLowerCase() === topic1.toLowerCase()
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MiniKit payloads (signed by the user's World App wallet)
// ---------------------------------------------------------------------------

function permit2Approve(amount: bigint) {
  return {
    to: PERMIT2_ADDRESS,
    data: encodeFunctionData({
      abi: PERMIT2_APPROVE_ABI,
      functionName: "approve",
      args: [USDC_ADDRESS, favourPotsAddress(), amount, 0],
    }),
  };
}

/** [permit2.approve, fundFavourWithPermit2(key, USDC, amount, releaser = server key, deadline)]. */
export function buildFundFavourTx(appTaskId: string, amount: bigint, deadline: bigint, releaser: `0x${string}`): MiniKitTxPayload {
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      permit2Approve(amount),
      {
        to: favourPotsAddress(),
        data: encodeFunctionData({
          abi: FAVOUR_POTS_ABI,
          functionName: "fundFavourWithPermit2",
          args: [favourKey(appTaskId), USDC_ADDRESS, amount, releaser, deadline],
        }),
      },
    ],
  };
}

export function buildReleaseFavourTx(id: `0x${string}`, recipient: `0x${string}`, address = favourPotsAddress()): MiniKitTxPayload {
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      { to: address, data: encodeFunctionData({ abi: FAVOUR_POTS_ABI, functionName: "releaseFavour", args: [id, recipient] }) },
    ],
  };
}

export function buildRefundFavourTx(id: `0x${string}`, address = favourPotsAddress()): MiniKitTxPayload {
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [{ to: address, data: encodeFunctionData({ abi: FAVOUR_POTS_ABI, functionName: "refundFavour", args: [id] }) }],
  };
}

/** [permit2.approve, fundCampaignWithPermit2(id, amount)]: any World App wallet can top up a pot. */
export function buildFundCampaignTx(campaignId: bigint, amount: bigint): MiniKitTxPayload {
  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      permit2Approve(amount),
      {
        to: favourPotsAddress(),
        data: encodeFunctionData({ abi: FAVOUR_POTS_ABI, functionName: "fundCampaignWithPermit2", args: [campaignId, amount] }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// server-signed actions (OPERATOR = XMTP_WALLET_KEY)
// ---------------------------------------------------------------------------

/** Opens a USDC pot with a per-favour cap. Returns the new campaign id from the event. */
export async function serverOpenCampaign(cap: bigint): Promise<{ campaignId: bigint; txHash: string }> {
  const txHash = await writeAndWait("openCampaign", [USDC_ADDRESS, cap]);
  const receipt = await publicClient().getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== favourPotsAddress().toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== EVENT_CAMPAIGN_OPENED.toLowerCase()) continue;
    const ev = decodeEventLog({ abi: FAVOUR_POTS_ABI, data: log.data, topics: log.topics }) as unknown as {
      args: { id: bigint };
    };
    return { campaignId: BigInt(ev.args.id), txHash };
  }
  throw new Error("CampaignOpened event missing");
}

export async function serverPayFromPot(
  campaignId: bigint,
  key: `0x${string}`,
  recipient: `0x${string}`,
  amount: bigint
): Promise<string> {
  return writeAndWait("payFromPot", [campaignId, key, recipient, amount]);
}

/** Server releases a single favour as the releaser the funder named at fund time. */
export async function serverReleaseFavour(id: `0x${string}`, recipient: `0x${string}`): Promise<string> {
  return writeAndWait("releaseFavour", [id, recipient]);
}

/** After the deadline anyone may refund; the money always goes to the funder. */
export async function serverRefundFavour(id: `0x${string}`): Promise<string> {
  return writeAndWait("refundFavour", [id]);
}

/** Sends accrued fees to the fee address stored on the contract. Best effort; returns null if none. */
export async function withdrawFeesBestEffort(): Promise<string | null> {
  try {
    if ((await feesAccrued()) === BigInt(0)) return null;
    return await writeAndWait("withdrawFees", [USDC_ADDRESS]);
  } catch (e) {
    console.error("withdrawFees failed", e);
    return null;
  }
}
