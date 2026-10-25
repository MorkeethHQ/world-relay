"use client";
import { walletNonce } from "@/lib/wallet-nonce";

import { useState, useEffect } from "react";


import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";
import { WorldAppHandoff } from "@/components/WorldAppHandoff";
import { displayName } from "@/hooks/useWorldUser";
import { trackReauthOncePerDay } from "@/lib/funnel-events";
import {
  Button,
  Typography,
  CircularIcon,
  LiveFeedback,
} from "@worldcoin/mini-apps-ui-kit-react";

type VerificationLevel = "orb" | "device" | "wallet" | "dev" | null;

// Honest label for the confirmation toast. Wallet sign-in is not the Orb
// uniqueness proof, so it must not claim "identity verified".
function verificationSubtitle(level: VerificationLevel): string {
  switch (level) {
    case "orb":
      return "Verified unique human";
    case "device":
      return "Device verified";
    case "wallet":
      return "Signed in with World wallet";
    default:
      return "Preview mode";
  }
}

export default function Home() {
  // The image-led campaign board is the front door again. Keep /board as a
  // stable alias so existing links continue to work.
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [miniKitChecked, setMiniKitChecked] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  // New users see the guided onboarding once. Anyone already signed in, or
  // anyone who has finished onboarding before, skips straight to the app / auth.
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    try { setIsInWorldApp(MiniKit.isInstalled()); } catch { setIsInWorldApp(false); }
    // Referral capture: a ?ref=<wallet> on the landing URL is remembered until
    // the first sign-in, where it rides along to /api/verify-identity. Server
    // side validates everything; storing junk here is harmless.
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && !localStorage.getItem("relay_user_id")) {
        localStorage.setItem("favour_ref", ref);
      }
    } catch {}
    let stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level") as VerificationLevel;
    // Self-heal a stale/legacy id (Oscar live-test Jul 8). Early builds could
    // persist a non-wallet id — an old IDKit nullifier, or a dev_ id carried in.
    // Inside World App a valid id is always a 0x wallet; a non-0x id silently
    // breaks every wallet-gated action: staking returns "wallet account required",
    // and jury verdicts are rejected so nothing is earned AND the same proofs
    // repeat forever (the judged-set only fills on an accepted verdict). If we're
    // in World App with a non-wallet stored id, drop it and route back through
    // walletAuth, which mints a fresh 0x id. Browser-preview dev_ ids (MiniKit not
    // installed) are left untouched.
    let inWorldApp = false;
    try { inWorldApp = MiniKit.isInstalled(); } catch {}
    const isWalletId = !!stored && /^0x[0-9a-fA-F]{40}$/.test(stored);
    if (stored && !isWalletId && inWorldApp) {
      localStorage.removeItem("relay_user_id");
      localStorage.removeItem("relay_verification_level");
      localStorage.removeItem("relay_onboarded");
      stored = null;
    }
    if (stored) {
      setUserId(stored);
      setVerificationLevel(storedLevel);
    }
    // Anyone already signed in, or who finished onboarding before, skips it.
    if (stored || localStorage.getItem("relay_onboarded") === "true") {
      setOnboarded(true);
    }
    setMiniKitChecked(true);

    // RE-AUTH, added 2026-09-16, and this is the line the whole identity gate
    // was waiting on.
    //
    // A stored id above means "this person signed in once". It does NOT mean
    // they still hold a session cookie: the cookie is issued only inside
    // /api/verify-identity, and the branch above returns without ever calling it
    // again. Before this, a returning person silently carried no session, which
    // is why enforcing would have locked out ~89% of registered users.
    //
    // /api/session answers the question and does the silent half by itself: a
    // cookie past halfway through its life is reissued server-side with no
    // prompt. Only someone whose session is genuinely gone gets asked to sign,
    // because a new proof of wallet control cannot be minted without a signature.
    if (stored && isWalletId && inWorldApp) {
      (async () => {
        try {
          const res = await fetch("/api/session", { cache: "no-store" });
          const s = await res.json();
          if (s?.authenticated) return; // valid, and renewed if it needed it
          await reauthSilently(stored!);
        } catch {
          // Offline or the endpoint is unreachable. Leave them as they are; a
          // gated action will surface the real reason if it comes to that.
        }
      })();
    }
  }, []);

  // One signature, only when there is no session left to renew. Deliberately
  // quiet: no error banner and no state change if the person declines, because
  // the gate is still open and being nagged on arrival would cost more people
  // than the open gate does. When they decline, gated routes return their own
  // explicit "re-open the app to re-authenticate" message.
  const reauthSilently = async (addr: string) => {
    trackReauthOncePerDay("reauth_asked");
    try {
      const result = await MiniKit.walletAuth({
        nonce: await walletNonce(),
        statement: "Sign in to FAVOUR",
        expirationTime: new Date(Date.now() + 3600_000),
      });
      if (!result?.data?.address) { trackReauthOncePerDay("reauth_failed"); return; }
      // Only accept a signature from the wallet we already believe we are.
      // A different address here means the person switched wallets, which is a
      // fresh sign-in rather than a refresh, and is left to handleVerify.
      if (result.data.address.toLowerCase() !== addr.toLowerCase()) { trackReauthOncePerDay("reauth_failed"); return; }
      const res = await fetch("/api/verify-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: result.data.address,
          signature: result.data.signature,
          message: result.data.message,
        }),
      });
      trackReauthOncePerDay(res.ok ? "reauth_ok" : "reauth_failed");
    } catch {
      // User declined, or MiniKit is unavailable. Stay quiet, as above.
      trackReauthOncePerDay("reauth_failed");
    }
  };

  const handleVerify = async () => {
    setAuthError(null);
    setIsVerifying(true);

    // Inside World App: wallet sign-in is the only path. If it fails or the
    // user cancels, surface an error and let them retry. Never silently mint a
    // dev_ user, and never advance to a "verified" screen without a real auth.
    if (MiniKit.isInstalled()) {
      try {
        const result = await MiniKit.walletAuth({
          nonce: await walletNonce(),
          statement: "Sign in to FAVOUR",
          expirationTime: new Date(Date.now() + 3600_000),
        });
        if (result?.data?.address) {
          const addr = result.data.address;

          const verified = await fetch("/api/verify-identity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: addr,
              signature: result.data.signature,
              message: result.data.message,
              ref: localStorage.getItem("favour_ref") || undefined,
            }),
          });
          if (!verified.ok) { const error = await verified.json(); throw new Error(error.error || "Sign-in failed. Please try again."); }
          setUserId(addr);
          setVerificationLevel("wallet");
          localStorage.setItem("relay_user_id", addr);
          localStorage.setItem("relay_verification_level", "wallet");

          localStorage.removeItem("favour_ref");

          MiniKit.getUserByAddress(addr).then(u => {
            setWelcomeMsg(`Welcome, ${u?.username ? `@${u.username}` : displayName(addr)}`);
          }).catch(() => {
            setWelcomeMsg(`Welcome, ${displayName(addr)}`);
          });
          setTimeout(() => setWelcomeMsg(null), 3000);

          try {
            await MiniKit.requestPermission({ permission: "notifications" as any });
          } catch {}

          setIsVerifying(false);
          return;
        }
        // No address returned means the sign-in did not complete (declined or
        // dismissed). Do not fall through to a dev identity inside World App.
        setAuthError("Sign-in wasn't completed. Please try again.");
        setIsVerifying(false);
        return;
      } catch (err) {
        console.error("MiniKit auth failed:", err);
        setAuthError("Sign-in failed. Please try again.");
        setIsVerifying(false);
        return;
      }
    }

    // Browser-only preview fallback. This branch is unreachable inside World
    // App because MiniKit.isInstalled() is true there.
    const devId = `dev_${crypto.randomUUID().slice(0, 8)}`;
    setUserId(devId);
    setVerificationLevel("dev");
    localStorage.setItem("relay_user_id", devId);
    localStorage.setItem("relay_verification_level", "dev");

    await fetch("/api/verify-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: devId }),
    });

    setIsVerifying(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("relay_user_id");
    localStorage.removeItem("relay_verification_level");
    setUserId(null);
    setVerificationLevel(null);
  };

  if (!miniKitChecked) return null;


  return (
    <div className="relative">
      {welcomeMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%]">
          <div className="bg-white border border-success-200 rounded-2xl px-5 py-3 flex items-center gap-3 shadow-lg">
            <CircularIcon size="sm" className="bg-success-100">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--success-600))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </CircularIcon>
            <div className="flex-1 min-w-0">
              <Typography variant="body" level={2}>{welcomeMsg}</Typography>
              <Typography variant="body" level={4} className="text-gray-400">{verificationSubtitle(verificationLevel)}</Typography>
            </div>
          </div>
        </div>
      )}

      <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} onReauth={handleVerify} />
    </div>
  );
}
