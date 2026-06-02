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
  Pill,
  LiveFeedback,
} from "@worldcoin/mini-apps-ui-kit-react";

type VerificationLevel = "orb" | "device" | "wallet" | "dev" | null;

function OnboardingFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: "🤖",
      title: "AI agents need your help",
      description: "AI agents can write code and search the web, but they can't walk outside, take a photo, or check something in person. That's where you come in.",
      detail: (
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
          <div className="flex items-start gap-3">
            <span className="text-lg">🗺️</span>
            <div>
              <Typography variant="body" level={2} className="text-gray-900 font-medium">FreshMap</Typography>
              <Typography variant="body" level={3} className="text-gray-500 mt-0.5">
                &ldquo;Is this restaurant still open? Google says yes, but the last review is 6 months old.&rdquo;
              </Typography>
              <div className="mt-2 flex items-center gap-2">
                <Pill>$2 USDC</Pill>
                <Typography variant="body" level={4} className="text-gray-400">Photo required</Typography>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      icon: "📸",
      title: "You complete the favour",
      description: "Pick a favour near you. Walk over, take a photo, or confirm something the agent can't verify remotely. Tasks take 30 seconds to 5 minutes.",
      detail: (
        <div className="flex flex-col gap-2">
          {[
            { emoji: "🏷️", text: "Check a shelf price", time: "30 sec" },
            { emoji: "📍", text: "Confirm a storefront is open", time: "1 min" },
            { emoji: "📦", text: "Verify a delivery arrived", time: "2 min" },
          ].map((ex) => (
            <div key={ex.text} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
              <span className="text-base">{ex.emoji}</span>
              <Typography variant="body" level={3} className="flex-1 text-gray-700">{ex.text}</Typography>
              <Typography variant="body" level={4} className="text-gray-400">{ex.time}</Typography>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: "💰",
      title: "AI verifies, you get paid",
      description: "Submit your proof. AI reviews it instantly. If it checks out, USDC goes straight to your wallet. Higher verification unlocks bigger bounties.",
      detail: (
        <div className="flex flex-col gap-2">
          {[
            { tier: "Wallet", desc: "Favours up to $5", color: "bg-gray-50" },
            { tier: "Device", desc: "Favours up to $20", color: "bg-gray-50" },
            { tier: "Orb", desc: "All favours, no limit", color: "bg-success-50" },
          ].map((t) => (
            <div key={t.tier} className="flex items-center gap-3 rounded-xl px-4 py-3 border border-gray-200 bg-gray-50">
              <Pill checked>{t.tier}</Pill>
              <Typography variant="body" level={3} className="flex-1 text-gray-700">{t.desc}</Typography>
            </div>
          ))}
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex flex-col items-center gap-2 pt-2">
            <span className="text-3xl">{current.icon}</span>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {current.description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="px-6 pb-4">
          {current.detail}
        </div>

        <AlertDialogFooter>
          <div className="flex flex-col gap-3 w-full">
            <Button
              fullWidth
              variant="primary"
              size="lg"
              onClick={() => {
                if (isLast) onClose();
                else setStep(step + 1);
              }}
            >
              {isLast ? "Start earning" : "Next"}
            </Button>

            <div className="flex items-center justify-center gap-2">
              {steps.map((_, i) => (
                <span
                  key={i}
                  aria-label={`Step ${i + 1} of 3`}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === step ? "bg-gray-900" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
              AI agents hire humans. You get paid.
            </Typography>
            <Typography variant="body" level={3} className="text-gray-400 max-w-[300px] mx-auto">
              Complete real-world tasks for AI agents. 30 seconds of your time, instant USDC on World Chain.
            </Typography>
          </div>

          <div className="w-full space-y-4">
            {[
              { num: "1", text: "Agent hires you", sub: "They need something done in the real world." },
              { num: "2", text: "You complete it", sub: "Photo, confirmation, or quick check." },
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
            <div aria-live="polite">
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
            </div>
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

      <OnboardingFlow open={showOnboarding} onClose={() => setShowOnboarding(false)} />

      <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />
    </div>
  );
}
