import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS?.trim() || "0xc976e463bD209E09cb15a168A275890b872AA1F0") as `0x${string}`;
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as `0x${string}`;

const STATUS_LABELS = ["open", "claimed", "completed", "failed", "expired"] as const;

const ESCROW_ABI = [
  { name: "taskCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    name: "getTask", type: "function", stateMutability: "view",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "poster", type: "address" },
      { name: "claimant", type: "address" },
      { name: "description", type: "string" },
      { name: "bounty", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "status", type: "uint8" },
    ]}],
  },
] as const;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 30_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });

    const [taskCount, escrowBalance] = await Promise.all([
      pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" }),
      pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [ESCROW_ADDRESS] }),
    ]);

    let totalDeposited = BigInt(0);
    let paidOut = BigInt(0);
    let openLocked = BigInt(0);
    const tasks: { id: number; bounty: string; status: string; description: string; claimant: string }[] = [];

    for (let i = 0; i < Number(taskCount); i++) {
      const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
      const bounty = task.bounty;
      const status = STATUS_LABELS[task.status] || "unknown";
      totalDeposited = totalDeposited + bounty;
      if (task.status === 2) paidOut = paidOut + bounty;
      if (task.status === 0 || task.status === 1) openLocked = openLocked + bounty;

      tasks.push({
        id: i,
        bounty: formatUnits(bounty, 6),
        status,
        description: task.description.slice(0, 80),
        claimant: task.claimant === "0x0000000000000000000000000000000000000000" ? "" : task.claimant,
      });
    }

    const data = {
      escrowAddress: ESCROW_ADDRESS,
      taskCount: Number(taskCount),
      escrowBalance: formatUnits(escrowBalance, 6),
      totalDeposited: formatUnits(totalDeposited, 6),
      paidOut: formatUnits(paidOut, 6),
      openLocked: formatUnits(openLocked, 6),
      completedCount: tasks.filter(t => t.status === "completed").length,
      claimants: [...new Set(tasks.filter(t => t.claimant).map(t => t.claimant))].length,
      tasks,
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
