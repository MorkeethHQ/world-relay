"use client";
import { walletNonce } from "@/lib/wallet-nonce";

import { useCallback, useEffect, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";

// THE SIGN-IN USED BY THE REVAMPED PAGES (/project, /post). The same path as the
// home page's handleVerify (app/page.tsx): inside World App, wallet auth and
// nothing else; in a browser, a preview id. Never a dev id inside World App.

export type VerificationLevel = "orb" | "device" | "wallet" | "dev" | null;

export function useFavourAuth() {
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>(null);
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let inApp = false;
    try { inApp = MiniKit.isInstalled(); } catch {}
    setIsInWorldApp(inApp);
    let live = true;
    fetch("/api/session", { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((res) => res.json()).then((session) => {
      if (!live) return;
      if (session.authenticated && /^0x[0-9a-fA-F]{40}$/.test(session.address)) {
        setUserId(session.address); setVerificationLevel("wallet");
        fetch(`/api/verify-identity?address=${encodeURIComponent(session.address)}`, { cache: "no-store" })
          .then((res) => res.ok ? res.json() : null)
          .then((identity) => {
            if (!live) return;
            const level = identity?.verification_level;
            if (level === "orb" || level === "device" || level === "wallet") setVerificationLevel(level);
          }).catch(() => {});
      }
    }).catch(() => { if (live) setAuthError("We could not check your sign-in. Please try again when connected."); }).finally(() => { if (live) setChecked(true); });
    return () => { live = false; };
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setIsVerifying(true);
    let inApp = false;
    try { inApp = MiniKit.isInstalled(); } catch {}
    if (inApp) {
      try {
        const result = await MiniKit.walletAuth({
          nonce: await walletNonce(),
          statement: "Sign in to FAVOUR",
          expirationTime: new Date(Date.now() + 3600_000),
        });
        const addr = result?.data?.address;
        if (!addr) { setAuthError("Sign-in wasn't completed. Please try again."); setIsVerifying(false); return; }
        const verified = await fetch("/api/verify-identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr, signature: result.data.signature, message: result.data.message, ref: localStorage.getItem("favour_ref") || undefined }),
        });
        if (!verified.ok) throw new Error("Sign-in could not be verified and saved.");
        const identity = await verified.json();
        const level = identity.verification_level === "orb" || identity.verification_level === "device" ? identity.verification_level : "wallet";
        localStorage.removeItem("favour_ref");
        localStorage.setItem("relay_user_id", addr);
        localStorage.setItem("relay_verification_level", level);
        setUserId(addr);
        setVerificationLevel(level);
      } catch {
        setAuthError("Sign-in failed. Please try again.");
      }
      setIsVerifying(false);
      return;
    }
    setAuthError("Open FAVOUR in World App to sign in with your wallet.");
    setIsVerifying(false);
  }, []);

  return { userId, verificationLevel, isInWorldApp, isVerifying, authError, checked, signIn };
}
