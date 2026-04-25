import { encodeFunctionData, parseUnits, createPublicClient, http } from "viem";
import { worldchain } from "viem/chains";

export const WORLD_CHAIN_ID = 480;

// These get set after contract deployment
export const RELAY_ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
export const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;
export const WLD_ADDRESS = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as const;
export const SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as const;

export type SwapToken = "USDC" | "WETH" | "WLD";

const TOKEN_ADDRESSES: Record<SwapToken, `0x${string}`> = {
  USDC: USDC_ADDRESS,
  WETH: WETH_ADDRESS,
  WLD: WLD_ADDRESS,
};

const TOKEN_DECIMALS: Record<SwapToken, number> = {
  USDC: 6,
  WETH: 18,
  WLD: 18,
};

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
] as const;

const PERMIT2_ABI = [
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

export function encodeCreateTask(description: string, bountyUsdc: number, deadlineHours: number) {
  if (!RELAY_ESCROW_ADDRESS) return null;

  const bountyWei = parseUnits(bountyUsdc.toString(), 6);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);

  const approveData = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [USDC_ADDRESS, RELAY_ESCROW_ADDRESS, BigInt(bountyWei), Math.floor(Date.now() / 1000) + 86400],
  });

  const createData = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "createTask",
    args: [description, bountyWei, deadline],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      { to: PERMIT2_ADDRESS, data: approveData },
      { to: RELAY_ESCROW_ADDRESS, data: createData },
    ],
  };
}

export function encodeClaimTask(taskId: number) {
  if (!RELAY_ESCROW_ADDRESS) return null;

  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "claimTask",
    args: [BigInt(taskId)],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [{ to: RELAY_ESCROW_ADDRESS, data }],
  };
}

export function encodeReleasePayment(taskId: number) {
  if (!RELAY_ESCROW_ADDRESS) return null;

  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: "releasePayment",
    args: [BigInt(taskId)],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [{ to: RELAY_ESCROW_ADDRESS, data }],
  };
}

// Uniswap V3 SwapRouter02 exactInputSingle
const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
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
] as const;

export function encodeUniswapSwap(
  amountUsdc: number,
  toToken: SwapToken,
  recipientAddress: `0x${string}`
) {
  if (toToken === "USDC") return null;

  const amountIn = parseUnits(amountUsdc.toString(), 6);

  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [SWAP_ROUTER_ADDRESS, amountIn],
  });

  const swapData = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDC_ADDRESS,
        tokenOut: TOKEN_ADDRESSES[toToken],
        fee: 3000, // 0.3% pool
        recipient: recipientAddress,
        amountIn,
        amountOutMinimum: BigInt(0), // accept any amount for demo
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      { to: USDC_ADDRESS, data: approveData },
      { to: SWAP_ROUTER_ADDRESS, data: swapData },
    ],
  };
}

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export async function readTaskCount(): Promise<number> {
  if (!RELAY_ESCROW_ADDRESS) return 0;
  const client = createPublicClient({
    chain: worldchain,
    transport: http(RPC_URL),
  });
  const count = await client.readContract({
    address: RELAY_ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "taskCount",
  });
  return Number(count);
}

// ── Double-or-Nothing contract ──────────────────────────────────

export const DOUBLE_OR_NOTHING_ADDRESS = process.env.NEXT_PUBLIC_DON_ADDRESS as `0x${string}` | undefined;

const DON_ABI = [
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
    name: "stakeAndClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [],
  },
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
  {
    name: "taskCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function encodeCreateDoubleOrNothing(description: string, bountyUsdc: number, deadlineHours: number) {
  if (!DOUBLE_OR_NOTHING_ADDRESS) return null;

  const bountyWei = parseUnits(bountyUsdc.toString(), 6);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);

  const approveData = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [USDC_ADDRESS, DOUBLE_OR_NOTHING_ADDRESS, BigInt(bountyWei), Math.floor(Date.now() / 1000) + 86400],
  });

  const createData = encodeFunctionData({
    abi: DON_ABI,
    functionName: "createTask",
    args: [description, bountyWei, deadline],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      { to: PERMIT2_ADDRESS, data: approveData },
      { to: DOUBLE_OR_NOTHING_ADDRESS, data: createData },
    ],
  };
}

export function encodeStakeAndClaim(taskId: number) {
  if (!DOUBLE_OR_NOTHING_ADDRESS) return null;

  // Runner needs to approve USDC spend for matching stake
  // The amount equals the task bounty — read from chain or passed in
  const stakeData = encodeFunctionData({
    abi: DON_ABI,
    functionName: "stakeAndClaim",
    args: [BigInt(taskId)],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [{ to: DOUBLE_OR_NOTHING_ADDRESS, data: stakeData }],
  };
}

export function encodeStakeAndClaimWithApproval(taskId: number, bountyUsdc: number) {
  if (!DOUBLE_OR_NOTHING_ADDRESS) return null;

  const stakeWei = parseUnits(bountyUsdc.toString(), 6);

  const approveData = encodeFunctionData({
    abi: PERMIT2_ABI,
    functionName: "approve",
    args: [USDC_ADDRESS, DOUBLE_OR_NOTHING_ADDRESS, BigInt(stakeWei), Math.floor(Date.now() / 1000) + 86400],
  });

  const stakeData = encodeFunctionData({
    abi: DON_ABI,
    functionName: "stakeAndClaim",
    args: [BigInt(taskId)],
  });

  return {
    chainId: WORLD_CHAIN_ID,
    transactions: [
      { to: PERMIT2_ADDRESS, data: approveData },
      { to: DOUBLE_OR_NOTHING_ADDRESS, data: stakeData },
    ],
  };
}

export async function readDonTaskCount(): Promise<number> {
  if (!DOUBLE_OR_NOTHING_ADDRESS) return 0;
  const client = createPublicClient({
    chain: worldchain,
    transport: http(RPC_URL),
  });
  const count = await client.readContract({
    address: DOUBLE_OR_NOTHING_ADDRESS,
    abi: DON_ABI,
    functionName: "taskCount",
  });
  return Number(count);
}

export { TOKEN_ADDRESSES, TOKEN_DECIMALS };
