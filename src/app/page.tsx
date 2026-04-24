"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { Feed } from "@/components/Feed";

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isInWorldApp, setIsInWorldApp] = useState(false);

  useEffect(() => {
    setIsInWorldApp(MiniKit.isInstalled());
    const stored = localStorage.getItem("relay_user_id");
    if (stored) setUserId(stored);
  }, []);

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
          localStorage.setItem("relay_user_id", addr);

          await fetch("/api/verify-identity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: addr,
              signature: result.data.signature,
              message: result.data.message,
            }),
          });

          setIsVerifying(false);
          return;
        }
      } catch (err) {
        console.error("MiniKit auth failed:", err);
      }
    }

    // Dev fallback for browser testing
    const devId = `dev_${crypto.randomUUID().slice(0, 8)}`;
    setUserId(devId);
    localStorage.setItem("relay_user_id", devId);
    setIsVerifying(false);
  };

  const handleLogout = () => {
    localStorage.removeItem("relay_user_id");
    setUserId(null);
  };

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 gap-8">
        <div className="flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight mb-2">RELAY</h1>
            <p className="text-gray-500 text-sm max-w-[260px] leading-relaxed">
              Post errands. Prove completion. Get paid. Both sides verified human.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3 w-full max-w-xs">
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
            {isInWorldApp ? "One human, one seat." : "Dev mode — World ID in World App"}
          </p>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-600 uppercase tracking-widest">Post</span>
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
          </div>
          <svg width="24" height="8" viewBox="0 0 24 8" fill="none"><path d="M0 4h20m0 0l-3-3m3 3l-3 3" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-600 uppercase tracking-widest">Prove</span>
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
          </div>
          <svg width="24" height="8" viewBox="0 0 24 8" fill="none"><path d="M0 4h20m0 0l-3-3m3 3l-3 3" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-600 uppercase tracking-widest">Paid</span>
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return <Feed userId={userId} onLogout={handleLogout} />;
}
