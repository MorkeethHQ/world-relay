import { createPublicClient, createWalletClient, http, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

// Chainlink Automation Registry on World Chain
// Set via env var once deployed or Chainlink supports World Chain
export const AUTOMATION_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_CHAINLINK_REGISTRY || "") as `0x${string}`;
export const CHAINLINK_FORWARDER_ADDRESS = (process.env.NEXT_PUBLIC_CHAINLINK_FORWARDER || "") as `0x${string}`;

// RelayAutomation contract — implements Chainlink AutomationCompatible
// Checks for expired tasks and calls refund() on the escrow
const RELAY_AUTOMATION_ABI = [
  {
    name: "checkUpkeep",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "checkData", type: "bytes" }],
    outputs: [
      { name: "upkeepNeeded", type: "bool" },
      { name: "performData", type: "bytes" },
    ],
  },
  {
    name: "performUpkeep",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "performData", type: "bytes" }],
    outputs: [],
  },
  {
    name: "getExpiredTaskIds",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "lastPerformTime",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Chainlink Functions Router — for off-chain AI verification
export const FUNCTIONS_ROUTER_ADDRESS = (process.env.NEXT_PUBLIC_CHAINLINK_FUNCTIONS_ROUTER || "") as `0x${string}`;

const FUNCTIONS_CONSUMER_ABI = [
  {
    name: "sendRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "source", type: "string" },
      { name: "encryptedSecretsUrls", type: "bytes" },
      { name: "donHostedSecretsSlotID", type: "uint8" },
      { name: "donHostedSecretsVersion", type: "uint64" },
      { name: "args", type: "string[]" },
      { name: "bytesArgs", type: "bytes[]" },
      { name: "subscriptionId", type: "uint64" },
      { name: "gasLimit", type: "uint32" },
      { name: "donID", type: "bytes32" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    name: "getLatestResponse",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "response", type: "bytes" },
      { name: "err", type: "bytes" },
    ],
  },
] as const;

export type AutomationStatus = {
  enabled: boolean;
  lastRunTimestamp: number | null;
  expiredTaskIds: number[];
  registryAddress: string | null;
};

export type ChainlinkVerificationRequest = {
  taskId: string;
  description: string;
  proofImageHash: string;
  requestId: string | null;
};

function getPublicClient() {
  return createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
}

function getWalletClient() {
  const key = process.env.XMTP_WALLET_KEY || process.env.RP_SIGNING_KEY;
  if (!key) return null;
  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  return { client: createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) }), account };
}

export function isAutomationEnabled(): boolean {
  return !!AUTOMATION_REGISTRY_ADDRESS && AUTOMATION_REGISTRY_ADDRESS.length > 2;
}

export function isFunctionsEnabled(): boolean {
  return !!FUNCTIONS_ROUTER_ADDRESS && FUNCTIONS_ROUTER_ADDRESS.length > 2;
}

// Check which tasks need automated expiry/refund
export async function checkExpiredTasks(automationContractAddress: `0x${string}`): Promise<AutomationStatus> {
  if (!isAutomationEnabled()) {
    return { enabled: false, lastRunTimestamp: null, expiredTaskIds: [], registryAddress: null };
  }

  try {
    const pub = getPublicClient();

    const [expiredIds, lastTime] = await Promise.all([
      pub.readContract({
        address: automationContractAddress,
        abi: RELAY_AUTOMATION_ABI,
        functionName: "getExpiredTaskIds",
      }),
      pub.readContract({
        address: automationContractAddress,
        abi: RELAY_AUTOMATION_ABI,
        functionName: "lastPerformTime",
      }),
    ]);

    return {
      enabled: true,
      lastRunTimestamp: Number(lastTime),
      expiredTaskIds: expiredIds.map(Number),
      registryAddress: AUTOMATION_REGISTRY_ADDRESS,
    };
  } catch (err) {
    console.error("[Chainlink] Failed to check automation status:", err);
    return { enabled: false, lastRunTimestamp: null, expiredTaskIds: [], registryAddress: null };
  }
}

// Manually trigger performUpkeep (fallback if Chainlink isn't running)
export async function manualPerformUpkeep(
  automationContractAddress: `0x${string}`,
  performData: Hex,
): Promise<string | null> {
  const wallet = getWalletClient();
  if (!wallet) return null;

  try {
    const pub = getPublicClient();
    const hash = await wallet.client.writeContract({
      address: automationContractAddress,
      abi: RELAY_AUTOMATION_ABI,
      functionName: "performUpkeep",
      args: [performData],
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    console.error("[Chainlink] Manual upkeep failed:", err);
    return null;
  }
}

// Chainlink Functions: request AI verification on-chain
const VERIFICATION_SOURCE = `
const taskId = args[0];
const description = args[1];
const proofHash = args[2];
const apiUrl = secrets.RELAY_API_URL || "https://world-relay.vercel.app";

const response = await Functions.makeHttpRequest({
  url: apiUrl + "/api/verify-proof",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  data: { taskId, proofNote: "Chainlink Functions verification request", submitter: "chainlink" }
});

if (response.error) throw Error("Verification request failed");
const verdict = response.data.verification.verdict;
const confidence = Math.round(response.data.verification.confidence * 100);
return Functions.encodeString(verdict + ":" + confidence);
`;

export async function requestChainlinkVerification(
  functionsConsumerAddress: `0x${string}`,
  taskId: string,
  description: string,
  proofImageHash: string,
  subscriptionId: number,
  donId: Hex,
): Promise<ChainlinkVerificationRequest> {
  if (!isFunctionsEnabled()) {
    return { taskId, description, proofImageHash, requestId: null };
  }

  const wallet = getWalletClient();
  if (!wallet) {
    return { taskId, description, proofImageHash, requestId: null };
  }

  try {
    const pub = getPublicClient();
    const hash = await wallet.client.writeContract({
      address: functionsConsumerAddress,
      abi: FUNCTIONS_CONSUMER_ABI,
      functionName: "sendRequest",
      args: [
        VERIFICATION_SOURCE,
        "0x" as Hex, // no encrypted secrets URL
        0, // slot ID
        BigInt(0), // version
        [taskId, description.slice(0, 200), proofImageHash],
        [],
        BigInt(subscriptionId),
        300000, // gas limit
        donId,
      ],
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });
    const requestId = receipt.logs[0]?.topics?.[1] || null;

    return { taskId, description, proofImageHash, requestId: requestId as string | null };
  } catch (err) {
    console.error("[Chainlink Functions] Request failed:", err);
    return { taskId, description, proofImageHash, requestId: null };
  }
}

// Encode for frontend MiniKit: register automation upkeep
export function encodeRegisterUpkeep(
  name: string,
  automationContractAddress: `0x${string}`,
  gasLimit: number = 500000,
) {
  if (!isAutomationEnabled()) return null;

  const REGISTRY_ABI = [
    {
      name: "registerUpkeep",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "name", type: "string" },
            { name: "encryptedEmail", type: "bytes" },
            { name: "upkeepContract", type: "address" },
            { name: "gasLimit", type: "uint32" },
            { name: "adminAddress", type: "address" },
            { name: "triggerType", type: "uint8" },
            { name: "checkData", type: "bytes" },
            { name: "triggerConfig", type: "bytes" },
            { name: "offchainConfig", type: "bytes" },
          ],
        },
        { name: "amount", type: "uint96" },
      ],
      outputs: [{ name: "upkeepID", type: "uint256" }],
    },
  ] as const;

  const data = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "registerUpkeep",
    args: [
      {
        name,
        encryptedEmail: "0x" as Hex,
        upkeepContract: automationContractAddress,
        gasLimit,
        adminAddress: automationContractAddress,
        triggerType: 0, // condition-based
        checkData: "0x" as Hex,
        triggerConfig: "0x" as Hex,
        offchainConfig: "0x" as Hex,
      },
      BigInt(0),
    ],
  });

  return { chainId: 480, transactions: [{ to: AUTOMATION_REGISTRY_ADDRESS, data }] };
}
