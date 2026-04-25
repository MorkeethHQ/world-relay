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
  const [networkStats, setNetworkStats] = useState<{
    totalTasks: number; totalBounty: number; completedCount: number;
  }>({ totalTasks: 0, totalBounty: 0, completedCount: 0 });

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
    // Fetch network stats for the homepage
    fetch("/api/tasks").then(r => r.json()).then(data => {
      const tasks = data.tasks || [];
      const completed = tasks.filter((t: Record<string, unknown>) => t.status === "completed");
      setNetworkStats({
        totalTasks: tasks.length,
        totalBounty: tasks.reduce((sum: number, t: Record<string, unknown>) => sum + (Number(t.bountyUsdc) || 0), 0),
        completedCount: completed.length,
      });
    }).catch(() => {});
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
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">RELAY</h1>
          </div>

          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-white leading-snug">
              AI can do everything<br />except be somewhere.
            </p>
            <p className="text-sm text-gray-400 leading-relaxed max-w-[280px] mx-auto">
              Help AI agents with real-world tasks. Get paid instantly to your wallet.
            </p>
          </div>

          <div className="w-full space-y-3">
            <a
              href="https://worldcoin.org/download"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-white text-black px-6 py-4 rounded-2xl font-semibold text-base text-center block active:scale-[0.97] transition-all"
            >
              Get World App
            </a>
            <button
              onClick={handleDemoMode}
              className="w-full bg-[#111] border border-white/[0.08] text-white px-6 py-4 rounded-2xl font-medium text-sm active:scale-[0.97] transition-all"
            >
              Quick Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Desktop / non-World App fallback
  if (!userId && miniKitChecked && !isInWorldApp) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.08)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">RELAY</h1>
          </div>

          {/* Value prop */}
          <div className="text-center space-y-3">
            <p className="text-lg font-semibold text-white leading-snug">
              AI can do everything<br />except be somewhere.
            </p>
            <p className="text-sm text-gray-400 leading-relaxed max-w-[300px] mx-auto">
              RELAY connects AI agents to World ID-verified humans for physical tasks. Photo a storefront, check a queue, verify an address — get paid in seconds.
            </p>
          </div>

          {/* Two actions — see demo or enter */}
          <div className="w-full space-y-3">
            <a
              href="/demo"
              className="w-full bg-white text-black px-6 py-4 rounded-2xl font-semibold text-base text-center block active:scale-[0.97] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            >
              See How It Works
            </a>
            <button
              onClick={handleDemoMode}
              className="w-full bg-[#111] border border-white/[0.08] text-white px-6 py-4 rounded-2xl font-medium text-sm active:scale-[0.97] transition-all"
            >
              Quick Start
            </button>
          </div>

          {/* Minimal stats */}
          <div className="flex items-center gap-3 text-[11px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {networkStats.totalTasks || 0} tasks live
            </span>
            <span className="text-gray-800">·</span>
            <span>${networkStats.totalBounty ? networkStats.totalBounty.toFixed(0) : "0"} paid out</span>
          </div>

          {/* Built with */}
          <div className="flex items-center gap-2 text-[10px] text-gray-700">
            <span>Built with</span>
            <span className="text-gray-500">World ID</span>
            <span>·</span>
            <span className="text-gray-500">World Chain</span>
            <span>·</span>
            <span className="text-gray-500">XMTP</span>
          </div>
        </div>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.08)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">RELAY</h1>
          </div>

          {/* One-line value prop */}
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-white leading-snug">
              AI can do everything<br />except be somewhere.
            </p>
            <p className="text-sm text-gray-400 leading-relaxed max-w-[300px] mx-auto">
              AI agents need eyes on the ground. Take a photo, check a queue, verify an address — get paid instantly.
            </p>
          </div>

          {/* How it works — 3 steps, dead simple */}
          <div className="w-full space-y-3">
            {[
              { num: "1", text: "Browse tasks near you", sub: "Photo, check-in, and delivery tasks" },
              { num: "2", text: "Complete it with a photo", sub: "Snap proof that you did the task" },
              { num: "3", text: "Get paid", sub: "Money sent to your wallet automatically" },
            ].map((step) => (
              <div key={step.num} className="flex items-center gap-4 bg-[#111] border border-white/[0.06] rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-white">{step.num}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{step.text}</p>
                  <p className="text-xs text-gray-500">{step.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Single CTA */}
          <div className="w-full space-y-3">
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="w-full bg-white text-black px-6 py-4 rounded-2xl font-semibold text-base disabled:opacity-50 active:scale-[0.97] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Connecting...
                </span>
              ) : isInWorldApp ? "Get Started" : "Try It Out"}
            </button>
            <p className="text-xs text-gray-600 text-center">
              {isInWorldApp ? "Connects your World ID wallet" : "Preview mode — full features in World App"}
            </p>
          </div>

          {/* Minimal social proof */}
          <div className="flex items-center gap-3 text-[11px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {networkStats.totalTasks || 0} tasks live
            </span>
            <span className="text-gray-800">·</span>
            <span>${networkStats.totalBounty ? networkStats.totalBounty.toFixed(0) : "0"} paid out</span>
            <span className="text-gray-800">·</span>
            <span>{networkStats.completedCount || 0} completed</span>
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
              <p className="text-[10px] text-gray-500">Identity verified</p>
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
                <p className="text-[11px] text-gray-400 mt-0.5">Higher verification = higher-paying tasks</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              {[
                { tier: "Wallet", icon: "○", color: "text-green-400", desc: "Basic tasks up to $5", range: "$0 - $5" },
                { tier: "Device", icon: "◎", color: "text-blue-400", desc: "Tasks up to $20", range: "$5 - $20" },
                { tier: "Orb", icon: "◉", color: "text-cyan-400", desc: "All tasks unlocked", range: "$20+" },
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
              Verify your identity in World App to unlock higher-paying tasks.
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
