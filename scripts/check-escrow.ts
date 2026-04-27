import { createPublicClient, http, formatUnits } from "viem";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0" as `0x${string}`;
const WALLET = "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e" as `0x${string}`;

const STATUS_LABELS = ["Open", "Claimed", "Completed", "Failed", "Expired"];

const ESCROW_ABI = [
  { name: "taskCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
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
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function main() {
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });

  const taskCount = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" });
  const escrowBalance = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [ESCROW_ADDRESS] });
  const walletBalance = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [WALLET] });

  console.log(`On-chain tasks: ${taskCount}`);
  console.log(`USDC in escrow contract: $${formatUnits(escrowBalance, 6)}`);
  console.log(`USDC in wallet: $${formatUnits(walletBalance, 6)}`);
  console.log(`Total accounted: $${formatUnits(escrowBalance + walletBalance, 6)}\n`);

  let totalDeposited = 0n;
  let openBounty = 0n;
  let paidOut = 0n;
  let expired = 0n;

  for (let i = 0; i < Number(taskCount); i++) {
    const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    const { description, bounty, deadline, status } = task;
    const bountyStr = formatUnits(bounty, 6);
    const deadlineDate = new Date(Number(deadline) * 1000);
    const isExpired = deadlineDate < new Date() && status === 0;
    const statusLabel = STATUS_LABELS[status] || `Unknown(${status})`;

    totalDeposited += bounty;
    if (status === 0) openBounty += bounty;
    if (status === 2) paidOut += bounty;
    if (status === 4) expired += bounty;

    console.log(`#${String(i).padStart(2, " ")}  $${bountyStr.padStart(6)}  ${statusLabel.padEnd(10)}${isExpired ? " EXPIRED" : ""}  "${description.slice(0, 65)}"`);
  }

  console.log(`\n--- BREAKDOWN ---`);
  console.log(`Total ever deposited:  $${formatUnits(totalDeposited, 6)}`);
  console.log(`Still open (locked):   $${formatUnits(openBounty, 6)}`);
  console.log(`Paid out to claimants: $${formatUnits(paidOut, 6)}`);
  console.log(`Expired (refundable):  $${formatUnits(expired, 6)}`);
  console.log(`Escrow balance now:    $${formatUnits(escrowBalance, 6)}`);
  console.log(`Wallet balance now:    $${formatUnits(walletBalance, 6)}`);
}

main().catch(console.error);
