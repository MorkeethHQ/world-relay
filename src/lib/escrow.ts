import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

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

export async function releaseEscrow(onChainId: number, recipientAddress?: string | null): Promise<string | null> {
  const wallet = getWalletClient();
  if (!wallet) {
    console.error("[Escrow] No signer key — cannot release payment");
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

    // Task must be Open or Claimed to proceed
    if (onChainTask.status !== 0 && onChainTask.status !== 1) {
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
      await pub.waitForTransactionReceipt({ hash: claimHash });
    }

    const bountyAmount = onChainTask.bounty;

    const hash = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "releasePayment",
      args: [BigInt(onChainId)],
    });

    await pub.waitForTransactionReceipt({ hash });

    // Forward USDC to the actual user (releasePayment sends to relayer since relayer claimed)
    if (recipientAddress && recipientAddress.startsWith("0x") && recipientAddress.length === 42) {
      const feeRate = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "feeRate" });
      const communityRate = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "communityRate" });
      const payout = bountyAmount - (bountyAmount * feeRate) / BigInt(10000) - (bountyAmount * communityRate) / BigInt(10000);

      const transferHash = await wallet.client.writeContract({
        address: USDC_ADDRESS,
        abi: [{
          name: "transfer",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
          outputs: [{ name: "", type: "bool" }],
        }],
        functionName: "transfer",
        args: [recipientAddress as `0x${string}`, payout],
      });
      await pub.waitForTransactionReceipt({ hash: transferHash });
      return transferHash;
    }

    return hash;
  } catch (err) {
    console.error(`[Escrow] Failed to release task ${onChainId}:`, err);
    return null;
  }
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
