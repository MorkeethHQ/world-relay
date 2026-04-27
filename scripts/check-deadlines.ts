import { createPublicClient, http, formatUnits } from "viem";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0" as `0x${string}`;

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

async function main() {
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const taskCount = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" });
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < Number(taskCount); i++) {
    const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    const deadline = Number(task.deadline);
    const hoursLeft = ((deadline - now) / 3600).toFixed(1);
    const date = new Date(deadline * 1000).toISOString();
    const expired = deadline < now;
    console.log(`#${String(i).padStart(2)} $${formatUnits(task.bounty, 6).padStart(6)} | ${expired ? "EXPIRED" : `${hoursLeft}h left`} | deadline: ${date} | "${task.description.slice(0, 45)}"`);
  }
}

main().catch(console.error);
