"use client";

import { useMemo } from "react";
import type { Task } from "@/lib/types";
import type { Campaign } from "@/lib/campaigns";
import { Button, Pill } from "@worldcoin/mini-apps-ui-kit-react";
import { useWorldUsers, displayName } from "@/hooks/useWorldUser";
import { CategoryIcon } from "@/components/CategoryIcon";
import { RewardBadge } from "@/components/RewardBadge";

function timeLeft(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const days = Math.floor(ms / (24 * 3600_000));
  if (days > 0) return `${days}d left`;
  const hours = Math.floor(ms / 3600_000);
  return `${hours}h left`;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}


export function CampaignPage({
  campaign,
  tasks,
  userId,
  onBack,
  onTaskTap,
  onSubmitProof,
}: {
  campaign: Campaign;
  tasks: Task[];
  userId: string | null;
  onBack: () => void;
  onTaskTap: (task: Task) => void;
  onSubmitProof: (task: Task) => void;
}) {
  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === "open" && new Date(t.deadline).getTime() > Date.now()),
    [tasks]
  );
  const completedTasks = useMemo(
    () => tasks.filter((t) => t.status === "completed"),
    [tasks]
  );
  const claimedTasks = useMemo(
    () => tasks.filter((t) => t.status === "claimed"),
    [tasks]
  );

  // Points and real money are tracked strictly separately — never show points as $.
  const totalPaidUsdc = completedTasks.reduce((sum, t) => sum + (t.rewardType !== "points" && t.escrowTxHash ? t.bountyUsdc : 0), 0);
  const totalPoints = completedTasks.reduce((sum, t) => sum + (t.rewardType === "points" ? t.bountyUsdc : 0), 0);
  const progressPct = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;

  const contributors = useMemo(() => {
    const map = new Map<string, { address: string; count: number; points: number; usdc: number }>();
    for (const t of completedTasks) {
      if (!t.claimant) continue;
      const e = map.get(t.claimant) || { address: t.claimant, count: 0, points: 0, usdc: 0 };
      e.count++;
      if (t.rewardType === "points") e.points += t.bountyUsdc;
      else if (t.escrowTxHash) e.usdc += t.bountyUsdc;
      map.set(t.claimant, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [completedTasks]);

  const proofImages = useMemo(
    () =>
      completedTasks
        .filter((t) => t.proofImageUrl)
        .map((t) => ({ url: t.proofImageUrl!, description: t.description, id: t.id }))
        .slice(0, 6),
    [completedTasks]
  );

  const allAddresses = useMemo(
    () => [...new Set(tasks.flatMap((t) => [t.poster, t.claimant].filter(Boolean) as string[]))],
    [tasks]
  );
  useWorldUsers(allAddresses);

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto w-full bg-gray-50">
      {/* Hero - full bleed photo */}
      <div className="relative overflow-hidden">
        {campaign.heroImage ? (
          <>
            <img src={campaign.heroImage} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
            {/* Vertical scrim: dark at top (back button) and bottom (content) */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/75" />
          </>
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${campaign.heroGradient}`} />
        )}

        <div className="relative px-6 pt-14 pb-10">
          {/* Back button */}
          <button
            onClick={onBack}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform border border-white/10"
            aria-label="Go back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Campaign identity */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1.5 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[11px] font-medium text-white/80 tracking-wide">LIVE CAMPAIGN</span>
            </div>
            <h1 className="text-[28px] font-bold text-white leading-[1.15] tracking-tight mb-2">
              {campaign.name}
            </h1>
            <p className="text-[15px] text-white/70 leading-relaxed max-w-[300px]">
              {campaign.tagline}
            </p>
          </div>

          {/* Inline stats */}
          <div className="flex items-center gap-5">
            <div>
              <p className="text-2xl font-bold text-white">{totalPoints}{totalPaidUsdc > 0 ? `+$${totalPaidUsdc.toFixed(0)}` : ""}</p>
              <p className="text-[11px] text-white/40 mt-0.5">{totalPaidUsdc > 0 ? "pts + USDC" : "pts given"}</p>
            </div>
            <div className="w-px h-8 bg-white/15" />
            <div>
              <p className="text-2xl font-bold text-white">{completedTasks.length}</p>
              <p className="text-[11px] text-white/40 mt-0.5">verified</p>
            </div>
            <div className="w-px h-8 bg-white/15" />
            <div>
              <p className="text-2xl font-bold text-green-400">{openTasks.length}</p>
              <p className="text-[11px] text-white/40 mt-0.5">available</p>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-5">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${progressPct}%`,
                  background: "linear-gradient(90deg, #4ade80, #22d3ee)",
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-white/40">
                {completedTasks.length} of {tasks.length} tasks completed
              </span>
              <span className="text-[11px] text-white/40">{timeLeft(campaign.endsAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="px-5 -mt-3 pb-8 flex flex-col gap-5">

        {/* Quick info chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          <span className="shrink-0 inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-2 text-xs text-gray-600 shadow-sm">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {campaign.location}
          </span>
          <span className="shrink-0 inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-2 text-xs text-gray-600 shadow-sm">
            ${campaign.rewardPerTask}+ per task
          </span>
          <span className="shrink-0 inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-2 text-xs text-gray-600 shadow-sm">
            AI-verified
          </span>
          {campaign.categories.map((cat) => (
            <span key={cat} className="shrink-0 inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-3 py-2 text-xs text-gray-500 shadow-sm">
              <CategoryIcon category={cat} size={12} /> {cat}
            </span>
          ))}
        </div>

        {/* Description card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <p className="text-[14px] text-gray-600 leading-[1.65]">{campaign.description}</p>
        </div>

        {/* Proof gallery */}
        {proofImages.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-gray-900">Verified completions</h3>
              <span className="text-xs text-gray-400">{completedTasks.length} total</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 rounded-2xl overflow-hidden">
              {proofImages.map((img) => (
                <div key={img.id} className="relative aspect-square">
                  <img src={img.url} alt={img.description} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  <div className="absolute bottom-1.5 left-1.5 right-1.5">
                    <div className="flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      <span className="text-[9px] font-bold text-white/90 truncate">{img.description.slice(0, 25)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contributors */}
        {contributors.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-gray-900">Top contributors</h3>
              <span className="text-xs text-gray-400">{contributors.length} people</span>
            </div>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {contributors.slice(0, 6).map((c, i) => (
                <div key={c.address} className="shrink-0 bg-white border border-gray-200 rounded-2xl p-4 w-[130px] flex flex-col items-center gap-2 shadow-sm">
                  <div className="relative">
                    <div className="w-11 h-11 rounded-full bg-gray-900 flex items-center justify-center">
                      <span className="text-sm font-bold text-white">{c.address.slice(-2).toUpperCase()}</span>
                    </div>
                    {i === 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 rounded-full flex items-center justify-center text-[9px] font-bold text-yellow-900 border-2 border-white">1</span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-gray-900 truncate max-w-full">{displayName(c.address)}</p>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-gray-900">{c.points} pts{c.usdc > 0 ? ` · $${c.usdc}` : ""}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{c.count} {c.count === 1 ? "task" : "tasks"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available tasks */}
        {openTasks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-gray-900">Available now</h3>
              <span className="text-xs text-success-600 font-medium">{openTasks.length} tasks</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {openTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => onTaskTap(task)}
                  className="bg-white border border-gray-200 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-all shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 shrink-0">
                      <CategoryIcon category={task.category} size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-gray-900 leading-snug break-words">{task.description}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-gray-400 truncate max-w-[140px]">{task.location}</span>
                        <span className="text-xs text-gray-300">&middot;</span>
                        <span className="text-xs text-gray-400">{timeAgo(task.createdAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <RewardBadge task={task} size="sm" />
                    </div>
                  </div>
                  {userId && task.poster !== userId && (
                    <Button
                      onClick={(e) => { e.stopPropagation(); onSubmitProof(task); }}
                      variant="primary"
                      fullWidth
                      size="lg"
                      className="mt-3"
                    >
                      Do it{task.escrowTxHash ? ` — earn $${task.bountyUsdc}` : ""}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed tasks (if no open ones) */}
        {openTasks.length === 0 && completedTasks.length > 0 && (
          <div className="bg-white border border-success-200 rounded-2xl p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#29A352" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-gray-900">Campaign complete</p>
            <p className="text-xs text-gray-400 mt-1">{totalPoints} pts{totalPaidUsdc > 0 ? ` and $${totalPaidUsdc.toFixed(2)} USDC` : ""} to {contributors.length} contributors</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <span className="text-[10px] text-gray-300">Powered by RELAY</span>
          <span className="text-[10px] text-gray-300">&middot;</span>
          <span className="text-[10px] text-gray-300">AI-verified on World Chain</span>
        </div>
      </div>
    </div>
  );
}

export function FeaturedCampaignBanner({
  campaign,
  taskCount,
  completedCount,
  onTap,
}: {
  campaign: Campaign;
  taskCount: number;
  completedCount: number;
  onTap: () => void;
}) {
  const remaining = taskCount - completedCount;

  return (
    <div
      onClick={onTap}
      className="relative rounded-2xl overflow-hidden cursor-pointer active:scale-[0.98] transition-all"
    >
      {campaign.heroImage ? (
        <>
          <img src={campaign.heroImage} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          {/* Dark scrim, heaviest on the left so the white text stays legible */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/20" />
        </>
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${campaign.heroGradient}`} />
      )}
      <div className="relative px-5 py-5 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] font-medium text-white/60 tracking-wide uppercase">Campaign</span>
          </div>
          <h3 className="text-[15px] font-bold text-white leading-tight">{campaign.name}</h3>
          <p className="text-xs text-white/50 mt-1">{remaining} tasks &middot; ${campaign.rewardPerTask}+ each</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" className="shrink-0">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
}
