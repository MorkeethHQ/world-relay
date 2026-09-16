import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  getAuthedAddress,
  issueSessionToken,
  sessionExpiry,
  shouldRenewSession,
  sessionEnforced,
} from "@/lib/session";

// The missing half of the identity gate, added 2026-09-16.
//
// THE PROBLEM THIS EXISTS FOR. The session cookie had exactly one source,
// /api/verify-identity, reachable only through a full wallet sign-in. page.tsx
// treats a stored `relay_user_id` in localStorage as signed in, so a returning
// person never went back through it and never refreshed the cookie. There was no
// way to ask "am I still authenticated?" without attempting a mutation. Measured
// 2026-09-16: 55 sign_in events in 7 days against 494 registered users, so
// turning SESSION_ENFORCE on would have locked out at least 89% of them.
//
// WHAT THIS DOES, and what it deliberately does NOT do.
//
// It answers whether the caller holds a valid session, and if that session is
// past halfway through its life it silently reissues it. That is the whole
// silent path: a person who has been back within the window is never challenged.
//
// It CANNOT mint a session for someone who does not already hold one. Doing that
// would be identity claimed rather than proven, which is the invariant being
// closed. A caller with no valid cookie is told `authenticated: false` and the
// client sends them through walletAuth for one signature.
//
// GET is safe and read-mostly: the only write is replacing a cookie the caller
// already proved they hold.
export async function GET(req: NextRequest) {
  const now = Date.now();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const address = getAuthedAddress(req, now);

  if (!address) {
    // Covers all three of: no cookie, tampered cookie, EXPIRED cookie. Expired is
    // deliberately not treated as "absent and therefore fine" and never renews;
    // it needs a fresh signature like any other unauthenticated caller.
    return NextResponse.json({
      authenticated: false,
      // Tells the client whether a refusal is even possible yet, so it can decide
      // how loudly to prompt while the gate is still open.
      enforced: sessionEnforced(),
      reason: token ? "session expired or invalid" : "no session",
    });
  }

  const expiresAt = sessionExpiry(token, now);
  const renew = shouldRenewSession(token, now);

  const res = NextResponse.json({
    authenticated: true,
    address,
    expiresAt: renew ? now + SESSION_TTL_MS : expiresAt,
    renewed: renew,
    enforced: sessionEnforced(),
  });

  if (renew) {
    const fresh = issueSessionToken(address, now);
    if (fresh) {
      res.cookies.set(SESSION_COOKIE, fresh, {
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
