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
      icon: "\u{1F91D}",
      title: "People helping people",
      description: "Need a review, a photo, feedback, or an errand done? Post a favour and someone nearby will handle it.",
      detail: (
        <div className="flex flex-col gap-2">
          {[
            { emoji: "\u{2B50}", text: "Get a review of a place", reward: "$5" },
            { emoji: "\u{1F4E3}", text: "Get a social media post", reward: "$3" },
            { emoji: "\u{1F3C3}", text: "Run a quick errand", reward: "$15" },
          ].map((ex) => (
            <div key={ex.text} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
              <span className="text-base">{ex.emoji}</span>
              <Typography variant="body" level={3} className="flex-1 text-gray-700">{ex.text}</Typography>
              <Pill>{ex.reward}</Pill>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: "\u{1F4F8}",
      title: "Complete and submit proof",
      description: "Pick a favour, do it, and submit your proof. Photo, screenshot, or written response. Most take under 5 minutes.",
      detail: (
        <div className="flex flex-col gap-2">
          {[
            { emoji: "\u{1F4F1}", text: "Test an app and screen-record", time: "3 min" },
            { emoji: "\u{1F4AC}", text: "Give honest feedback", time: "2 min" },
            { emoji: "\u{1F4CD}", text: "Check something in person", time: "5 min" },
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
      icon: "\u{1F4B0}",
      title: "AI verifies, you earn USDC",
      description: "Three AI models review your proof instantly. Pass verification and USDC goes straight to your wallet. Higher World ID tiers unlock bigger rewards.",
      detail: (
        <div className="flex flex-col gap-2">
          {[
            { tier: "Wallet", desc: "Favours up to $5" },
            { tier: "Device", desc: "Favours up to $20" },
            { tier: "Orb", desc: "All favours, no limit" },
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
