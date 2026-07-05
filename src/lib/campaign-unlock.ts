import { parseUnits } from "viem";
import type { Task } from "./types";
import { getCampaign } from "./campaigns";
import { getRedis } from "./redis";
import { getPayoutClients, USDC_ADDRESS } from "./escrow";

// Campaign-unlock mechanic (spec: vault campaign-unlock-mechanic.md, decided
// Jul 5: threshold unlock, off-chain MVP, Orb is the key).
//
// Money invariants honored here (SECURITY-INVARIANTS.md):
// - Cash unlocks ONLY through the clean gate: AI verdict "pass" + Orb-verified
//   claimant + threshold of counted completions. Flags and non-Orb never count.
// - Paid means settled: the payout tx hash is persisted BEFORE awaiting the
//   receipt (a timeout must not lose a broadcast tx), and `paid` flips true only
//   on a confirmed success receipt. Reverted transfers are retried, never
//   reported as paid.
// - The pot is a HARD cap enforced by slot reservation BEFORE the transfer is
//   sent, so concurrent unlocks cannot overdraw it.
//
// Redis keys:
//   unlock:{campaignId}:progress:{wallet}  counted clean completions (capped)
//   unlock:{campaignId}:state:{wallet}     {reserved, payTx, paid}
//   unlock:{campaignId}:paidCount          reserved slots (pot accounting)
//   unlock:retry                           set of "{campaignId}|{wallet}" needing retry

export type UnlockState = {
  reserved: boolean;
  payTx: string | null;
  paid: boolean;
};

export type PayoutResult = { hash: string; success: boolean };
// Injectable for tests; the default sends real USDC from the relayer wallet.
export type PayoutSender = (recipient: `0x${string}`, amountUsdc: number) => Promise<PayoutResult | null>;

const USDC_TRANSFER_ABI = [{
  name: "transfer",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

async function defaultSendPayout(recipient: `0x${string}`, amountUsdc: number): Promise<PayoutResult | null> {
  const clients = getPayoutClients();
  if (!clients) return null;
  const hash = await clients.wallet.client.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient, parseUnits(amountUsdc.toString(), 6)],
  });
  const receipt = await clients.pub.waitForTransactionReceipt({ hash });
  return { hash, success: receipt.status === "success" };
}

async function resolveTxOnChain(hash: string): Promise<"success" | "reverted" | "unknown"> {
  const clients = getPayoutClients();
  if (!clients) return "unknown";
  try {
    const rcpt = await clients.pub.getTransactionReceipt({ hash: hash as `0x${string}` });
    return rcpt.status === "success" ? "success" : "reverted";
  } catch {
    return "unknown";
  }
}

function stateKey(campaignId: string, wallet: string) {
  return `unlock:${campaignId}:state:${wallet.toLowerCase()}`;
}
// Progress is a SET of distinct task ids, not a counter: multi-completion tasks
// reopen after every pass, so a counter would let one user hit the threshold by
// repeating the same task three times with three near-identical proofs.
function progressKey(campaignId: string, wallet: string) {
  return `unlock:${campaignId}:progress:${wallet.toLowerCase()}`;
}
function paidCountKey(campaignId: string) {
  return `unlock:${campaignId}:paidCount`;
}

async function loadState(campaignId: string, wallet: string): Promise<UnlockState> {
  const redis = getRedis();
  const empty: UnlockState = { reserved: false, payTx: null, paid: false };
  if (!redis) return empty;
  const raw = await redis.get(stateKey(campaignId, wallet));
  if (!raw) return empty;
  return typeof raw === "string" ? (JSON.parse(raw) as UnlockState) : (raw as UnlockState);
}

async function saveState(campaignId: string, wallet: string, state: UnlockState): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(stateKey(campaignId, wallet), JSON.stringify(state));
}

export async function getUnlockProgress(campaignId: string, wallet: string): Promise<{
  progress: number;
  threshold: number;
  unlockAmount: number;
  paid: boolean;
  payTx: string | null;
  potExhausted: boolean;
} | null> {
  const campaign = getCampaign(campaignId);
  if (!campaign?.unlock) return null;
  const redis = getRedis();
  const progress = redis ? Number((await redis.scard(progressKey(campaignId, wallet))) || 0) : 0;
  const state = await loadState(campaignId, wallet);
  const paidCount = redis ? Number((await redis.get(paidCountKey(campaignId))) || 0) : 0;
  const potExhausted =
    !state.reserved && (paidCount + 1) * campaign.unlock.unlockAmount > campaign.unlock.pot;
  return {
    progress,
    threshold: campaign.unlock.unlockThreshold,
    unlockAmount: campaign.unlock.unlockAmount,
    paid: state.paid,
    payTx: state.paid ? state.payTx : null,
    potExhausted,
  };
}

// Called from the verify-proof PASS path only. Counts the completion toward the
// campaign's unlock when (and only when) the clean gate holds, then attempts the
// payout if the threshold is reached. Never throws to the caller.
export async function recordCampaignCompletion(
  task: Task,
  sendPayout: PayoutSender = defaultSendPayout
): Promise<{ counted: boolean; unlockTx: string | null }> {
  const none = { counted: false, unlockTx: null };
  const campaignId = task.campaignId;
  if (!campaignId) return none;
  const campaign = getCampaign(campaignId);
  if (!campaign?.unlock) return none;
  const wallet = task.claimant;
  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) return none;

  // The clean gate. verdict is checked by the caller (pass path), Orb here.
  if (campaign.unlock.requiresOrb && task.claimantVerification !== "orb") return none;
  if (task.verificationResult && task.verificationResult.verdict !== "pass") return none;

  const redis = getRedis();
  if (!redis) return none;

  // Count DISTINCT tasks, capped at maxCountedPerUser. sadd is idempotent, so
  // repeating the same (multi-completion) task never advances progress.
  const current = Number((await redis.scard(progressKey(campaignId, wallet))) || 0);
  let progress = current;
  if (current < campaign.unlock.maxCountedPerUser) {
    await redis.sadd(progressKey(campaignId, wallet), task.id);
    progress = Number((await redis.scard(progressKey(campaignId, wallet))) || 0);
  }

  if (progress < campaign.unlock.unlockThreshold) return { counted: progress > current, unlockTx: null };

  const unlockTx = await tryUnlockPayout(campaignId, wallet, sendPayout);
  return { counted: progress > current, unlockTx };
}

// Idempotent, pot-capped payout. Reservation before send; payTx persisted before
// the receipt await; paid only on confirmed success.
export async function tryUnlockPayout(
  campaignId: string,
  wallet: string,
  sendPayout: PayoutSender = defaultSendPayout
): Promise<string | null> {
  const campaign = getCampaign(campaignId);
  if (!campaign?.unlock) return null;
  const redis = getRedis();
  if (!redis) return null;

  const lockKey = `unlock:${campaignId}:lock:${wallet.toLowerCase()}`;
  const acquired = await redis.set(lockKey, "1", { nx: true, px: 60_000 });
  if (!acquired) return null;

  try {
    const state = await loadState(campaignId, wallet);
    if (state.paid) return state.payTx;

    // Double-pay guard: resolve any previously broadcast tx before sending again.
    if (state.payTx) {
      const status = await resolveTxOnChain(state.payTx);
      if (status === "success") {
        await saveState(campaignId, wallet, { ...state, paid: true });
        await redis.srem("unlock:retry", `${campaignId}|${wallet}`);
        return state.payTx;
      }
      if (status === "unknown") {
        // May still mine. Back off; the retry set resolves it later.
        await redis.sadd("unlock:retry", `${campaignId}|${wallet}`);
        return null;
      }
      // reverted: safe to re-send below (slot stays reserved).
    }

    // Pot accounting: reserve a slot BEFORE sending so concurrent unlocks can't
    // overdraw. A reservation survives retries and is only made once per wallet.
    if (!state.reserved) {
      const reservedCount = await redis.incr(paidCountKey(campaignId));
      if (reservedCount * campaign.unlock.unlockAmount > campaign.unlock.pot) {
        await redis.decr(paidCountKey(campaignId));
        console.error(`[Unlock] Pot exhausted for ${campaignId}; ${wallet} qualified but no funds left`);
        return null;
      }
      state.reserved = true;
      await saveState(campaignId, wallet, state);
    }

    let result: PayoutResult | null = null;
    try {
      result = await sendPayout(wallet as `0x${string}`, campaign.unlock.unlockAmount);
    } catch (err) {
      console.error(`[Unlock] Payout send failed for ${campaignId}/${wallet}:`, err);
    }
    if (!result) {
      await redis.sadd("unlock:retry", `${campaignId}|${wallet}`);
      return null;
    }

    // Persist the hash regardless of receipt outcome (a lost hash risks double-pay).
    state.payTx = result.hash;
    state.paid = result.success;
    await saveState(campaignId, wallet, state);
    if (!result.success) {
      console.error(`[Unlock] Payout tx ${result.hash} reverted for ${campaignId}/${wallet}`);
      await redis.sadd("unlock:retry", `${campaignId}|${wallet}`);
      return null;
    }
    await redis.srem("unlock:retry", `${campaignId}|${wallet}`);
    console.log(`[Unlock] ${wallet} unlocked $${campaign.unlock.unlockAmount} from ${campaignId}: ${result.hash}`);
    return result.hash;
  } finally {
    await redis.del(lockKey);
  }
}

// Drained by the reconcile-settlements cron: finishes unlocks whose payout
// broadcast was lost, reverted, or never sent.
export async function retryPendingUnlocks(
  sendPayout: PayoutSender = defaultSendPayout
): Promise<{ retried: number; settled: number }> {
  const redis = getRedis();
  if (!redis) return { retried: 0, settled: 0 };
  const entries = ((await redis.smembers("unlock:retry")) || []) as string[];
  let settled = 0;
  for (const entry of entries) {
    const [campaignId, wallet] = entry.split("|");
    if (!campaignId || !wallet) continue;
    const tx = await tryUnlockPayout(campaignId, wallet, sendPayout);
    if (tx) settled++;
  }
  return { retried: entries.length, settled };
}
