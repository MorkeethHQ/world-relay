"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";
import { Onboarding } from "@/components/Onboarding";
import { displayName } from "@/hooks/useWorldUser";
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
    const stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level") as VerificationLevel;
    if (stored) {
      setUserId(stored);
      setVerificationLevel(storedLevel);
    }
    // Anyone already signed in, or who finished onboarding before, skips it.
    if (stored || localStorage.getItem("relay_onboarded") === "true") {
      setOnboarded(true);
    }
    setMiniKitChecked(true);
  }, []);

  const handleVerify = async () => {
    setAuthError(null);
    setIsVerifying(true);

    // Inside World App: wallet sign-in is the only path. If it fails or the
    // user cancels, surface an error and let them retry. Never silently mint a
    // dev_ user, and never advance to a "verified" screen without a real auth.
    if (MiniKit.isInstalled()) {
      try {
        const result = await MiniKit.walletAuth({
          nonce: crypto.randomUUID().replace(/-/g, ""),
          statement: "Sign in to RELAY FAVOURS",
          expirationTime: new Date(Date.now() + 3600_000),
        });
        if (result?.data?.address) {
          const addr = result.data.address;

          setUserId(addr);
          setVerificationLevel("wallet");
          localStorage.setItem("relay_user_id", addr);
          localStorage.setItem("relay_verification_level", "wallet");

          await fetch("/api/verify-identity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: addr,
              signature: result.data.signature,
              message: result.data.message,
              ref: localStorage.getItem("favour_ref") || undefined,
            }),
          });
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

  const completeOnboarding = () => {
    localStorage.setItem("relay_onboarded", "true");
    setOnboarded(true);
  };

  // Brand-new users (never onboarded) get the guided click-through. Its World
  // ID step calls the same handleVerify used below, so the existing MiniKit
  // auth path is preserved, not replaced. Stays mounted through sign-in until
  // the user taps through the final screen, which sets the onboarded flag.
  if (!onboarded) {
    return (
      <Onboarding
        isInWorldApp={isInWorldApp}
        isVerifying={isVerifying}
        authed={!!userId}
        verificationLevel={verificationLevel}
        authError={authError}
        onVerify={handleVerify}
        onComplete={completeOnboarding}
      />
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-white items-center justify-between px-6 py-16">
        <div />

        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <h1 className="text-[56px] font-bold tracking-tight text-gray-900 leading-none animate-[countUp_0.6s_ease-out]">
            RELAY
          </h1>
          <p className="text-[15px] text-gray-400 text-center leading-relaxed max-w-[240px] animate-[fadeSlideIn_0.5s_ease-out_0.2s_both]">
            Real tasks. Real people.<br />Verified on-chain.
          </p>
          <div className="flex items-center gap-3 mt-2 animate-[fadeSlideIn_0.5s_ease-out_0.4s_both]">
            <span className="text-[11px] text-gray-300 uppercase tracking-widest">Tasks</span>
            <span className="w-1 h-1 rounded-full bg-gray-200" />
            <span className="text-[11px] text-gray-300 uppercase tracking-widest">Polls</span>
            <span className="w-1 h-1 rounded-full bg-gray-200" />
            <span className="text-[11px] text-gray-300 uppercase tracking-widest">Campaigns</span>
          </div>
        </div>

        <div className="w-full max-w-sm space-y-3 animate-[fadeSlideIn_0.5s_ease-out_0.5s_both]">
          <div aria-live="polite">
            <LiveFeedback state={isVerifying ? "pending" : undefined}>
              <Button
                onClick={handleVerify}
                disabled={isVerifying}
                fullWidth
                variant="primary"
                size="lg"
              >
                {isInWorldApp ? "Sign in" : "Continue"}
              </Button>
            </LiveFeedback>
          </div>
          {authError && (
            <p className="text-[13px] text-error-600 text-center" role="alert">
              {authError}
            </p>
          )}
          {!isInWorldApp && (
            <p className="text-[12px] text-gray-300 text-center">
              Full features available in World App
            </p>
          )}
        </div>
      </div>
    );
  }

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

      <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />
    </div>
  );
}
