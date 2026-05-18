"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";
import { displayName } from "@/hooks/useWorldUser";

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
            <div className="w-16 h-16 rounded-2xl bg-[#191C20] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#191C20]">RELAY FAVOURS</h1>
          </div>

          <div className="text-center space-y-3">
            <p className="text-base font-medium text-[#191C20] leading-snug">
              AI agents get stuck in the real world.{"\n"}You close the loop and get paid.
            </p>
            <p className="text-sm text-[#657080] leading-relaxed max-w-[300px] mx-auto">
              Verify locations, confirm deliveries, check business hours. 30 seconds of your time, instant USDC.
            </p>
          </div>

          <div className="w-full space-y-4">
            {[
              { num: "1", text: "Agent posts a favour", sub: "Something it can't verify from software alone." },
              { num: "2", text: "You complete it", sub: "Photo, confirmation, or inspection." },
              { num: "3", text: "Get paid instantly", sub: "AI verifies your proof. USDC to your wallet." },
            ].map((step) => (
              <div key={step.num} className="flex items-start gap-4 px-1">
                <div className="w-8 h-8 rounded-full bg-[#F0F2F5] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-sm font-semibold text-[#191C20]">{step.num}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#191C20]">{step.text}</p>
                  <p className="text-sm text-[#657080]">{step.sub}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="w-full space-y-3">
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="w-full bg-[#191C20] text-white px-6 py-4 rounded-2xl font-semibold text-base disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting...
                </span>
              ) : isInWorldApp ? "Get Started" : "Continue"}
            </button>
            {!isInWorldApp && (
              <p className="text-xs text-[#9BA3AE] text-center">
                Full features available in World App
              </p>
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
          <div className="bg-white border border-[#D4F5E0] rounded-2xl px-5 py-3 flex items-center gap-3 shadow-lg">
            <div className="w-8 h-8 rounded-full bg-[#E8F8EE] flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#29A352" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#191C20]">{welcomeMsg}</p>
              <p className="text-xs text-[#657080]">Identity verified</p>
            </div>
          </div>
        </div>
      )}

      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-[#EDF2FF] flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4E7AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <p className="text-base font-semibold text-[#191C20]">Welcome to RELAY</p>
                <p className="text-sm text-[#657080] mt-0.5">Higher verification unlocks more favours</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-5">
              {[
                { tier: "Wallet", color: "bg-[#E8F8EE] text-[#29A352]", desc: "Up to $5", range: "$0-$5" },
                { tier: "Device", color: "bg-[#EDF2FF] text-[#4E7AFF]", desc: "Up to $20", range: "$5-$20" },
                { tier: "Orb", color: "bg-[#E5F9F6] text-[#00B894]", desc: "All favours", range: "$20+" },
              ].map((t) => (
                <div key={t.tier} className="flex items-center gap-3 bg-[#F7F8FA] rounded-xl px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.color}`}>{t.tier}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#191C20]">{t.desc}</p>
                  </div>
                  <span className="text-sm text-[#9BA3AE] font-mono">{t.range}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowOnboarding(false)}
              className="w-full bg-[#191C20] text-white px-4 py-3.5 rounded-xl font-semibold text-sm active:scale-[0.98] transition-transform"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />
    </div>
  );
}
