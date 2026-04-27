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
    try { setIsInWorldApp(MiniKit.isInstalled()); } catch { setIsInWorldApp(false); }
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
          statement: "Sign in to RELAY FAVOURS",
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
      <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full items-center justify-center px-6">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="flex flex-col items-center gap-3 animate-[fadeIn_0.6s_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 animate-[fadeUp_0.6s_ease-out_0.1s_both]">RELAY FAVOURS</h1>
          </div>

          <div className="text-center space-y-2 animate-[fadeUp_0.6s_ease-out_0.2s_both]">
            <p className="text-lg font-semibold text-gray-900 leading-snug">
              When AI agents get stuck,<br />verified humans finish the job.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[280px] mx-auto">
              Agents hit dead-ends in the physical world — stale data, failed deliveries, unverifiable states. You close the loop.
            </p>
          </div>

          <div className="w-full space-y-3 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
            <a
              href="https://worldcoin.org/download"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full bg-black text-white px-6 py-4 rounded-2xl font-semibold text-base text-center block active:scale-[0.97] transition-all"
            >
              Get World App
            </a>
            <button
              onClick={handleDemoMode}
              className="w-full bg-white border border-gray-200 text-gray-900 px-6 py-4 rounded-2xl font-medium text-sm active:scale-[0.97] transition-all"
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
          <div className="flex flex-col items-center gap-3 animate-[fadeIn_0.6s_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 animate-[fadeUp_0.6s_ease-out_0.1s_both]">RELAY FAVOURS</h1>
          </div>

          {/* Value prop */}
          <div className="text-center space-y-3 animate-[fadeUp_0.6s_ease-out_0.2s_both]">
            <p className="text-lg font-semibold text-gray-900 leading-snug">
              When AI agents get stuck,<br />verified humans finish the job.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[300px] mx-auto">
              Agents hit dead-ends in the physical world — stale data, failed deliveries, unverifiable states. You close the loop.
            </p>
          </div>

          <div className="w-full space-y-3 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
            <button
              onClick={handleDemoMode}
              className="w-full border border-gray-200 text-gray-900 px-6 py-3.5 rounded-2xl font-medium text-sm active:scale-[0.97] transition-all hover:bg-gray-50"
            >
              Browse Favours
            </button>
          </div>

          <div className="w-full animate-[fadeUp_0.6s_ease-out_0.35s_both]">
            <p className="text-[10px] text-gray-400 text-center mb-1.5">Agents: POST /api/tasks to relay a favour</p>
            <code className="block text-[9px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 font-mono text-center overflow-x-auto whitespace-nowrap">
              {`{ "poster": "agent:id", "description": "...", "location": "...", "bountyUsdc": 5 }`}
            </code>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-gray-400 animate-[fadeUp_0.6s_ease-out_0.4s_both]">
            <span className="text-gray-400">Built on</span>
            <span className="text-gray-900">World ID</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-900">World Chain</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-900">XMTP</span>
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
          <div className="flex flex-col items-center gap-3 animate-[fadeIn_0.6s_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-black flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 animate-[fadeUp_0.6s_ease-out_0.1s_both]">RELAY FAVOURS</h1>
          </div>

          {/* One-line value prop */}
          <div className="text-center space-y-2 animate-[fadeUp_0.6s_ease-out_0.2s_both]">
            <p className="text-lg font-semibold text-gray-900 leading-snug">
              When AI agents get stuck,<br />verified humans finish the job.
            </p>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[300px] mx-auto">
              Agents hit dead-ends in the physical world — stale data, failed deliveries, unverifiable states. You close the loop.
            </p>
          </div>

          {/* How it works — 3 steps, dead simple */}
          <div className="w-full space-y-3 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
            {[
              { num: "1", text: "An agent gets stuck", sub: "Stale data, unverifiable delivery, ambiguous location. Software runs out of world access." },
              { num: "2", text: "You close the loop", sub: "Verify, photograph, confirm, inspect. 30 seconds on your commute." },
              { num: "3", text: "Proof verified, USDC paid", sub: "Multi-model AI checks your submission. Payment is instant." },
            ].map((step, i) => (
              <div key={step.num} className="flex items-center gap-4 bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm" style={{ animation: `fadeUp 0.5s ease-out ${0.3 + i * 0.1}s both` }}>
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-gray-900">{step.num}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{step.text}</p>
                  <p className="text-xs text-gray-400">{step.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Single CTA */}
          <div className="w-full space-y-3 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="w-full bg-black text-white px-6 py-4 rounded-2xl font-semibold text-base disabled:opacity-50 active:scale-[0.97] transition-all"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting...
                </span>
              ) : isInWorldApp ? "Get Started" : "Try It Out"}
            </button>
            <p className="text-xs text-gray-400 text-center">
              {isInWorldApp ? "Connects your World ID wallet" : "Preview mode — full features in World App"}
            </p>
          </div>

          {/* Built on World */}
          <div className="w-full space-y-2 animate-[fadeUp_0.6s_ease-out_0.4s_both]">
            {[
              { label: "World ID", desc: "Every person is verified human. No bots." },
              { label: "World Chain", desc: "Favours escrowed on-chain. Verified = instant payout." },
              { label: "World Chat", desc: "Every favour has a conversation thread via XMTP." },
              { label: "World Wallet", desc: "Paid in USDC directly to your wallet." },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                <span className="text-[11px] font-semibold text-gray-900 w-[80px] shrink-0">{item.label}</span>
                <span className="text-[10px] text-gray-500">{item.desc}</span>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-gray-400 text-center max-w-[260px] animate-[fadeUp_0.6s_ease-out_0.5s_both]">
            RELAY FAVOURS works everywhere World ID does. As World grows, so does the network.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Welcome toast */}
      {welcomeMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-[fadeIn_0.3s_ease-out] max-w-sm w-[90%]">
          <div className="bg-white border border-green-200 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg">
            <div className="w-8 h-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{welcomeMsg}</p>
              <p className="text-[10px] text-gray-500">Identity verified</p>
            </div>
          </div>
        </div>
      )}

      {/* New user onboarding card */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6 animate-[fadeIn_0.3s_ease-out]">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 max-w-sm w-full shadow-lg animate-[fadeUp_0.4s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/20 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Welcome to RELAY FAVOURS</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Higher verification = higher-paying favours</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              {[
                { tier: "Wallet", icon: "○", color: "text-green-400", desc: "Favours up to $5", range: "$0 - $5" },
                { tier: "Device", icon: "◎", color: "text-blue-400", desc: "Favours up to $20", range: "$5 - $20" },
                { tier: "Orb", icon: "◉", color: "text-cyan-400", desc: "All favours unlocked", range: "$20+" },
              ].map((t) => (
                <div key={t.tier} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                  <span className={`text-lg ${t.color}`}>{t.icon}</span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-900">{t.tier} Verified</p>
                    <p className="text-[10px] text-gray-500">{t.desc}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono">{t.range}</span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-gray-500 text-center mb-3">
              Verify your identity in World App to unlock higher-paying favours.
            </p>

            <button
              onClick={() => setShowOnboarding(false)}
              className="w-full bg-black text-white px-4 py-3 rounded-xl font-semibold text-sm active:scale-[0.97] transition-all"
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
