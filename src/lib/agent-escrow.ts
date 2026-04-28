import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export const AGENT_ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_AGENT_ESCROW_ADDRESS || "") as `0x${string}`;
export const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;

const AGENT_ESCROW_ABI = [
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
    name: "releasePayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAgentStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_agent", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "deposited", type: "uint256" },
      { name: "spent", type: "uint256" },
    ],
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
    outputs: [
      {
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
      },
    ],
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

export function isAgentEscrowEnabled(): boolean {
  return !!AGENT_ESCROW_ADDRESS && AGENT_ESCROW_ADDRESS.length > 2;
}

function getPublicClient() {
  return createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
}

function getRelayerClient() {
  const key = process.env.XMTP_WALLET_KEY || process.env.RP_SIGNING_KEY;
  if (!key) return null;
  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  return { client: createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) }), account };
}

// ─── Read Operations ────────────────────────────────────────────────

export async function getAgentBalance(agentAddress: `0x${string}`): Promise<{
  balance: string;
  deposited: string;
  spent: string;
} | null> {
  if (!isAgentEscrowEnabled()) return null;

  try {
    const pub = getPublicClient();
    const stats = await pub.readContract({
      address: AGENT_ESCROW_ADDRESS,
      abi: AGENT_ESCROW_ABI,
      functionName: "getAgentStats",
      args: [agentAddress],
    });

    return {
      balance: formatUnits(stats[0], 6),
      deposited: formatUnits(stats[1], 6),
      spent: formatUnits(stats[2], 6),
    };
  } catch (err) {
    console.error("[AgentEscrow] Failed to read balance:", err);
    return null;
  }
}

// ─── Write Operations (Relayer) ─────────────────────────────────────

export async function createAgentTask(
  agentAddress: `0x${string}`,
  description: string,
  bountyUsdc: number,
  deadlineHours: number,
): Promise<{ onChainId: number; txHash: string } | null> {
  if (!isAgentEscrowEnabled()) return null;
  const relayer = getRelayerClient();
  if (!relayer) return null;

  try {
    const pub = getPublicClient();
    const bountyWei = parseUnits(bountyUsdc.toString(), 6);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);

    // Check agent has enough balance
    const balance = await pub.readContract({
      address: AGENT_ESCROW_ADDRESS,
      abi: AGENT_ESCROW_ABI,
      functionName: "balances",
      args: [agentAddress],
    });

    if (balance < bountyWei) {
      console.error(`[AgentEscrow] Insufficient balance: have ${formatUnits(balance, 6)}, need ${bountyUsdc}`);
      return null;
    }

    const countBefore = await pub.readContract({
      address: AGENT_ESCROW_ADDRESS,
      abi: AGENT_ESCROW_ABI,
      functionName: "taskCount",
    });

    const hash = await relayer.client.writeContract({
      address: AGENT_ESCROW_ADDRESS,
      abi: AGENT_ESCROW_ABI,
      functionName: "createTaskFor",
      args: [agentAddress, description, bountyWei, deadline],
    });

    await pub.waitForTransactionReceipt({ hash });
    return { onChainId: Number(countBefore), txHash: hash };
  } catch (err) {
    console.error("[AgentEscrow] Failed to create task:", err);
    return null;
  }
}

export async function releaseAgentTask(onChainId: number): Promise<string | null> {
  if (!isAgentEscrowEnabled()) return null;
  const relayer = getRelayerClient();
  if (!relayer) return null;

  try {
    const pub = getPublicClient();
    const hash = await relayer.client.writeContract({
      address: AGENT_ESCROW_ADDRESS,
      abi: AGENT_ESCROW_ABI,
      functionName: "releasePayment",
      args: [BigInt(onChainId)],
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    console.error("[AgentEscrow] Failed to release:", err);
    return null;
  }
}

// ─── Encode for Frontend (MiniKit) ─────────────────────────────────

export function encodeAgentDeposit(amountUsdc: number) {
  if (!isAgentEscrowEnabled()) return null;
  const amount = parseUnits(amountUsdc.toString(), 6);

  const approveData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [AGENT_ESCROW_ADDRESS, amount],
  });

  const depositData = encodeFunctionData({
    abi: AGENT_ESCROW_ABI,
    functionName: "deposit",
    args: [amount],
  });

  return {
    chainId: 480,
    transactions: [
      { to: USDC_ADDRESS, data: approveData },
      { to: AGENT_ESCROW_ADDRESS, data: depositData },
    ],
  };
}

export function encodeAgentWithdraw(amountUsdc: number) {
  if (!isAgentEscrowEnabled()) return null;
  const amount = parseUnits(amountUsdc.toString(), 6);

  const data = encodeFunctionData({
    abi: AGENT_ESCROW_ABI,
    functionName: "withdraw",
    args: [amount],
  });

  return {
    chainId: 480,
    transactions: [{ to: AGENT_ESCROW_ADDRESS, data }],
  };
}
