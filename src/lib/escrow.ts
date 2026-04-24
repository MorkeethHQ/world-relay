import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0xc976e463bD209E09cb15a168A275890b872AA1F0") as `0x${string}`;

const ESCROW_ABI = [
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
        { name: "poster", type: "address" },
        { name: "claimant", type: "address" },
        { name: "description", type: "string" },
        { name: "bounty", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "status", type: "uint8" },
      ],
    }],
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
  return process.env.XMTP_WALLET_KEY || null;
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

export async function releaseEscrow(onChainId: number): Promise<string | null> {
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

    // Status 1 = Claimed (required for release)
    if (onChainTask.status !== 1) {
      console.log(`[Escrow] Task ${onChainId} status is ${onChainTask.status}, not Claimed (1) — skipping release`);
      return null;
    }

    if (onChainTask.poster.toLowerCase() !== wallet.account.address.toLowerCase()) {
      console.error(`[Escrow] Task ${onChainId} poster ${onChainTask.poster} !== signer ${wallet.account.address}`);
      return null;
    }

    const hash = await wallet.client.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "releasePayment",
      args: [BigInt(onChainId)],
    });

    await pub.waitForTransactionReceipt({ hash });
    console.log(`[Escrow] Released payment for task ${onChainId}: ${hash}`);
    return hash;
  } catch (err) {
    console.error(`[Escrow] Failed to release task ${onChainId}:`, err);
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
    // Check USDC balance
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

    // Check allowance, approve if needed
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
        args: [ESCROW_ADDRESS, parseUnits("100", 6)],
      });
      await pub.waitForTransactionReceipt({ hash: approveTx });
      console.log(`[Escrow] USDC approved: ${approveTx}`);
    }

    // Read current count to know our task ID
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
    console.log(`[Escrow] Task created on-chain: ID=${Number(countBefore)}, TX=${txHash}`);

    return { onChainId: Number(countBefore), txHash };
  } catch (err) {
    console.error("[Escrow] Failed to create task:", err);
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
