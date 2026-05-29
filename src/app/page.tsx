"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";
import { displayName } from "@/hooks/useWorldUser";
import {
  Button,
  Typography,
  Spinner,
  CircularIcon,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
  Pill,
  LiveFeedback,
} from "@worldcoin/mini-apps-ui-kit-react";

type VerificationLevel = "orb" | "device" | "wallet" | "dev" | null;

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [miniKitChecked, setMiniKitChecked] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    try { setIsInWorldApp(MiniKit.isInstalled()); } catch { setIsInWorldApp(false); }
    setMiniKitChecked(true);
    const stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level") as VerificationLevel;
    if (stored) {
      setUserId(stored);
      setVerificationLevel(storedLevel);
    }
  }, []);

  const handleVerify = async () => {
    setIsVerifying(true);

    if (MiniKit.isInstalled()) {
      try {
        const result = await MiniKit.walletAuth({
          nonce: crypto.randomUUID().replace(/-/g, ""),
          statement: "Sign in to RELAY FAVOURS",
          expirationTime: new Date(Date.now() + 3600_000),
        });
        if (result?.data?.address) {
          const addr = result.data.address;
          const firstTime = !localStorage.getItem("relay_has_signed_in");

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
            }),
          });

          MiniKit.getUserByAddress(addr).then(u => {
            setWelcomeMsg(`Welcome, ${u?.username ? `@${u.username}` : displayName(addr)}`);
          }).catch(() => {
            setWelcomeMsg(`Welcome, ${displayName(addr)}`);
          });
          setTimeout(() => setWelcomeMsg(null), 3000);

          if (firstTime) {
            localStorage.setItem("relay_has_signed_in", "true");
            setShowOnboarding(true);
          }

          try {
            await MiniKit.requestPermission({ permission: "notifications" as any });
          } catch {}

          setIsVerifying(false);
          return;
        }
      } catch (err) {
        console.error("MiniKit auth failed:", err);
      }
    }

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

  if (!userId) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="flex flex-col items-center gap-4">
            <CircularIcon size="lg" className="bg-gray-900">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </CircularIcon>
            <Typography variant="heading" level={3} as="h1">
              RELAY FAVOURS
            </Typography>
          </div>

          <div className="text-center space-y-3">
            <Typography variant="subtitle" level={1}>
              AI agents get stuck in the real world. You close the loop and get paid.
            </Typography>
            <Typography variant="body" level={3} className="text-gray-400 max-w-[300px] mx-auto">
              Verify locations, confirm deliveries, check business hours. 30 seconds of your time, instant USDC.
            </Typography>
          </div>

          <div className="w-full space-y-4">
            {[
              { num: "1", text: "Agent posts a favour", sub: "Something it can't verify from software alone." },
              { num: "2", text: "You complete it", sub: "Photo, confirmation, or inspection." },
              { num: "3", text: "Get paid instantly", sub: "AI verifies your proof. USDC to your wallet." },
            ].map((step) => (
              <div key={step.num} className="flex items-start gap-4 px-1">
                <CircularIcon size="sm" className="bg-gray-100 mt-0.5">
                  <Typography variant="label" level={2}>{step.num}</Typography>
                </CircularIcon>
                <div>
                  <Typography variant="body" level={2}>{step.text}</Typography>
                  <Typography variant="body" level={3} className="text-gray-400">{step.sub}</Typography>
                </div>
              </div>
            ))}
          </div>

          <div className="w-full space-y-3">
            <LiveFeedback state={isVerifying ? "pending" : undefined}>
              <Button
                onClick={handleVerify}
                disabled={isVerifying}
                fullWidth
                variant="primary"
                size="lg"
              >
                {isInWorldApp ? "Get Started" : "Continue"}
              </Button>
            </LiveFeedback>
            {!isInWorldApp && (
              <Typography variant="body" level={4} className="text-gray-400 text-center">
                Full features available in World App
              </Typography>
            )}
          </div>
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
              <Typography variant="body" level={4} className="text-gray-400">Identity verified</Typography>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={showOnboarding} onOpenChange={setShowOnboarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to RELAY</AlertDialogTitle>
            <AlertDialogDescription>
              Higher verification unlocks more favours
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3 px-6 pb-4">
            {[
              { tier: "Wallet", color: "bg-success-100 text-success-700", desc: "Up to $5", range: "$0-$5" },
              { tier: "Device", color: "bg-info-100 text-info-700", desc: "Up to $20", range: "$5-$20" },
              { tier: "Orb", color: "bg-success-100 text-success-700", desc: "All favours", range: "$20+" },
            ].map((t) => (
              <div key={t.tier} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                <Pill checked>{t.tier}</Pill>
                <div className="flex-1">
                  <Typography variant="body" level={2}>{t.desc}</Typography>
                </div>
                <Typography variant="body" level={3} className="text-gray-400 font-mono">{t.range}</Typography>
              </div>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogClose asChild>
              <Button fullWidth variant="primary" size="lg">
                Got it
              </Button>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />
    </div>
  );
}
