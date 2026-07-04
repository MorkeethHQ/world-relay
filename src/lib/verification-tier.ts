import { getRedis } from "./redis";

// Verification-tier gate for FUNDED (real-USDC) tasks. Higher bounties require a
// stronger World ID tier. Points tasks are NOT gated here — a points value is not
// dollars, so gating a "10 points" task as if it were $10 wrongly locks out
// wallet-level humans. Callers must only invoke this for escrow-funded tasks.

export const VERIFICATION_TIERS: Record<string, number> = {
  orb: 3,
  device: 2,
  wallet: 1,
  dev: 0,
};

export function requiredTier(bountyUsdc: number): { level: string; rank: number } {
  if (bountyUsdc >= 20) return { level: "orb", rank: 3 };
  if (bountyUsdc >= 10) return { level: "device", rank: 2 };
  return { level: "wallet", rank: 1 };
}

export async function getUserVerificationLevel(address: string): Promise<string> {
  const redis = getRedis();
  if (!redis) return "wallet";
  try {
    const raw = await redis.get(`verified:${address}`);
    if (!raw) return "wallet";
    const data = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);
    return (data.verificationLevel as string) || "wallet";
  } catch (err) {
    console.error(`[Tier] Failed to read verification level for ${address}:`, err);
    return "wallet";
  }
}

// Returns an error object to reject with, or null if the claimant meets the tier
// required by the bounty. dev_ accounts are handled by callers (blocked from
// funded tasks separately).
export async function tierGateError(
  claimant: string,
  bountyUsdc: number,
): Promise<{ required: string; current: string } | null> {
  if (claimant.startsWith("dev_")) return null;
  const userLevel = await getUserVerificationLevel(claimant);
  const userRank = VERIFICATION_TIERS[userLevel] || 0;
  const required = requiredTier(bountyUsdc);
  if (userRank < required.rank) {
    return { required: required.level, current: userLevel };
  }
  return null;
}
