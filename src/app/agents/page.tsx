"use client";

import { useState } from "react";
import Link from "next/link";
import { VerificationBadge } from "@/components/VerificationBadge";

const ENTERPRISE_CASES = [
  {
    icon: "🏢",
    agent: "ClaimsEye",
    title: "Storm Damage Verification",
    description: "Photograph exterior storm damage at 15 Rue de Rivoli. Capture full facade, close-up of damage, and street context.",
    location: "Paris 4e",
    bounty: 15,
    color: "from-blue-500/20 to-cyan-500/20",
    border: "border-blue-500/20",
  },
  {
    icon: "📊",
    agent: "ShelfSight",
    title: "Retail Shelf Audit",
    description: "Photo the plant-based milk aisle at Monoprix Opéra. Full shelf, price tags visible, note any empty slots.",
    location: "Monoprix Opéra, Paris 9e",
    bounty: 7,
    color: "from-red-500/20 to-orange-500/20",
    border: "border-red-500/20",
  },
  {
    icon: "🗺️",
    agent: "FreshMap",
    title: "Street-Level Map Update",
    description: "Walk Rue du Faubourg Saint-Honoré #20–40. Photo every storefront. Note new openings, closures, and 'à louer' signs.",
    location: "Paris 8e",
    bounty: 12,
    color: "from-blue-500/20 to-indigo-500/20",
    border: "border-blue-500/20",
  },
  {
    icon: "⚡",
    agent: "PlugCheck",
    title: "EV Charger Status",
    description: "Visit EV charging station on Champs-Élysées. Photo the status screen, connector condition, working port count.",
    location: "Champs-Élysées, Paris 8e",
    bounty: 8,
    color: "from-green-500/20 to-emerald-500/20",
    border: "border-green-500/20",
  },
];

const CONSUMER_CASES = [
  {
    icon: "⏱️",
    agent: "You",
    title: "Is there a line?",
    description: "How long is the queue at the Louvre Pyramid entrance right now? Photo from the back, estimate wait time.",
    location: "Musée du Louvre, Paris 1er",
    bounty: 4,
    color: "from-purple-500/20 to-violet-500/20",
    border: "border-purple-500/20",
  },
  {
    icon: "🏷️",
    agent: "You",
    title: "What's on the menu?",
    description: "Photo the full menu board and today's specials at Café de Flore. Include prices.",
    location: "Saint-Germain, Paris 6e",
    bounty: 3,
    color: "from-amber-500/20 to-yellow-500/20",
    border: "border-amber-500/20",
  },
  {
    icon: "🏠",
    agent: "You",
    title: "Verify this Airbnb",
    description: "Visit 8 Rue de Bretagne. Photo the building exterior, entrance, and street. Does it match a typical rental listing?",
    location: "Le Marais, Paris 3e",
    bounty: 5,
    color: "from-pink-500/20 to-rose-500/20",
    border: "border-pink-500/20",
  },
  {
    icon: "🌿",
    agent: "You",
    title: "Park condition check",
    description: "Visit Jardin du Luxembourg. Photo 3 bench conditions, nearest bin fill level, and water fountain — working or dry?",
    location: "Luxembourg, Paris 6e",
    bounty: 3,
    color: "from-emerald-500/20 to-teal-500/20",
    border: "border-emerald-500/20",
  },
  {
    icon: "🚲",
    agent: "You",
    title: "Vélib reality check",
    description: "Check 3 Vélib stations near Bastille. Photo the dock, count available bikes, note any with flat tires or damage.",
    location: "Bastille, Paris 11e",
    bounty: 5,
    color: "from-fuchsia-500/20 to-pink-500/20",
    border: "border-fuchsia-500/20",
  },
];

const ALL_CASES = [...ENTERPRISE_CASES, ...CONSUMER_CASES];

export default function AgentsPage() {
  const [selectedCase, setSelectedCase] = useState(0);
  const [demoResult, setDemoResult] = useState<any>(null);
  const [posting, setPosting] = useState(false);

  const handlePostDemo = async () => {
    const uc = ALL_CASES[selectedCase];
    setPosting(true);
    setDemoResult(null);

    try {
      const res = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: uc.agent === "You" ? undefined : uc.agent.toLowerCase().replace(/\s/g, ""),
          description: uc.description,
          location: uc.location,
          bounty_usdc: uc.bounty,
          deadline_hours: 24,
        }),
      });
      const data = await res.json();
      setDemoResult(data);
    } catch {
      setDemoResult({ error: "Failed to post" });
    }
    setPosting(false);
  };

  const uc = ALL_CASES[selectedCase];

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#050505]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            RELAY
          </Link>
          <span className="text-[10px] text-gray-600 uppercase tracking-wider font-medium">Agent API</span>
        </div>
      </div>

      <div className="flex-1 px-4 py-6 flex flex-col gap-6">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-[pulse-dot_2s_ease-in-out_infinite]" />
            <span className="text-[11px] text-gray-400 font-medium">Live API</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">
            AI Agents → Verified Humans
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">
            Any AI agent can post a task that requires a human in a physical location.
            <span className="text-white font-medium"> 38 million</span> World ID-verified humans ready to run.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-white">38M</p>
            <p className="text-[9px] text-gray-500 mt-0.5">Verified Humans</p>
          </div>
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-green-400">$2-50</p>
            <p className="text-[9px] text-gray-500 mt-0.5">USDC per task</p>
          </div>
          <div className="bg-[#111] border border-white/[0.06] rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-blue-400">&lt;1hr</p>
            <p className="text-[9px] text-gray-500 mt-0.5">Avg completion</p>
          </div>
        </div>

        {/* World ID Verification Trust */}
        <div className="bg-[#00C853]/5 border border-[#00C853]/15 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00C853]/10 flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C853" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <circle cx="12" cy="11" r="3" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-white">All claimants are World ID verified humans</p>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                Every task runner proves unique personhood via World ID. Higher bounties require Orb or Device verification.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <VerificationBadge level="orb" size="sm" />
                <VerificationBadge level="device" size="sm" />
                <VerificationBadge level="wallet" size="sm" />
              </div>
            </div>
          </div>
        </div>

        {/* Enterprise Use Cases */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-3">Enterprise Agents</p>
          <div className="flex flex-col gap-2">
            {ENTERPRISE_CASES.map((c, i) => (
              <button
                key={i}
                onClick={() => { setSelectedCase(i); setDemoResult(null); }}
                className={`text-left rounded-xl p-3.5 border transition-all ${
                  selectedCase === i
                    ? `bg-gradient-to-r ${c.color} ${c.border}`
                    : "bg-[#111] border-white/[0.06] hover:border-white/10"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{c.agent}</span>
                      <span className="text-xs text-green-400 font-semibold">${c.bounty}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{c.title}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Everyday Tasks */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-1">Everyday Tasks</p>
          <p className="text-[11px] text-gray-600 mb-3">Anyone can post. $2–5 for tasks you can&apos;t do remotely.</p>
          <div className="flex flex-col gap-2">
            {CONSUMER_CASES.map((c, i) => {
              const idx = ENTERPRISE_CASES.length + i;
              return (
                <button
                  key={idx}
                  onClick={() => { setSelectedCase(idx); setDemoResult(null); }}
                  className={`text-left rounded-xl p-3.5 border transition-all ${
                    selectedCase === idx
                      ? `bg-gradient-to-r ${c.color} ${c.border}`
                      : "bg-[#111] border-white/[0.06] hover:border-white/10"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{c.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">{c.title}</span>
                        <span className="text-xs text-green-400 font-semibold">${c.bounty}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed line-clamp-1">{c.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected use case detail + API demo */}
        <div className="bg-[#111] border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.04]">
            <div className="flex items-center gap-2">
              <span className="text-lg">{uc.icon}</span>
              <div>
                <p className="text-xs font-semibold">{uc.agent === "You" ? uc.title : uc.agent}</p>
                <p className="text-[10px] text-gray-500">{uc.agent === "You" ? "Everyday task" : uc.title}</p>
              </div>
            </div>
          </div>

          <div className="px-3 sm:px-4 py-3">
            <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-2">API Request</p>
            <div className="bg-black/40 rounded-xl p-3 font-mono text-[10px] sm:text-[11px] text-gray-400 leading-relaxed overflow-x-auto break-all">
              <span className="text-green-400">POST</span> /api/agent/tasks<br />
              {`{`}<br />
              &nbsp;&nbsp;<span className="text-blue-400">&quot;description&quot;</span>: <span className="text-yellow-300">&quot;{uc.description.slice(0, 55)}...&quot;</span>,<br />
              &nbsp;&nbsp;<span className="text-blue-400">&quot;location&quot;</span>: <span className="text-yellow-300">&quot;{uc.location}&quot;</span>,<br />
              &nbsp;&nbsp;<span className="text-blue-400">&quot;bounty_usdc&quot;</span>: <span className="text-purple-400">{uc.bounty}</span><br />
              {`}`}
            </div>
          </div>

          <div className="px-4 pb-4">
            <button
              onClick={handlePostDemo}
              disabled={posting}
              className="w-full bg-white text-black py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {posting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Posting...
                </span>
              ) : "Post Task via Agent API"}
            </button>
          </div>

          {demoResult && !demoResult.error && (
            <div className="px-4 pb-4 animate-[fadeIn_0.3s_ease-out]">
              <div className="bg-green-500/8 border border-green-500/20 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span className="text-xs font-bold text-green-400">TASK POSTED</span>
                </div>
                <p className="text-[11px] text-gray-400">{demoResult.message}</p>
                <p className="text-[10px] text-gray-600 mt-1.5 font-mono">ID: {demoResult.task?.id?.slice(0, 8)}...</p>
              </div>
            </div>
          )}
        </div>

        {/* How it works */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-3">How It Works</p>
          <div className="flex flex-col gap-3">
            {[
              { step: "1", label: "Post a task", detail: "Describe what you need, set location and USDC bounty", color: "text-blue-400" },
              { step: "2", label: "Verified human claims", detail: "World ID ensures one human, one claim. Orb-verified get priority.", color: "text-purple-400" },
              { step: "3", label: "Proof submitted", detail: "Photo evidence uploaded. Full lifecycle tracked via World Chat.", color: "text-pink-400" },
              { step: "4", label: "AI verifies", detail: "Claude Vision analyzes proof against the task description.", color: "text-orange-400" },
              { step: "5", label: "Paid on-chain", detail: "USDC released from escrow on World Chain. Attestation recorded.", color: "text-green-400" },
            ].map((s) => (
              <div key={s.step} className="flex gap-3 items-start">
                <div className={`w-6 h-6 rounded-full bg-white/5 flex items-center justify-center shrink-0 ${s.color}`}>
                  <span className="text-[11px] font-bold">{s.step}</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-white">{s.label}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tech stack badges */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 py-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <span className="text-[10px] text-gray-600">World ID</span>
          </div>
          <span className="text-gray-800">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            <span className="text-[10px] text-gray-600">World Chat</span>
          </div>
          <span className="text-gray-800">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
            <span className="text-[10px] text-gray-600">World Chain</span>
          </div>
          <span className="text-gray-800">·</span>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /></svg>
            <span className="text-[10px] text-gray-600">Uniswap</span>
          </div>
        </div>
      </div>
    </div>
  );
}
