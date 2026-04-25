"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";

type VerificationLevel = "orb" | "device" | "wallet" | "dev" | null;

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isInWorldApp, setIsInWorldApp] = useState(false);
  const [miniKitChecked, setMiniKitChecked] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    setIsInWorldApp(MiniKit.isInstalled());
    setMiniKitChecked(true);
    setIsMobile(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
    const stored = localStorage.getItem("relay_user_id");
    const storedLevel = localStorage.getItem("relay_verification_level") as VerificationLevel;
    if (stored) {
      setUserId(stored);
      setVerificationLevel(storedLevel);
    }
  }, []);

  const handleDemoMode = async () => {
    const devId = `demo_${crypto.randomUUID().slice(0, 8)}`;
    setUserId(devId);
    setVerificationLevel("dev");
    localStorage.setItem("relay_user_id", devId);
    localStorage.setItem("relay_verification_level", "dev");

    await fetch("/api/verify-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: devId }),
    });
  };

  const handleVerify = async () => {
    setIsVerifying(true);

    if (MiniKit.isInstalled()) {
      try {
        const result = await MiniKit.walletAuth({
          nonce: crypto.randomUUID().replace(/-/g, ""),
          statement: "Sign in to RELAY",
          expirationTime: new Date(Date.now() + 3600_000),
        });
        if (result?.data?.address) {
          const addr = result.data.address;
          const shortAddr = `${addr.slice(0, 5)}...${addr.slice(-3)}`;
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

          // Show welcome message
          setWelcomeMsg(`Welcome back, ${shortAddr}`);
          setTimeout(() => setWelcomeMsg(null), 3000);

          // First-time onboarding
          if (firstTime) {
            localStorage.setItem("relay_has_signed_in", "true");
            setShowOnboarding(true);
          }

          // Request push notification permission
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

  // Mobile but MiniKit not installed — prompt to install World App
  if (!userId && miniKitChecked && !isInWorldApp && isMobile) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6 animate-[fadeIn_0.4s_ease-out]">
        <div className="flex flex-col items-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_60px_rgba(255,255,255,0.06)]">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          <h1 className="text-4xl font-bold tracking-tight">RELAY</h1>

          <div className="text-center space-y-3">
            <h2 className="text-2xl font-semibold">Install World App</h2>
            <p className="text-gray-400 text-sm max-w-[300px] leading-relaxed">
              RELAY requires World App to verify your identity and process on-chain payments.
            </p>
          </div>

          <a
            href="https://worldcoin.org/download"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full max-w-xs bg-white text-black px-6 py-3.5 rounded-2xl font-semibold text-sm text-center active:scale-[0.97] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            Download World App
          </a>

          <p className="text-[11px] text-gray-500 text-center max-w-[280px] leading-relaxed">
            After installing, open this page inside World App to get started.
          </p>

          <button
            onClick={handleDemoMode}
            className="text-gray-500 hover:text-gray-400 text-xs underline underline-offset-4 transition-colors mt-2"
          >
            Continue anyway (demo mode)
          </button>
        </div>
      </div>
    );
  }

  // Desktop / non-World App fallback
  if (!userId && miniKitChecked && !isInWorldApp) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_60px_rgba(255,255,255,0.06)]">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          <h1 className="text-4xl font-bold tracking-tight">RELAY</h1>

          {/* Phone icon */}
          <div className="w-16 h-24 rounded-xl border-2 border-white/20 flex items-center justify-center relative">
            <div className="absolute top-1.5 w-6 h-1 rounded-full bg-white/20" />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l2 2" />
            </svg>
            <div className="absolute bottom-1.5 w-4 h-4 rounded-full border border-white/20" />
          </div>

          {/* Message */}
          <div className="text-center space-y-3">
            <h2 className="text-2xl font-semibold">Open in World App</h2>
            <p className="text-gray-400 text-sm max-w-[300px] leading-relaxed">
              RELAY runs inside World App. Scan the QR code or search for RELAY in World App.
            </p>
          </div>

          {/* App URL */}
          <div className="bg-[#111] border border-white/[0.08] rounded-xl px-5 py-3">
            <p className="text-sm text-gray-300 font-mono tracking-wide">world-relay.vercel.app</p>
          </div>

          {/* Demo mode link */}
          <button
            onClick={handleDemoMode}
            className="text-gray-500 hover:text-gray-400 text-xs underline underline-offset-4 transition-colors mt-4"
          >
            Continue anyway (demo mode)
          </button>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
        {/* Hero */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-6">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.08)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight mb-2">RELAY</h1>
              <p className="text-gray-400 text-sm max-w-[280px] leading-relaxed">
                When AI hits a wall, RELAY finds a verified human.
              </p>
            </div>
          </div>

          {/* Three pillars */}
          <div className="w-full grid grid-cols-3 gap-3 mt-2">
            {[
              { icon: "📋", label: "Post", desc: "Describe a task at a real location", color: "from-blue-500/10 to-blue-500/5", border: "border-blue-500/15" },
              { icon: "📸", label: "Prove", desc: "Verified human proves with a photo", color: "from-purple-500/10 to-purple-500/5", border: "border-purple-500/15" },
              { icon: "💸", label: "Paid", desc: "AI verifies, USDC settles on-chain", color: "from-green-500/10 to-green-500/5", border: "border-green-500/15" },
            ].map((step) => (
              <div key={step.label} className={`bg-gradient-to-b ${step.color} border ${step.border} rounded-2xl p-3 text-center`}>
                <span className="text-2xl">{step.icon}</span>
                <p className="text-xs font-bold mt-1.5">{step.label}</p>
                <p className="text-[9px] text-gray-500 mt-0.5 leading-tight">{step.desc}</p>
              </div>
            ))}
          </div>

          {/* Agent examples */}
          <div className="w-full mt-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium text-center mb-2">AI agents need humans for</p>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {[
                { icon: "🏢", name: "ClaimsEye", task: "Storm damage photos", color: "#3b82f6" },
                { icon: "📊", name: "ShelfSight", task: "Shelf audit", color: "#ef4444" },
                { icon: "🗺️", name: "FreshMap", task: "Street survey", color: "#22c55e" },
                { icon: "⚡", name: "PlugCheck", task: "EV charger status", color: "#f59e0b" },
                { icon: "👁️", name: "ListingTruth", task: "Verify Airbnb", color: "#8b5cf6" },
              ].map((agent) => (
                <div
                  key={agent.name}
                  className="shrink-0 flex items-center gap-2 bg-[#111] border border-white/[0.06] rounded-xl px-3 py-2"
                >
                  <span className="text-base">{agent.icon}</span>
                  <div>
                    <p className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.name}</p>
                    <p className="text-[9px] text-gray-500">{agent.task}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Message us callout */}
          <div className="w-full mt-1">
            <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/15 rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-white">Message the RELAY bot on World Chat</p>
                <p className="text-[9px] text-gray-500 font-mono truncate mt-0.5">0x1101158041fd96f21cbcbb0e752a9a2303e6d70e</p>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="flex flex-col items-center gap-3 w-full max-w-xs mt-2">
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="w-full bg-white text-black px-6 py-3.5 rounded-2xl font-semibold text-sm disabled:opacity-50 active:scale-[0.97] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Verifying...
                </span>
              ) : isInWorldApp ? "Verify with World ID" : "Enter as Dev User"}
            </button>
            <p className="text-[11px] text-gray-500">
              {isInWorldApp ? "One human, one seat. 38M verified." : "Dev mode -- World ID in World App"}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold text-white">38M</p>
                <p className="text-[9px] text-gray-500">Verified Humans</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-400">USDC</p>
                <p className="text-[9px] text-gray-500">On-chain Settlement</p>
              </div>
              <div>
                <p className="text-lg font-bold text-purple-400">AI</p>
                <p className="text-[9px] text-gray-500">Proof Verification</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-4 mt-3">
            <span className="text-[9px] text-gray-700">World ID</span>
            <span className="text-gray-800">·</span>
            <span className="text-[9px] text-gray-700">World Chat</span>
            <span className="text-gray-800">·</span>
            <span className="text-[9px] text-gray-700">World Chain</span>
            <span className="text-gray-800">·</span>
            <span className="text-[9px] text-gray-700">Uniswap V3</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Welcome toast */}
      {welcomeMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-[fadeIn_0.3s_ease-out] max-w-sm w-[90%]">
          <div className="bg-[#111] border border-green-500/20 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{welcomeMsg}</p>
              <p className="text-[10px] text-gray-500">Wallet Verified</p>
            </div>
          </div>
        </div>
      )}

      {/* New user onboarding card */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6 animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-[#111] border border-white/[0.1] rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-white">Welcome to RELAY</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Your trust tier unlocks bounties</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              {[
                { tier: "Wallet", icon: "○", color: "text-green-400", desc: "Basic tasks up to $5", range: "$0 - $5" },
                { tier: "Device", icon: "◎", color: "text-blue-400", desc: "Mid-range bounties", range: "$5 - $20" },
                { tier: "Orb", icon: "◉", color: "text-cyan-400", desc: "All bounties unlocked", range: "$20+" },
              ].map((t) => (
                <div key={t.tier} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5">
                  <span className={`text-lg ${t.color}`}>{t.icon}</span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-white">{t.tier} Verified</p>
                    <p className="text-[10px] text-gray-500">{t.desc}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">{t.range}</span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-gray-500 text-center mb-3">
              Upgrade your verification in World App settings to claim higher bounties.
            </p>

            <button
              onClick={() => setShowOnboarding(false)}
              className="w-full bg-white text-black px-4 py-3 rounded-xl font-semibold text-sm active:scale-[0.97] transition-all"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="animate-[fadeIn_0.3s_ease-out]">
        <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />
      </div>
    </div>
  );
}
