import { getRedis } from "./redis";
import { getIsUserVerified } from "@worldcoin/minikit-js/address-book";

// Verification-tier gate for FUNDED (real-USDC) tasks. Higher bounties require a
// stronger World ID tier. Points tasks are NOT gated here — a points value is not
// dollars, so gating a "10 points" task as if it were $10 wrongly locks out
// wallet-level humans. Callers must only invoke this for escrow-funded tasks.

const WORLDCHAIN_RPC = "https://worldchain-mainnet.g.alchemy.com/public";
// Negative on-chain lookups are cached this long so a submission doesn't cost an
// RPC round-trip every time; a positive is persisted permanently (Orb status
// doesn't get revoked in practice, and re-detection would restore it anyway).
const ORB_NEGATIVE_CACHE_SECONDS = 6 * 3600;

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
    const data = raw ? (typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>)) : null;
    const stored = (data?.verificationLevel as string) || "wallet";
    if (stored !== "wallet") return stored;

    // Orb detection, PROVEN not claimed (invariant 4): World's on-chain Address
    // Book records which wallets belong to Orb-verified humans. MiniKit v2 has
    // no client verify command, and a client-claimed level would be spoofable
    // by anyone with a wallet — the chain is the authority. Detection is
    // automatic: no screen, no user action, upgrade persists on first sight.
    if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
      const negCached = await redis.get(`orbcheck:${address.toLowerCase()}`);
      if (negCached) return stored;
      const isOrb = await getIsUserVerified(address, WORLDCHAIN_RPC).catch((err) => {
        console.error(`[Tier] Address Book lookup failed for ${address}:`, err);
        return false;
      });
      if (isOrb) {
        await redis.set(`verified:${address}`, JSON.stringify({
          ...(data || {}),
          nullifier: (data?.nullifier as string) || address,
          verificationLevel: "orb",
          verifiedAt: (data?.verifiedAt as string) || new Date().toISOString(),
          orbDetectedAt: new Date().toISOString(),
        })).catch(() => {});
        return "orb";
      }
      await redis.set(`orbcheck:${address.toLowerCase()}`, "no", { ex: ORB_NEGATIVE_CACHE_SECONDS }).catch(() => {});
    }
    return stored;
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
