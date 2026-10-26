import { NextRequest, NextResponse } from "next/server";
import { verifySiweMessage, parseSiweMessage } from "@worldcoin/minikit-js/siwe";
import { getAddress } from "viem";
import { getRedis } from "@/lib/redis";
import { trackVisitor, trackEvent } from "@/lib/track";
import { issueSessionToken, ownerRefusal, getAuthedAddress, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";
import { attributeReferral } from "@/lib/referral";
import { SIWE_COOKIE, SIWE_PREFIX } from "@/lib/wallet-challenge";

const VERIFIED_PREFIX = "verified:";
const NULLIFIER_PREFIX = "nullifier:";

const localCache = new Map<string, {
  nullifier: string;
  verificationLevel: string;
  verifiedAt: string;
}>();

type VerifiedUser = { nullifier: string; verificationLevel: string; verifiedAt: string; [key: string]: unknown };
function storedUser(raw: unknown): VerifiedUser | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && typeof value.verificationLevel === "string" ? value as VerifiedUser : null;
  } catch { return null; }
}
function levelRank(level: string): number {
  return level === "orb" ? 3 : level === "device" ? 2 : level === "wallet" ? 1 : 0;
}

// A wallet signature establishes control of an address, not a fresh World ID
// tier. Never replace a stronger stored tier when a returning person signs in.
// Older records used the wallet's checksummed spelling as the Redis key; carry
// that verified record to the canonical lowercase key used by current sessions.
async function ensureWalletUser(address: string): Promise<VerifiedUser> {
  const redis = getRedis();
  if (!redis) throw new Error("Identity storage is unavailable");
  const canonical = address.toLowerCase();
  const key = `${VERIFIED_PREFIX}${canonical}`;
  const current = storedUser(await redis.get(key));
  let chosen = current;
  const oldSpellings = new Set([address, getAddress(canonical as `0x${string}`)]);
  for (const spelling of oldSpellings) {
    if (spelling === canonical) continue;
    const legacy = storedUser(await redis.get(`${VERIFIED_PREFIX}${spelling}`));
    if (legacy && (!chosen || levelRank(legacy.verificationLevel) > levelRank(chosen.verificationLevel))) chosen = legacy;
  }
  if (!chosen) chosen = { nullifier: canonical, verificationLevel: "wallet", verifiedAt: new Date().toISOString() };
  // SET NX makes a simultaneous Orb upgrade win when this is a first sign-in.
  // A stronger legacy record is the only reason to replace an existing key.
  if (current && chosen !== current) await redis.set(key, JSON.stringify(chosen));
  else if (!current) await redis.set(key, JSON.stringify(chosen), { nx: true });
  const persisted = storedUser(await redis.get(key));
  if (!persisted) throw new Error("Identity storage is unavailable");
  localCache.set(canonical, persisted);
  return persisted;
}

async function checkNullifierUnique(nullifier: string, address: string): Promise<boolean> {
  if (nullifier === "unknown" || nullifier === address) return true;
  const redis = getRedis();
  if (!redis) return false;
  const existing = await redis.get(`${NULLIFIER_PREFIX}${nullifier}`);
  if (existing && String(existing).toLowerCase() !== address.toLowerCase()) return false;
  return true;
}

async function saveVerifiedUser(address: string, data: { nullifier: string; verificationLevel: string; verifiedAt: string }) {
  const redis = getRedis();
  if (!redis) throw new Error("Identity storage is unavailable");
  if (data.nullifier !== "unknown" && data.nullifier !== address) {
    const existing = await redis.get(`${NULLIFIER_PREFIX}${data.nullifier}`);
    if (existing && String(existing).toLowerCase() !== address.toLowerCase()) throw new Error("Human already linked to another wallet");
    const bound = await redis.set(`${NULLIFIER_PREFIX}${data.nullifier}`, address, { nx: true });
    if (!bound && String(await redis.get(`${NULLIFIER_PREFIX}${data.nullifier}`)).toLowerCase() !== address.toLowerCase()) throw new Error("Human already linked to another wallet");
  }
  await redis.set(`${VERIFIED_PREFIX}${address}`, JSON.stringify(data));
  localCache.set(address, data);
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
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!getRedis()) return NextResponse.json({ error: "Identity storage is unavailable." }, { status: 503 });

  if (body.rp_id && body.idkitResponse) {
    const { rp_id, idkitResponse } = body;
    const owner = getAuthedAddress(req, Date.now());
    if (!owner || body.address?.toLowerCase() !== owner) return NextResponse.json({ error: "Sign in with your wallet before verifying World ID." }, { status: 403 });
    if (!process.env.WORLD_RP_ID) return NextResponse.json({ error: "World ID verification is not configured." }, { status: 503 });
    if (rp_id !== process.env.WORLD_RP_ID) return NextResponse.json({ error: "Invalid relying party." }, { status: 400 });

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
    const address = owner;

    const isUnique = await checkNullifierUnique(nullifier, address);
    if (!isUnique) {
      return NextResponse.json({ error: "This human is already verified with a different address" }, { status: 409 });
    }

    try { await saveVerifiedUser(address, {
      nullifier,
      verificationLevel: identifier,
      verifiedAt: new Date().toISOString(),
    }); } catch { return NextResponse.json({ error: "Identity could not be saved." }, { status: 503 }); }

    trackVisitor(address).catch(() => {});

    return NextResponse.json({
      verified: true,
      verification_level: identifier,
      nullifier,
      ...result,
    });
  }

  if (body.address && body.signature) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(body.address) || typeof body.message !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Invalid wallet sign-in payload." }, { status: 400 });
    const token = issueSessionToken(body.address, Date.now());
    if (!token) return NextResponse.json({ error: "Wallet sign-in is not configured." }, { status: 503 });
    const nonce = req.cookies.get(SIWE_COOKIE)?.value;
    if (!nonce) return NextResponse.json({ error: "Sign-in challenge expired. Please try again." }, { status: 401 });
    try {
      const message = parseSiweMessage(body.message);
      if (message.domain !== req.nextUrl.host || message.uri && new URL(message.uri).origin !== req.nextUrl.origin) return NextResponse.json({ error: "Sign-in was issued for another app." }, { status: 401 });
      const redis = getRedis()!;
      if (await redis.get(`${SIWE_PREFIX}${nonce}`) !== req.nextUrl.origin) return NextResponse.json({ error: "Sign-in challenge expired. Please try again." }, { status: 401 });
      const proof = await verifySiweMessage(body, nonce, "Sign in to FAVOUR");
      if (!proof.isValid) return NextResponse.json({ error: "Wallet signature did not verify." }, { status: 401 });
      // GETDEL is atomic: concurrent requests cannot exchange one signature twice.
      if (await redis.getdel(`${SIWE_PREFIX}${nonce}`) !== req.nextUrl.origin) return NextResponse.json({ error: "Sign-in challenge was already used." }, { status: 401 });
      await ensureWalletUser(body.address);
    } catch {
      return NextResponse.json({ error: "Wallet sign-in could not be verified and saved. Please try again." }, { status: 401 });
    }
    trackVisitor(body.address).catch(() => {});
    trackEvent("sign_in", { level: "wallet" }).catch(() => {});
    if (typeof body.ref === "string") attributeReferral(body.address, body.ref).catch(console.error);
    const level = (await getVerifiedUser(body.address.toLowerCase()))?.verificationLevel ?? "wallet";
    const res = NextResponse.json({ verified: true, verification_level: level, address: body.address.toLowerCase() });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
    res.cookies.delete(SIWE_COOKIE);
    return res;
  }

  if (typeof body.address === "string" && body.address.startsWith("dev_")) {
    if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_SESSIONS !== "true") return NextResponse.json({ error: "Open FAVOUR in World App to sign in." }, { status: 403 });
    await saveVerifiedUser(body.address, {
      nullifier: body.address,
      verificationLevel: "dev",
      verifiedAt: new Date().toISOString(),
    });

    trackVisitor(body.address).catch(() => {});

    // DEV ACCOUNTS AND THE IDENTITY GATE, decided 2026-09-16.
    //
    // A `dev_` id is minted by the browser-preview path when MiniKit is not
    // installed. Nobody signs anything for it, so it proves nothing, and it is
    // not a wallet. Under SESSION_ENFORCE it would be locked out of all nine
    // gated routes by construction, which was one of the two breakages found.
    //
    // The decision is NOT to quietly exempt it, because an exemption for
    // unsigned identities is the hole the invariant exists to close: anyone can
    // pick a `dev_` id. Instead it gets a session ONLY where dev ids are a
    // legitimate affordance, which is local and preview, behind an explicit
    // switch that defaults OFF. In production the switch is absent, dev accounts
    // hold no session, and enforcement correctly refuses them.
    //
    // The default direction matters and follows the same rule as
    // BOARD_REPLENISH_ENABLED: forgetting the variable must fail to the SAFE
    // side. Here safe means no session. SESSION_ENFORCE itself defaults the other
    // way, which is exactly why this gate sat open for months.
    const res = NextResponse.json({
      verified: true,
      verification_level: "dev",
      dev_mode: true,
      dev_session: process.env.ALLOW_DEV_SESSIONS === "true",
    });

    if (process.env.ALLOW_DEV_SESSIONS === "true") {
      const token = issueSessionToken(body.address, Date.now());
      if (token) {
        res.cookies.set(SESSION_COOKIE, token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_TTL_MS / 1000,
        });
      }
    }

    return res;
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

  // PRIVATE PART (14 Oct 2026). The stored record holds the World ID
  // nullifier, and this answered it to anyone who named the address, with no
  // cookie. Anyone may learn whether a wallet is verified and at what level;
  // the whole record goes only to that wallet's own session (the hard gate,
  // ownerRefusal, whatever SESSION_ENFORCE says).
  if (ownerRefusal(req, address, Date.now())) {
    return NextResponse.json({ verified: true, verification_level: user.verificationLevel ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({
    verified: true,
    ...user,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
