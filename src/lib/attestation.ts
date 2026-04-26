import { createWalletClient, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

export type AttestationData = {
  taskId: string;
  taskDescriptionHash: string;
  proofImageHash: string;
  verdict: "pass" | "flag" | "fail";
  confidence: number;
  timestamp: number;
};

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function postAttestation(
  taskId: string,
  taskDescription: string,
  proofImageHash: string,
  verdict: "pass" | "flag" | "fail",
  confidence: number
): Promise<string | null> {
  const privateKey = process.env.RP_SIGNING_KEY;
  if (!privateKey) {
    return null;
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const attestation: AttestationData = {
      taskId,
      taskDescriptionHash: await sha256Hex(taskDescription),
      proofImageHash: await sha256Hex(proofImageHash.slice(0, 100)),
      verdict,
      confidence,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const payload = JSON.stringify({
      protocol: "relay-attestation-v1",
      ...attestation,
    });

    const client = createWalletClient({
      account,
      chain: worldchain,
      transport: http(RPC_URL),
    });

    // Self-send with attestation data as calldata
    const hash = await client.sendTransaction({
      to: account.address,
      value: BigInt(0),
      data: toHex(payload) as Hex,
    });

    return hash;
  } catch (err) {
    console.error("[Attestation] Failed:", err);
    return null;
  }
}
