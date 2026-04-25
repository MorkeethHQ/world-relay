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

  useEffect(() => {
    setIsInWorldApp(MiniKit.isInstalled());
    setMiniKitChecked(true);
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
            className="text-gray-600 hover:text-gray-400 text-xs underline underline-offset-4 transition-colors mt-4"
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
            <p className="text-[10px] text-gray-600 uppercase tracking-wider font-medium text-center mb-2">AI agents need humans for</p>
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
                    <p className="text-[9px] text-gray-600">{agent.task}</p>
                  </div>
                </div>
              ))}
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
            <p className="text-[11px] text-gray-600">
              {isInWorldApp ? "One human, one seat. 38M verified." : "Dev mode — World ID in World App"}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="bg-[#111] border border-white/[0.06] rounded-2xl p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold text-white">38M</p>
                <p className="text-[9px] text-gray-600">Verified Humans</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-400">USDC</p>
                <p className="text-[9px] text-gray-600">On-chain Settlement</p>
              </div>
              <div>
                <p className="text-lg font-bold text-purple-400">AI</p>
                <p className="text-[9px] text-gray-600">Proof Verification</p>
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

  return <Feed userId={userId} verificationLevel={verificationLevel} onLogout={handleLogout} />;
}
