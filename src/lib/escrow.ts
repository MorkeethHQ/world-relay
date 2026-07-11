import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { getRedis } from "./redis";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0x274C38eA9944f57D24A59fbEf558bba2264f9351") as `0x${string}`;

const ESCROW_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "createTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_description", type: "string" },
      { name: "_bounty", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "createTaskFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_agent", type: "address" },
      { name: "_description", type: "string" },
      { name: "_bounty", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "fundTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_taskId", type: "uint256" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "claimTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "releasePayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "taskCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTask",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "agent", type: "address" },
        { name: "claimant", type: "address" },
        { name: "description", type: "string" },
        { name: "bounty", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "status", type: "uint8" },
      ],
    }],
  },
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "feeRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "communityRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalFeesCollected",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function getSignerKey(): string | null {
  const raw = process.env.XMTP_WALLET_KEY;
  return raw ? raw.trim() : null;
}

function getPublicClient() {
  return createPublicClient({
    chain: worldchain,
    transport: http(RPC_URL),
  });
}

function getWalletClient() {
  const key = getSignerKey();
  if (!key) return null;
  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  return { client: createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) }), account };
}

// The payout signer (relayer) + public client, for the other real-money path
// (campaign unlock, src/lib/campaign-unlock.ts). Same key, same discipline.
export function getPayoutClients() {
  const wallet = getWalletClient();
  if (!wallet) return null;
  return { wallet, pub: getPublicClient() };
}

// ── Settlement state (atomic-or-recoverable release) ────────────
//
// releaseEscrow performs two on-chain steps: releasePayment (funds move to the
// relayer that claimed on the user's behalf) and a USDC forward to the real
// recipient. These cannot be a single atomic tx, so we persist per-task state
// in redis. A release is only reported as a success hash once the forward is
// confirmed. If the forward fails, released stays true and forwarded stays
// false so retryForward can finish settlement without double-releasing.

type Wallet = NonNullable<ReturnType<typeof getWalletClient>>;
type PubClient = ReturnType<typeof getPublicClient>;

type SettlementState = {
  released: boolean;
  forwarded: boolean;
  forwardTx: string | null;
};

function isValidRecipient(addr?: string | null): boolean {
  return !!addr && addr.startsWith("0x") && addr.length === 42;
}

async function loadSettlement(onChainId: number): Promise<SettlementState | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`settle:${onChainId}`);
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as SettlementState;
    return raw as SettlementState;
  } catch (err) {
    console.error(`[Escrow] Failed to load settlement state for ${onChainId}:`, err);
    return null;
  }
}

async function saveSettlement(onChainId: number, state: SettlementState): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`settle:${onChainId}`, JSON.stringify(state));
  } catch (err) {
    console.error(`[Escrow] Failed to save settlement state for ${onChainId}:`, err);
  }
}

const USDC_TRANSFER_ABI = [{
  name: "transfer",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

// Forwards the payout (bounty minus fees) to the recipient and only returns a
// success hash once the transfer is confirmed. On failure it leaves the
// settlement marked released-but-not-forwarded so it can be retried.
async function forwardPayout(
  onChainId: number,
  recipient: `0x${string}`,
  wallet: Wallet,
  pub: PubClient,
): Promise<string | null> {
  // Double-pay guard: a prior attempt may have BROADCAST a transfer whose receipt
  // we never observed (RPC timeout in waitForTransactionReceipt does NOT mean the
  // tx failed — it can still mine). Before sending a new transfer, resolve any
  // recorded forwardTx on-chain. Only re-send if it definitively reverted; if it
  // succeeded, adopt it; if still unknown/pending, back off (return null) rather
  // than risk a second transfer.
  const prior = await loadSettlement(onChainId);
  if (prior?.forwardTx) {
    try {
      const rcpt = await pub.getTransactionReceipt({ hash: prior.forwardTx as `0x${string}` });
      if (rcpt?.status === "success") {
        await saveSettlement(onChainId, { released: true, forwarded: true, forwardTx: prior.forwardTx });
        return prior.forwardTx;
      }
      // rcpt exists but reverted -> safe to re-send below.
    } catch {
      // Receipt not found yet: the prior transfer may still be pending. Do NOT
      // send a second one; let the next reconcile pass resolve it.
      console.error(`[Escrow] Task ${onChainId}: prior forwardTx ${prior.forwardTx} unresolved, backing off to avoid double-pay`);
      return null;
    }
  }

  try {
    const onChainTask = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getTask",
      args: [BigInt(onChainId)],
    });
    const bountyAmount = onChainTask.bounty;
    const feeRate = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "feeRate" });
    const communityRate = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "communityRate" });
    const payout = bountyAmount - (bountyAmount * feeRate) / BigInt(10000) - (bountyAmount * communityRate) / BigInt(10000);

    const transferHash = await wallet.client.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_TRANSFER_ABI,
      functionName: "transfer",
      args: [recipient, payout],
    });
    // Persist the hash BEFORE awaiting the receipt, so a receipt timeout can't lose
    // it: the guard above will resolve this exact tx on the next attempt instead of
    // sending a duplicate.
    await saveSettlement(onChainId, { released: true, forwarded: false, forwardTx: transferHash });
    const forwardRcpt = await pub.waitForTransactionReceipt({ hash: transferHash });
    // waitForTransactionReceipt does NOT throw on revert — it returns a receipt
    // with status "reverted". Never report a reverted transfer as paid. Keep the
    // hash recorded (forwarded:false) so the double-pay guard resolves it as
    // reverted and safely re-sends on the next attempt.
    if (forwardRcpt.status !== "success") {
      console.error(`[Escrow] Task ${onChainId}: forward transfer ${transferHash} reverted on-chain`);
      await saveSettlement(onChainId, { released: true, forwarded: false, forwardTx: transferHash });
      return null;
    }

    await saveSettlement(onChainId, { released: true, forwarded: true, forwardTx: transferHash });
    return transferHash;
  } catch (err) {
    console.error(`[Escrow] Forward payout failed for task ${onChainId}:`, err);
    // Preserve any forwardTx we recorded above (do NOT null it) so the guard can
    // resolve it on retry rather than re-sending.
    const cur = await loadSettlement(onChainId);
    await saveSettlement(onChainId, { released: true, forwarded: false, forwardTx: cur?.forwardTx ?? null });
    return null;
  }
}

export async function releaseEscrow(onChainId: number, recipientAddress?: string | null): Promise<string | null> {
  const wallet = getWalletClient();
  if (!wallet) {
    console.error("[Escrow] No signer key - cannot release payment");
    return null;
  }

  // Hard-fail on missing or invalid recipient. Without a valid recipient we
  // cannot forward the payout, so releasing on-chain would strand funds in the
  // relayer. Never report success in that case.
  if (!isValidRecipient(recipientAddress)) {
    console.error(`[Escrow] Task ${onChainId}: missing or invalid recipient, refusing to release`);
    return null;
  }
  const recipient = recipientAddress as `0x${string}`;

  // Mutual exclusion: releaseEscrow is called from two settlement paths (verify-
  // proof pass + the hourly reconcile cron) and can be manually re-triggered.
  // Two concurrent runs on the same task could both pass the double-pay guard's
  // "no forwardTx recorded yet" window and both transfer USDC. Serialize per task.
  // The forwardTx guard in forwardPayout remains the second line of defence if
  // this lock ever lapses (px) mid-settlement.
  const redis = getRedis();
  const lockKey = `settle:lock:${onChainId}`;
  if (redis) {
    const got = await redis.set(lockKey, "1", { nx: true, px: 120_000 });
    if (!got) {
      console.error(`[Escrow] Task ${onChainId}: settlement already in progress, skipping concurrent release`);
      return null;
    }
  }

  try {
    const pub = getPublicClient();
    const state = await loadSettlement(onChainId);

    // Already fully settled in a prior attempt: return the confirmed forward tx.
    if (state?.released && state.forwarded && state.forwardTx) {
      return state.forwardTx;
    }
    // Released on-chain before but the forward failed: skip release (double-release
    // guard) and just retry the forward.
    if (state?.released && !state.forwarded) {
      return await forwardPayout(onChainId, recipient, wallet, pub);
    }

    const onChainTask = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getTask",
      args: [BigInt(onChainId)],
    });

    // Task must be Open or Claimed to proceed
    if (onChainTask.status !== 0 && onChainTask.status !== 1) {
      return null;
    }

    // SECURITY (invariant 2): releasePayment pays the ON-CHAIN claimant. This flow
    // relies on the relayer being that claimant — for an Open task it claims just
    // below. But if the task is ALREADY Claimed by anyone other than the relayer
    // (an attacker calling claimTask() directly, or a runner self-claiming on-chain
    // via the client), releasePayment sends the escrow to THEM and forwardPayout
    // then pays `recipient` a second time out of the relayer's own USDC — theft +
    // double-pay. A funded escrow claimed on-chain by a non-relayer is compromised:
    // refuse, alert, and leave it for out-of-band handling. Never auto-release it.
    const relayer = wallet.account.address.toLowerCase();
    if (onChainTask.status === 1 && onChainTask.claimant.toLowerCase() !== relayer) {
      console.error(
        `[Escrow] Task ${onChainId}: on-chain claimant ${onChainTask.claimant} is not the relayer ${wallet.account.address} — refusing to release (on-chain claim hijack).`
      );
      return null;
    }

    // If Open, claim on-chain first (relayer claims on behalf of user)
    if (onChainTask.status === 0) {
      const claimHash = await wallet.client.writeContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "claimTask",
        args: [BigInt(onChainId)],
      });
      const claimRcpt = await pub.waitForTransactionReceipt({ hash: claimHash });
      if (claimRcpt.status !== "success") {
        console.error(`[Escrow] Task ${onChainId}: claimTask ${claimHash} reverted, aborting release`);
        return null;
      }
    }

    const hash = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "releasePayment",
      args: [BigInt(onChainId)],
    });

    // A reverted releasePayment must NOT proceed to the USDC forward — otherwise
    // the relayer pays out of its own pocket while the bounty stays in escrow.
    const releaseRcpt = await pub.waitForTransactionReceipt({ hash });
    if (releaseRcpt.status !== "success") {
      console.error(`[Escrow] Task ${onChainId}: releasePayment ${hash} reverted, not forwarding`);
      return null;
    }

    // Persist that the release is done BEFORE forwarding, so a forward failure
    // is recoverable and never reported as paid.
    await saveSettlement(onChainId, { released: true, forwarded: false, forwardTx: null });

    // Forward USDC to the actual user (releasePayment sends to relayer since relayer claimed).
    // Only a confirmed forward is reported as success.
    return await forwardPayout(onChainId, recipient, wallet, pub);
  } catch (err) {
    console.error(`[Escrow] Failed to release task ${onChainId}:`, err);
    return null;
  } finally {
    if (redis) await redis.del(lockKey).catch(() => {});
  }
}

// Retries only the USDC forward step for a task whose on-chain release already
// succeeded but whose forward failed. Never re-releases on-chain.
export async function retryForward(onChainId: number, recipientAddress?: string | null): Promise<string | null> {
  const wallet = getWalletClient();
  if (!wallet) {
    console.error("[Escrow] No signer key - cannot retry forward");
    return null;
  }
  if (!isValidRecipient(recipientAddress)) {
    console.error(`[Escrow] Task ${onChainId}: invalid recipient for forward retry`);
    return null;
  }
  const recipient = recipientAddress as `0x${string}`;

  const state = await loadSettlement(onChainId);
  if (!state || !state.released) {
    console.error(`[Escrow] Task ${onChainId}: no released settlement to retry forward`);
    return null;
  }
  if (state.forwarded && state.forwardTx) {
    return state.forwardTx;
  }
  return await forwardPayout(onChainId, recipient, wallet, getPublicClient());
}

// ── On-chain funding verification (server-side funding gate) ─────

export type OnChainTask = {
  agent: `0x${string}`;
  claimant: `0x${string}`;
  description: string;
  bounty: bigint;
  deadline: bigint;
  status: number;
};

export async function getEscrowTask(onChainId: number): Promise<OnChainTask | null> {
  try {
    const pub = getPublicClient();
    const t = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getTask",
      args: [BigInt(onChainId)],
    });
    return {
      agent: t.agent,
      claimant: t.claimant,
      description: t.description,
      bounty: t.bounty,
      deadline: t.deadline,
      status: Number(t.status),
    };
  } catch (err) {
    console.error(`[Escrow] Failed to read task ${onChainId}:`, err);
    return null;
  }
}

// Verifies on-chain that an escrow task exists and is funded (bounty deposited,
// status Open or Claimed). When expectedUsdc is provided, the on-chain bounty
// must cover it so a client cannot claim a larger bounty than was funded.
export async function isEscrowTaskFunded(onChainId: number, expectedUsdc?: number): Promise<boolean> {
  const t = await getEscrowTask(onChainId);
  if (!t) return false;
  if (t.bounty <= BigInt(0)) return false;
  if (t.status !== 0 && t.status !== 1) return false;
  if (expectedUsdc !== undefined && Number.isFinite(expectedUsdc)) {
    try {
      const expected = parseUnits(String(expectedUsdc), 6);
      if (t.bounty < expected) return false;
    } catch {
      // If we cannot parse the expected amount, fall back to the bounty>0 check above.
    }
  }
  return true;
}

export async function refundEscrow(onChainId: number): Promise<string | null> {
  const wallet = getWalletClient();
  if (!wallet) {
    console.error("[Escrow] No signer key — cannot refund");
    return null;
  }

  try {
    const pub = getPublicClient();

    const onChainTask = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getTask",
      args: [BigInt(onChainId)],
    });

    // Only refund tasks that are still Open (0) or Claimed (1)
    if (onChainTask.status !== 0 && onChainTask.status !== 1) {
      return null;
    }

    const hash = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "refund",
      args: [BigInt(onChainId)],
    });

    await pub.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    console.error(`[Escrow] Failed to refund task ${onChainId}:`, err);
    return null;
  }
}

export async function createEscrowTask(
  description: string,
  bountyUsdc: number,
  deadlineHours: number
): Promise<{ onChainId: number; txHash: string } | null> {
  const wallet = getWalletClient();
  if (!wallet) return null;

  const pub = getPublicClient();
  const bountyWei = parseUnits(bountyUsdc.toString(), 6);

  try {
    const balance = await pub.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.account.address],
    });

    if (balance < bountyWei) {
      console.error(`[Escrow] Insufficient USDC: have ${formatUnits(balance, 6)}, need ${bountyUsdc}`);
      return null;
    }

    const allowance = await pub.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [wallet.account.address, ESCROW_ADDRESS],
    });

    if (allowance < bountyWei) {
      const approveTx = await wallet.client.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ESCROW_ADDRESS, parseUnits("1000", 6)],
      });
      await pub.waitForTransactionReceipt({ hash: approveTx });
    }

    // V2: deposit first, then create task from balance
    const depositTx = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "deposit",
      args: [bountyWei],
    });
    await pub.waitForTransactionReceipt({ hash: depositTx });

    const countBefore = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "taskCount",
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);
    const txHash = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "createTask",
      args: [description, bountyWei, deadline],
    });

    await pub.waitForTransactionReceipt({ hash: txHash });

    return { onChainId: Number(countBefore), txHash };
  } catch (err) {
    console.error("[Escrow] Failed to create task:", err);
    return null;
  }
}

// ── Agent-funded escrow (uses agent's own wallet key) ───────────

export async function createEscrowTaskWithKey(
  privateKey: string,
  description: string,
  bountyUsdc: number,
  deadlineHours: number
): Promise<{ onChainId: number; txHash: string } | null> {
  const formattedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  const client = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });
  const pub = getPublicClient();
  const bountyWei = parseUnits(bountyUsdc.toString(), 6);

  try {
    const balance = await pub.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    if (balance < bountyWei) {
      console.error(`[Escrow] Agent wallet ${account.address} insufficient USDC: have ${formatUnits(balance, 6)}, need ${bountyUsdc}`);
      return null;
    }

    const allowance = await pub.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, ESCROW_ADDRESS],
    });

    if (allowance < bountyWei) {
      const approveTx = await client.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ESCROW_ADDRESS, parseUnits("1000", 6)],
      });
      await pub.waitForTransactionReceipt({ hash: approveTx });
    }

    // V2: deposit then create
    const depositTx = await client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "deposit",
      args: [bountyWei],
    });
    await pub.waitForTransactionReceipt({ hash: depositTx });

    const countBefore = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "taskCount",
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);
    const txHash = await client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "createTask",
      args: [description, bountyWei, deadline],
    });

    await pub.waitForTransactionReceipt({ hash: txHash });
    return { onChainId: Number(countBefore), txHash };
  } catch (err) {
    console.error("[Escrow] Agent-funded task failed:", err);
    return null;
  }
}

// ── Double-or-Nothing resolution ────────────────────────────────

const DON_ADDRESS = (process.env.NEXT_PUBLIC_DON_ADDRESS || "") as `0x${string}`;

const DON_RESOLVE_ABI = [
  {
    name: "resolve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_taskId", type: "uint256" },
      { name: "_verified", type: "bool" },
    ],
    outputs: [],
  },
] as const;

export async function resolveDon(donOnChainId: number, verified: boolean): Promise<string | null> {
  if (!DON_ADDRESS) return null;
  const wallet = getWalletClient();
  if (!wallet) {
    console.error("[DoN] No signer key — cannot resolve");
    return null;
  }

  try {
    const pub = getPublicClient();
    const hash = await wallet.client.writeContract({
      address: DON_ADDRESS,
      abi: DON_RESOLVE_ABI,
      functionName: "resolve",
      args: [BigInt(donOnChainId), verified],
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    console.error(`[DoN] Failed to resolve task ${donOnChainId}:`, err);
    return null;
  }
}

export async function getEscrowState(): Promise<{
  taskCount: number;
  escrowBalance: string;
  walletBalance: string;
  walletAddress: string | null;
}> {
  const pub = getPublicClient();
  const wallet = getWalletClient();

  const taskCount = await pub.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "taskCount",
  });

  const escrowBalance = await pub.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ESCROW_ADDRESS],
  });

  let walletBalance = BigInt(0);
  let walletAddress: string | null = null;
  if (wallet) {
    walletAddress = wallet.account.address;
    walletBalance = await pub.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet.account.address],
    });
  }

  return {
    taskCount: Number(taskCount),
    escrowBalance: formatUnits(escrowBalance, 6),
    walletBalance: formatUnits(walletBalance, 6),
    walletAddress,
  };
}
