import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { worldchain } from "viem/chains";
import { getRedis } from "@/lib/redis";
import { trackVisitor, trackEvent } from "@/lib/track";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";
import { attributeReferral } from "@/lib/referral";

// Verify that `signature` over `message` was really produced by `address`.
// World App wallets are smart-contract accounts, so this must be an on-chain
// EIP-1271 check (viem's verifyMessage handles both EOA and EIP-1271 when given
// a public client). Returns true only on a cryptographically valid signature.
async function verifyWalletSignature(address: string, message: string, signature: string): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: worldchain, transport: http("https://worldchain-mainnet.g.alchemy.com/public") });
    return await client.verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (err) {
    console.error(`[Identity] Signature verification error for ${address}:`, err);
    return false;
  }
}

const VERIFIED_PREFIX = "verified:";
const NULLIFIER_PREFIX = "nullifier:";

const localCache = new Map<string, {
  nullifier: string;
  verificationLevel: string;
  verifiedAt: string;
}>();

async function checkNullifierUnique(nullifier: string, address: string): Promise<boolean> {
  if (nullifier === "unknown" || nullifier === address) return true;
  const redis = getRedis();
  if (!redis) return true;
  const existing = await redis.get(`${NULLIFIER_PREFIX}${nullifier}`);
  if (existing && existing !== address) return false;
  return true;
}

async function saveVerifiedUser(address: string, data: { nullifier: string; verificationLevel: string; verifiedAt: string }) {
  localCache.set(address, data);
  const redis = getRedis();
  if (redis) {
    await redis.set(`${VERIFIED_PREFIX}${address}`, JSON.stringify(data)).catch(() => {});
    if (data.nullifier !== "unknown" && data.nullifier !== address) {
      await redis.set(`${NULLIFIER_PREFIX}${data.nullifier}`, address).catch(() => {});
    }
  }
}

async function getVerifiedUser(address: string) {
  if (localCache.has(address)) return localCache.get(address)!;
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`${VERIFIED_PREFIX}${address}`);
    if (!raw) return null;
    const data = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    localCache.set(address, data);
    return data;
  } catch (err) {
    console.error(`[Identity] Failed to read verified user ${address}:`, err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.rp_id && body.idkitResponse) {
    const { rp_id, idkitResponse } = body;

    let response: Response;
    try {
      response = await fetch(
        `https://developer.world.org/api/v4/verify/${rp_id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(idkitResponse),
        },
      );
    } catch (err) {
      console.error("[World ID] Verification request failed:", err);
      return NextResponse.json({ error: "World ID verification service unreachable" }, { status: 502 });
    }

    if (!response.ok) {
      const err = await response.text();
      console.error("[World ID] Verification failed:", err);
      return NextResponse.json({ error: "Verification failed" }, { status: 400 });
    }

    const result = await response.json();
    const nullifier = idkitResponse.responses?.[0]?.nullifier || "unknown";
    const identifier = idkitResponse.responses?.[0]?.identifier || "orb";
    const address = body.address || nullifier;

    const isUnique = await checkNullifierUnique(nullifier, address);
    if (!isUnique) {
      return NextResponse.json({ error: "This human is already verified with a different address" }, { status: 409 });
    }

    await saveVerifiedUser(address, {
      nullifier,
      verificationLevel: identifier,
      verifiedAt: new Date().toISOString(),
    });

    trackVisitor(address).catch(() => {});

    return NextResponse.json({
      verified: true,
      verification_level: identifier,
      nullifier,
      ...result,
    });
  }

  if (body.address && body.signature) {
    await saveVerifiedUser(body.address, {
      nullifier: body.address,
      verificationLevel: "wallet",
      verifiedAt: new Date().toISOString(),
    });

    trackVisitor(body.address).catch(() => {});
    trackEvent("sign_in", { level: "wallet" }).catch(() => {});

    // Referral attribution (points only; all validation lives in referral.ts:
    // wallet format, self-ref, once-ever, invitee must have no completions).
    if (typeof body.ref === "string") {
      attributeReferral(body.address, body.ref).catch(console.error);
    }

    const res = NextResponse.json({
      verified: true,
      verification_level: "wallet",
      address: body.address,
    });

    // Issue a signed session cookie ONLY when the SIWE signature actually
    // verifies on-chain. This is what binds later mutating requests to a wallet
    // the caller provably controls (see src/lib/session.ts). A bad/absent
    // signature still marks the address "verified" (no regression to the old
    // behavior) but gets no session — so session-gated routes stay closed to it.
    if (typeof body.message === "string") {
      const ok = await verifyWalletSignature(body.address, body.message, body.signature);
      if (ok) {
        const token = issueSessionToken(body.address, Date.now());
        if (token) {
          res.cookies.set(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 3600,
          });
        }
      } else {
        console.error(`[Identity] Wallet signature did not verify for ${body.address}; no session issued`);
      }
    }

    return res;
  }

  if (body.address?.startsWith("dev_")) {
    await saveVerifiedUser(body.address, {
      nullifier: body.address,
      verificationLevel: "dev",
      verifiedAt: new Date().toISOString(),
    });

    trackVisitor(body.address).catch(() => {});

    return NextResponse.json({
      verified: true,
      verification_level: "dev",
      dev_mode: true,
    });
  }

  return NextResponse.json({ error: "Missing verification fields" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const user = await getVerifiedUser(address);
  if (!user) {
    return NextResponse.json({ verified: false, verification_level: null });
  }

  return NextResponse.json({
    verified: true,
    ...user,
  });
}
