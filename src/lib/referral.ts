import { getRedis } from "./redis";
import { awardPoints, getProofOfFavour } from "./proof-of-favour";
import { trackEvent } from "./track";

// Referral loop (decision-log 2026-07-05: consumer engagement is the product).
// Activation-gated per the Revolut/Kraken pattern: the real reward pays only
// when the invitee completes their first CLEAN verified favour, so a referral
// is worth something only if it produced a working human. Points only, never
// USDC. Sybil resistance: World ID makes invitees unique humans, attribution
// is once-per-wallet forever, self-referral is blocked, and rewards stop at a
// lifetime cap.
//
// The rules (explicit, change here + tests together):
export const REFERRAL_WELCOME_POINTS = 10; // invitee, once, at attributed sign-in
export const REFERRAL_ACTIVATION_POINTS = 50; // referrer, once per invitee, on invitee's first clean completion
export const REFERRAL_LIFETIME_CAP = 10; // rewarded activations per referrer, ever

const isWallet = (a: string | null | undefined): a is string => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
const key = {
  by: (invitee: string) => `referral:by:${invitee.toLowerCase()}`,
  of: (referrer: string) => `referral:of:${referrer.toLowerCase()}`,
  activated: (invitee: string) => `referral:activated:${invitee.toLowerCase()}`,
  activations: (referrer: string) => `referral:activations:${referrer.toLowerCase()}`,
};

// Called from verify-identity sign-in when a ?ref= wallet was carried through.
// Attribution sticks exactly once per invitee, and only while the invitee has
// no completed favours yet (you cannot be "referred" after you're already a
// working user). Returns true only when a NEW attribution was recorded.
export async function attributeReferral(invitee: string, referrer: string): Promise<boolean> {
  if (!isWallet(invitee) || !isWallet(referrer)) return false;
  if (invitee.toLowerCase() === referrer.toLowerCase()) return false;
  const redis = getRedis();
  if (!redis) return false;

  const profile = await getProofOfFavour(invitee);
  if ((profile.favoursCompleted || 0) > 0) return false;

  const stored = await redis.set(key.by(invitee), referrer.toLowerCase(), { nx: true });
  if (!stored) return false;

  await redis.sadd(key.of(referrer), invitee.toLowerCase());
  await awardPoints(invitee, "referral_welcome", REFERRAL_WELCOME_POINTS).catch(console.error);
  trackEvent("referral_attributed").catch(() => {});
  return true;
}

// Called from the verify-proof PASS path. Pays the referrer once, on the
// invitee's first clean completion, up to the lifetime cap. Never throws.
export async function recordReferralActivation(invitee: string): Promise<boolean> {
  try {
    if (!isWallet(invitee)) return false;
    const redis = getRedis();
    if (!redis) return false;

    const referrer = await redis.get(key.by(invitee));
    if (!referrer || typeof referrer !== "string" || !isWallet(referrer)) return false;

    // Once per invitee, forever.
    const first = await redis.set(key.activated(invitee), new Date().toISOString(), { nx: true });
    if (!first) return false;

    // Lifetime cap: the counter still counts, the award stops.
    const n = await redis.incr(key.activations(referrer));
    if (n > REFERRAL_LIFETIME_CAP) return false;

    await awardPoints(referrer, "referral_activated", REFERRAL_ACTIVATION_POINTS).catch(console.error);
    trackEvent("referral_activated").catch(() => {});
    return true;
  } catch (err) {
    console.error("[Referral] activation failed:", err);
    return false;
  }
}

export async function getReferralStats(referrer: string): Promise<{ invited: number; activated: number; capReached: boolean }> {
  const redis = getRedis();
  if (!redis || !isWallet(referrer)) return { invited: 0, activated: 0, capReached: false };
  const [invited, activations] = await Promise.all([
    redis.smembers(key.of(referrer)).then((m) => (m || []).length),
    redis.get(key.activations(referrer)).then((v) => Number(v || 0)),
  ]);
  return { invited, activated: activations, capReached: activations >= REFERRAL_LIFETIME_CAP };
}
