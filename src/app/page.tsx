"use client";

import { useState, useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { TaskBoard } from "@/components/TaskBoard";

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
      <div className="flex flex-col items-center justify-center min-h-screen p-6 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">RELAY</h1>
          <p className="text-gray-400 text-sm max-w-xs">
            The first errand network where both sides are provably human.
          </p>
        </div>
        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="bg-white text-black px-6 py-3 rounded-xl font-medium text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {isVerifying ? "Verifying..." : isInWorldApp ? "Verify with World ID" : "Enter as Dev User"}
        </button>
        <p className="text-xs text-gray-600">
          {isInWorldApp ? "One human, one seat." : "Dev mode — World ID verification available in World App."}
        </p>
      </div>
    );
  }

  return <TaskBoard userId={userId} onLogout={handleLogout} />;
}
