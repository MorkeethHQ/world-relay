import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { getRedis } from "./redis";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

// UMA OptimisticOracleV3 — deployed on World Chain or via cross-chain bridge
// If not yet on World Chain, set this env var to the deployed address
export const UMA_ORACLE_ADDRESS = (process.env.NEXT_PUBLIC_UMA_ORACLE_ADDRESS || "") as `0x${string}`;
export const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;

const DEFAULT_BOND = parseUnits("5", 6); // 5 USDC bond
const CHALLENGE_WINDOW = 7200; // 2 hours in seconds
const DEFAULT_IDENTIFIER = "0x4153534552545f5452555448000000000000000000000000000000000000000000" as Hex; // ASSERT_TRUTH

const OO_V3_ABI = [
  {
    name: "assertTruth",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claim", type: "bytes" },
      { name: "asserter", type: "address" },
      { name: "callbackRecipient", type: "address" },
      { name: "sovereignSecurity", type: "address" },
      { name: "liveness", type: "uint64" },
      { name: "currency", type: "address" },
      { name: "bond", type: "uint256" },
      { name: "identifier", type: "bytes32" },
      { name: "domainId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "disputeAssertion",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assertionId", type: "bytes32" },
      { name: "disputer", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "settleAssertion",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "assertionId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getAssertion",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assertionId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "escalationManagerSettings", type: "tuple", components: [
            { name: "arbitrateViaEscalationManager", type: "bool" },
            { name: "discardOracle", type: "bool" },
            { name: "validateDisputers", type: "bool" },
            { name: "assertingCaller", type: "address" },
            { name: "escalationManager", type: "address" },
          ]},
          { name: "asserter", type: "address" },
          { name: "expirationTime", type: "uint64" },
          { name: "settled", type: "bool" },
          { name: "currency", type: "address" },
          { name: "domainId", type: "bytes32" },
          { name: "identifier", type: "bytes32" },
          { name: "bond", type: "uint256" },
          { name: "callbackRecipient", type: "address" },
          { name: "disputer", type: "address" },
          { name: "settlementResolution", type: "bool" },
        ],
      },
    ],
  },
] as const;

export type UmaDisputeState = {
  assertionId: string;
  taskId: string;
  status: "asserted" | "disputed" | "settled_true" | "settled_false" | "expired";
  asserter: string;
  disputer: string | null;
  bondUsdc: number;
  expirationTime: number;
  createdAt: string;
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

export function isUmaEnabled(): boolean {
  return !!UMA_ORACLE_ADDRESS && UMA_ORACLE_ADDRESS.length > 2;
}

export async function assertTaskCompletion(
  taskId: string,
  description: string,
  claimantAddress: string,
): Promise<{ assertionId: string; txHash: string } | null> {
  if (!isUmaEnabled()) return null;
  const wallet = getWalletClient();
  if (!wallet) return null;

  try {
    const pub = getPublicClient();
    const claim = new TextEncoder().encode(
      `RELAY task ${taskId} was completed: "${description.slice(0, 100)}"`
    );

    const hash = await wallet.client.writeContract({
      address: UMA_ORACLE_ADDRESS,
      abi: OO_V3_ABI,
      functionName: "assertTruth",
      args: [
        `0x${Buffer.from(claim).toString("hex")}` as Hex,
        claimantAddress as `0x${string}`,
        wallet.account.address, // callback recipient
        "0x0000000000000000000000000000000000000000" as `0x${string}`, // no sovereign security
        BigInt(CHALLENGE_WINDOW),
        USDC_ADDRESS,
        DEFAULT_BOND,
        DEFAULT_IDENTIFIER,
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      ],
    });

    const receipt = await pub.waitForTransactionReceipt({ hash });

    // Extract assertionId from logs (first topic of AssertionMade event)
    const assertionId = receipt.logs[0]?.topics?.[1] || hash;

    const state: UmaDisputeState = {
      assertionId: assertionId as string,
      taskId,
      status: "asserted",
      asserter: claimantAddress,
      disputer: null,
      bondUsdc: 5,
      expirationTime: Math.floor(Date.now() / 1000) + CHALLENGE_WINDOW,
      createdAt: new Date().toISOString(),
    };

    const redis = getRedis();
    if (redis) {
      await redis.set(`uma:${taskId}`, JSON.stringify(state));
    }

    return { assertionId: assertionId as string, txHash: hash };
  } catch (err) {
    console.error("[UMA] Failed to assert:", err);
    return null;
  }
}

export async function disputeTaskAssertion(
  taskId: string,
  disputerAddress: string,
): Promise<{ txHash: string } | null> {
  if (!isUmaEnabled()) return null;
  const wallet = getWalletClient();
  if (!wallet) return null;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(`uma:${taskId}`);
    if (!raw) return null;
    const state: UmaDisputeState = typeof raw === "string" ? JSON.parse(raw) : (raw as UmaDisputeState);

    if (state.status !== "asserted") return null;

    const pub = getPublicClient();
    const hash = await wallet.client.writeContract({
      address: UMA_ORACLE_ADDRESS,
      abi: OO_V3_ABI,
      functionName: "disputeAssertion",
      args: [
        state.assertionId as Hex,
        disputerAddress as `0x${string}`,
      ],
    });

    await pub.waitForTransactionReceipt({ hash });

    state.status = "disputed";
    state.disputer = disputerAddress;
    await redis.set(`uma:${taskId}`, JSON.stringify(state));

    return { txHash: hash };
  } catch (err) {
    console.error("[UMA] Failed to dispute:", err);
    return null;
  }
}

export async function settleTaskAssertion(
  taskId: string,
): Promise<{ txHash: string; resolution: boolean } | null> {
  if (!isUmaEnabled()) return null;
  const wallet = getWalletClient();
  if (!wallet) return null;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(`uma:${taskId}`);
    if (!raw) return null;
    const state: UmaDisputeState = typeof raw === "string" ? JSON.parse(raw) : (raw as UmaDisputeState);

    const pub = getPublicClient();
    const hash = await wallet.client.writeContract({
      address: UMA_ORACLE_ADDRESS,
      abi: OO_V3_ABI,
      functionName: "settleAssertion",
      args: [state.assertionId as Hex],
    });

    await pub.waitForTransactionReceipt({ hash });

    // Read the resolved assertion
    const assertion = await pub.readContract({
      address: UMA_ORACLE_ADDRESS,
      abi: OO_V3_ABI,
      functionName: "getAssertion",
      args: [state.assertionId as Hex],
    });

    const resolution = assertion.settlementResolution;
    state.status = resolution ? "settled_true" : "settled_false";
    await redis.set(`uma:${taskId}`, JSON.stringify(state));

    return { txHash: hash, resolution };
  } catch (err) {
    console.error("[UMA] Failed to settle:", err);
    return null;
  }
}

export async function getUmaDisputeState(taskId: string): Promise<UmaDisputeState | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(`uma:${taskId}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : (raw as UmaDisputeState);
  } catch {
    return null;
  }
}

// Encode functions for frontend MiniKit transactions
export function encodeAssertTruth(taskId: string, description: string, asserterAddress: `0x${string}`) {
  if (!isUmaEnabled()) return null;

  const claim = new TextEncoder().encode(
    `RELAY task ${taskId} was completed: "${description.slice(0, 100)}"`
  );

  const data = encodeFunctionData({
    abi: OO_V3_ABI,
    functionName: "assertTruth",
    args: [
      `0x${Buffer.from(claim).toString("hex")}` as Hex,
      asserterAddress,
      asserterAddress,
      "0x0000000000000000000000000000000000000000" as `0x${string}`,
      BigInt(CHALLENGE_WINDOW),
      USDC_ADDRESS,
      DEFAULT_BOND,
      DEFAULT_IDENTIFIER,
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    ],
  });

  return { chainId: 480, transactions: [{ to: UMA_ORACLE_ADDRESS, data }] };
}

export function encodeDisputeAssertion(assertionId: Hex, disputerAddress: `0x${string}`) {
  if (!isUmaEnabled()) return null;

  const data = encodeFunctionData({
    abi: OO_V3_ABI,
    functionName: "disputeAssertion",
    args: [assertionId, disputerAddress],
  });

  return { chainId: 480, transactions: [{ to: UMA_ORACLE_ADDRESS, data }] };
}
