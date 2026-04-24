import { encodeFunctionData, parseUnits } from "viem";

export const WORLD_CHAIN_ID = 480;

// These get set after contract deployment
export const RELAY_ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
export const USDC_ADDRESS = "0x79A02482A880bCE3B13e43E0095E7a95D44b78d2" as const; // USDC on World Chain
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

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
    args: [USDC_ADDRESS, RELAY_ESCROW_ADDRESS, BigInt(bountyWei), 0],
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
