"use client";

import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types (mirrors API response from /api/proof-of-favour)
// ---------------------------------------------------------------------------

type PointsHistoryEntry = {
  action: string;
  points: number;
  timestamp: string;
};

type ProofOfFavour = {
  address: string;
  totalPoints: number;
  level: string;
  favoursAttempted: number;
  favoursCompleted: number;
  favoursPosted: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string;
  pointsHistory: PointsHistoryEntry[];
};

type NextLevelInfo = {
  nextLevel: string;
  pointsNeeded: number;
  progress: number; // 0-1
};

type ApiResponse = {
  profile: ProofOfFavour;
  nextLevel: NextLevelInfo;
};

// ---------------------------------------------------------------------------
// Level key type + config
// ---------------------------------------------------------------------------

type LevelKey = "new" | "local" | "trusted" | "veteran" | "legend";

type LevelConfig = {
  key: LevelKey;
  gradient: string;
  compactGradient: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
  progressColor: string;
  progressBg: string;
};

const LEVEL_CONFIG: Record<string, LevelConfig> = {
  "New Runner": {
    key: "new",
    gradient: "from-gray-800/60 to-gray-900/60",
    compactGradient: "from-gray-800/40 to-gray-900/40",
    badgeBg: "bg-gray-500/15",
    badgeBorder: "border-gray-500/25",
    textColor: "text-gray-300",
    progressColor: "bg-gray-400",
    progressBg: "bg-gray-800",
  },
  "Local Runner": {
    key: "local",
    gradient: "from-emerald-900/40 to-emerald-950/40",
    compactGradient: "from-emerald-900/30 to-emerald-950/30",
    badgeBg: "bg-emerald-500/15",
    badgeBorder: "border-emerald-500/25",
    textColor: "text-emerald-400",
    progressColor: "bg-emerald-500",
    progressBg: "bg-emerald-900/40",
  },
  "Trusted Runner": {
    key: "trusted",
    gradient: "from-blue-900/40 to-blue-950/40",
    compactGradient: "from-blue-900/30 to-blue-950/30",
    badgeBg: "bg-blue-500/15",
    badgeBorder: "border-blue-500/25",
    textColor: "text-blue-400",
    progressColor: "bg-blue-500",
    progressBg: "bg-blue-900/40",
  },
  "Veteran Runner": {
    key: "veteran",
    gradient: "from-purple-900/40 to-purple-950/40",
    compactGradient: "from-purple-900/30 to-purple-950/30",
    badgeBg: "bg-purple-500/15",
    badgeBorder: "border-purple-500/25",
    textColor: "text-purple-400",
    progressColor: "bg-purple-500",
    progressBg: "bg-purple-900/40",
  },
  Legend: {
    key: "legend",
    gradient: "from-amber-900/40 to-yellow-950/40",
    compactGradient: "from-amber-900/30 to-yellow-950/30",
    badgeBg: "bg-amber-500/15",
    badgeBorder: "border-amber-500/25",
    textColor: "text-amber-400",
    progressColor: "bg-gradient-to-r from-amber-500 to-yellow-400",
    progressBg: "bg-amber-900/40",
  },
};

function getLevelConfig(level: string): LevelConfig {
  return LEVEL_CONFIG[level] ?? LEVEL_CONFIG["New Runner"];
}

// ---------------------------------------------------------------------------
// Streak Flame SVG
// ---------------------------------------------------------------------------

function StreakFlame({
  streak,
  size = "md",
}: {
  streak: number;
  size?: "sm" | "md" | "lg";
}) {
  if (streak === 0) {
    return (
      <span className="text-gray-500 text-xs font-medium">No streak</span>
    );
  }

  const sizeMap = { sm: 14, md: 18, lg: 28 };
  const px = sizeMap[size];

  // Color intensity based on streak
  let flameColor: string;
  let glowOpacity: number;
  let pulseClass: string;

  if (streak >= 7) {
    flameColor = "#f97316"; // orange-500
    glowOpacity = 0.6;
    pulseClass = "animate-[flamePulse_1.5s_ease-in-out_infinite]";
  } else if (streak >= 3) {
    flameColor = "#fb923c"; // orange-400
    glowOpacity = 0.3;
    pulseClass = "";
  } else {
    flameColor = "#fdba74"; // orange-300
    glowOpacity = 0;
    pulseClass = "";
  }

  return (
    <span className={`inline-flex items-center gap-1 ${pulseClass}`}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Glow for high streaks */}
        {glowOpacity > 0 && (
          <circle
            cx="12"
            cy="14"
            r="8"
            fill={flameColor}
            opacity={glowOpacity * 0.3}
          />
        )}
        {/* Outer flame */}
        <path
          d="M12 2C12 2 7 8.5 7 13C7 16.5 9.5 19 12 20C14.5 19 17 16.5 17 13C17 8.5 12 2 12 2Z"
          fill={flameColor}
          opacity={0.85}
        />
        {/* Inner flame (lighter core) */}
        <path
          d="M12 8C12 8 9.5 11.5 9.5 14C9.5 16 10.8 17.5 12 18C13.2 17.5 14.5 16 14.5 14C14.5 11.5 12 8 12 8Z"
          fill="#fde68a"
          opacity={0.9}
        />
      </svg>
      <span
        className="text-xs font-bold tabular-nums"
        style={{ color: flameColor }}
      >
        {streak} {streak === 1 ? "day" : "days"}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Level badge icon (SVG)
// ---------------------------------------------------------------------------

function LevelBadge({
  level,
  size = "md",
}: {
  level: string;
  size?: "sm" | "md" | "lg";
}) {
  const config = getLevelConfig(level);
  const sizeMap = { sm: 16, md: 22, lg: 32 };
  const px = sizeMap[size];

  const colorMap: Record<LevelKey, string> = {
    new: "#9ca3af",
    local: "#34d399",
    trusted: "#60a5fa",
    veteran: "#a78bfa",
    legend: "#fbbf24",
  };
  const stroke = colorMap[config.key];

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Star/medal shape */}
      <path d="M12 2L14.5 8.5L21 9.5L16.5 14L17.5 21L12 17.5L6.5 21L7.5 14L3 9.5L9.5 8.5L12 2Z" />
      {config.key === "legend" && (
        <circle cx="12" cy="12" r="3" fill="#fbbf24" opacity={0.4} />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Count-up hook
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }

    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return value;
}

// ---------------------------------------------------------------------------
// Action label formatter
// ---------------------------------------------------------------------------

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    favour_completed: "Favour completed",
    favour_attempted: "Favour attempted",
    favour_claimed: "Favour claimed",
    favour_posted: "Favour posted",
    favour_failed: "Favour failed",
    streak_bonus: "Streak bonus",
    daily_activity: "Daily activity",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

const shimmerBg =
  "bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04] animate-[shimmer_1.5s_infinite]";

function CompactSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-[#111] border border-white/[0.06]">
      <div className={`w-5 h-5 rounded-full shrink-0 ${shimmerBg}`} />
      <div className={`h-3 rounded-md w-16 ${shimmerBg}`} />
      <div className={`h-3 rounded-md w-12 ${shimmerBg}`} />
      <div className="flex-1">
        <div className={`h-1.5 rounded-full w-full ${shimmerBg}`} />
      </div>
    </div>
  );
}

function FullSkeleton() {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4 bg-[#111] border border-white/[0.06]">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full shrink-0 ${shimmerBg}`} />
        <div className="flex-1 flex flex-col gap-1.5">
          <div className={`h-3 rounded-md w-32 ${shimmerBg}`} />
          <div className={`h-5 rounded-md w-24 ${shimmerBg}`} />
        </div>
      </div>
      <div className={`h-2 rounded-full w-full ${shimmerBg}`} />
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-12 rounded-lg ${shimmerBg}`} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-6 rounded-md ${shimmerBg}`} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  address: string;
  compact?: boolean;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProofOfFavourCard({ address, compact = false }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appeared, setAppeared] = useState(false);
  const [progressAnimated, setProgressAnimated] = useState(false);

  // Fetch data
  useEffect(() => {
    if (!address) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/proof-of-favour?address=${encodeURIComponent(address)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ApiResponse) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Trigger appear animation after data loads
  useEffect(() => {
    if (!loading && data) {
      // Small delay so the transition is visible
      const t = setTimeout(() => setAppeared(true), 50);
      return () => clearTimeout(t);
    }
  }, [loading, data]);

  // Trigger progress bar animation after appear
  useEffect(() => {
    if (appeared) {
      const t = setTimeout(() => setProgressAnimated(true), 300);
      return () => clearTimeout(t);
    }
  }, [appeared]);

  // Loading state
  if (loading) {
    return compact ? <CompactSkeleton /> : <FullSkeleton />;
  }

  // Error state
  if (error || !data) {
    return (
      <div className="rounded-xl px-3 py-2 bg-red-950/30 border border-red-800/30 text-red-400 text-xs">
        Failed to load profile{error ? `: ${error}` : ""}
      </div>
    );
  }

  const { profile, nextLevel } = data;
  const config = getLevelConfig(profile.level);

  if (compact) {
    return (
      <CompactCard
        profile={profile}
        nextLevel={nextLevel}
        config={config}
        appeared={appeared}
        progressAnimated={progressAnimated}
      />
    );
  }

  return (
    <FullCard
      profile={profile}
      nextLevel={nextLevel}
      config={config}
      appeared={appeared}
      progressAnimated={progressAnimated}
    />
  );
}

// ---------------------------------------------------------------------------
// Compact card (feed header)
// ---------------------------------------------------------------------------

function CompactCard({
  profile,
  nextLevel,
  config,
  appeared,
  progressAnimated,
}: {
  profile: ProofOfFavour;
  nextLevel: NextLevelInfo;
  config: LevelConfig;
  appeared: boolean;
  progressAnimated: boolean;
}) {
  const displayPoints = useCountUp(appeared ? profile.totalPoints : 0, 600);

  return (
    <div
      className={`
        flex items-center gap-2.5 rounded-xl px-3 py-2.5
        bg-gradient-to-r ${config.compactGradient}
        border border-white/[0.06]
        transition-all duration-500
        ${appeared ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
      `}
    >
      {/* Level badge */}
      <LevelBadge level={profile.level} size="sm" />

      {/* Level name */}
      <span className={`text-[11px] font-semibold ${config.textColor} shrink-0`}>
        {profile.level}
      </span>

      {/* Divider */}
      <span className="w-px h-3.5 bg-white/10 shrink-0" />

      {/* Points */}
      <span className="text-[11px] font-bold text-white tabular-nums shrink-0">
        {displayPoints.toLocaleString()} pts
      </span>

      {/* Streak */}
      <StreakFlame streak={profile.currentStreak} size="sm" />

      {/* Progress bar (fills remaining space) */}
      <div className="flex-1 min-w-[40px]">
        <div className={`h-1.5 rounded-full ${config.progressBg} overflow-hidden`}>
          <div
            className={`h-full rounded-full ${config.progressColor} transition-all duration-1000 ease-out`}
            style={{
              width: progressAnimated ? `${Math.round(nextLevel.progress * 100)}%` : "0%",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full card (profile view)
// ---------------------------------------------------------------------------

function FullCard({
  profile,
  nextLevel,
  config,
  appeared,
  progressAnimated,
}: {
  profile: ProofOfFavour;
  nextLevel: NextLevelInfo;
  config: LevelConfig;
  appeared: boolean;
  progressAnimated: boolean;
}) {
  const displayPoints = useCountUp(appeared ? profile.totalPoints : 0, 1000);
  const displayCompleted = useCountUp(
    appeared ? profile.favoursCompleted : 0,
    800
  );
  const displayAttempted = useCountUp(
    appeared ? profile.favoursAttempted : 0,
    800
  );

  const recentHistory = profile.pointsHistory.slice(-5).reverse();

  const isMaxLevel = nextLevel.pointsNeeded === 0 && nextLevel.progress === 1;

  return (
    <div
      className={`
        rounded-2xl p-5 flex flex-col gap-4
        bg-gradient-to-br ${config.gradient}
        border border-white/[0.08]
        transition-all duration-500
        ${appeared ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
      `}
    >
      {/* Header: branding + level */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <LevelBadge level={profile.level} size="lg" />
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">
              Proof of Favour
            </span>
            <span className={`text-lg font-bold ${config.textColor} leading-tight`}>
              {profile.level}
            </span>
          </div>
        </div>

        {/* Streak */}
        <StreakFlame streak={profile.currentStreak} size="md" />
      </div>

      {/* Points + progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-black text-white tabular-nums">
            {displayPoints.toLocaleString()}
            <span className="text-sm font-semibold text-white/50 ml-1">pts</span>
          </span>
          {!isMaxLevel && (
            <span className="text-[11px] text-white/40 tabular-nums">
              {nextLevel.pointsNeeded.toLocaleString()} to {nextLevel.nextLevel}
            </span>
          )}
          {isMaxLevel && (
            <span className="text-[11px] text-amber-400/70 font-semibold">
              Max level reached
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className={`h-2 rounded-full ${config.progressBg} overflow-hidden`}>
          <div
            className={`h-full rounded-full ${config.progressColor} transition-all duration-1000 ease-out`}
            style={{
              width: progressAnimated
                ? `${Math.round(nextLevel.progress * 100)}%`
                : "0%",
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatBox
          label="Completed"
          value={displayCompleted}
          config={config}
        />
        <StatBox
          label="Attempted"
          value={displayAttempted}
          config={config}
        />
        <StatBox
          label="Longest Streak"
          value={profile.longestStreak}
          suffix="d"
          config={config}
        />
      </div>

      {/* Recent points history */}
      {recentHistory.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
            Recent Activity
          </span>
          {recentHistory.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03]"
            >
              <span className="text-[11px] text-white/60">
                {formatAction(entry.action)}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-emerald-400 tabular-nums">
                  +{entry.points}
                </span>
                <span className="text-[10px] text-white/25 tabular-nums">
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer branding */}
      <div className="flex items-center justify-center pt-1">
        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/15">
          RELAY FAVOURS
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat box
// ---------------------------------------------------------------------------

function StatBox({
  label,
  value,
  suffix,
  config,
}: {
  label: string;
  value: number;
  suffix?: string;
  config: LevelConfig;
}) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center gap-0.5
        rounded-lg py-2.5 px-2
        ${config.badgeBg} border ${config.badgeBorder}
      `}
    >
      <span className="text-base font-bold text-white tabular-nums">
        {value}
        {suffix && (
          <span className="text-[10px] font-semibold text-white/40">{suffix}</span>
        )}
      </span>
      <span className="text-[9px] font-medium text-white/40 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}
