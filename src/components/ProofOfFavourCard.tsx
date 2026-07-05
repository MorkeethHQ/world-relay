"use client";

import { useState, useEffect, useRef } from "react";
import { Typography } from "@worldcoin/mini-apps-ui-kit-react";
import { Card } from "./ui/Card";
import { Section } from "./ui/Section";
import { Stat } from "./ui/Stat";

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
    gradient: "from-gray-50 to-gray-100",
    compactGradient: "from-gray-50 to-gray-100",
    badgeBg: "bg-gray-100",
    badgeBorder: "border-gray-200",
    textColor: "text-gray-500",
    progressColor: "bg-gray-400",
    progressBg: "bg-gray-200",
  },
  "Local Runner": {
    key: "local",
    gradient: "from-success-100 to-success-200",
    compactGradient: "from-success-100 to-success-200",
    badgeBg: "bg-success-100",
    badgeBorder: "border-[#A7E8BE]",
    textColor: "text-success-700",
    progressColor: "bg-success-700",
    progressBg: "bg-success-200",
  },
  "Trusted Runner": {
    key: "trusted",
    gradient: "from-gray-100 to-gray-200",
    compactGradient: "from-gray-100 to-gray-200",
    badgeBg: "bg-gray-100",
    badgeBorder: "border-gray-200",
    textColor: "text-gray-900",
    progressColor: "bg-gray-900",
    progressBg: "bg-gray-200",
  },
  "Veteran Runner": {
    key: "veteran",
    gradient: "from-gray-100 to-gray-200",
    compactGradient: "from-gray-100 to-gray-200",
    badgeBg: "bg-gray-100",
    badgeBorder: "border-gray-400",
    textColor: "text-gray-900",
    progressColor: "bg-gray-500",
    progressBg: "bg-gray-200",
  },
  Legend: {
    key: "legend",
    gradient: "from-[#FFF8E1] to-[#FFF3E0]",
    compactGradient: "from-[#FFF8E1] to-[#FFF3E0]",
    badgeBg: "bg-[#FFF8E1]",
    badgeBorder: "border-[#FDE68A]",
    textColor: "text-warning-600",
    progressColor: "bg-gradient-to-r from-warning-600 to-warning-500",
    progressBg: "bg-[#FEF3C7]",
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
      <span className="text-gray-400 text-xs font-medium">No streak</span>
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
    new: "#9BA3AE",
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
  "bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 animate-[shimmer_1.5s_infinite]";

function CompactSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-gray-50 border border-gray-200">
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
    <Card className="flex flex-col gap-4">
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
    </Card>
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
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [freezeMsg, setFreezeMsg] = useState<string | null>(null);

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
      <div className="rounded-xl px-3 py-2 bg-red-50 border border-red-200 text-red-600 text-xs" role="alert">
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
        border border-gray-200
        transition-all duration-500
        ${appeared ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
      `}
    >
      {/* Level badge */}
      <LevelBadge level={profile.level} size="sm" />

      {/* Level name */}
      <span className={`text-xs font-semibold ${config.textColor} shrink-0`}>
        {profile.level}
      </span>

      {/* Divider */}
      <span className="w-px h-3.5 bg-gray-400 shrink-0" />

      {/* Points */}
      <span className="text-xs font-bold text-gray-900 tabular-nums shrink-0">
        {displayPoints.toLocaleString()} pts
      </span>

      {/* Streak */}
      <StreakFlame streak={profile.currentStreak} size="sm" />

      {/* Progress bar (fills remaining space) */}
      <div className="flex-1 min-w-[40px]">
        <div
          className={`h-1.5 rounded-full ${config.progressBg} overflow-hidden`}
          role="progressbar"
          aria-valuenow={Math.round(nextLevel.progress * 100)}
          aria-valuemax={100}
        >
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
        border border-gray-200
        transition-all duration-500
        ${appeared ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
      `}
    >
      {/* Header: branding + level */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <LevelBadge level={profile.level} size="lg" />
          <div className="flex flex-col">
            <Typography
              variant="body"
              level={4}
              className="uppercase tracking-[0.15em] text-gray-400"
            >
              Proof of Favour
            </Typography>
            <Typography
              variant="heading"
              level={4}
              className={`${config.textColor} leading-tight`}
            >
              {profile.level}
            </Typography>
          </div>
        </div>

        {/* Streak */}
        <StreakFlame streak={profile.currentStreak} size="md" />
      </div>

      {/* Points + progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-black text-gray-900 tabular-nums">
            {displayPoints.toLocaleString()}
            <span className="text-sm font-semibold text-gray-400 ml-1">pts</span>
          </span>
          {!isMaxLevel && (
            <span className="text-xs text-gray-400 tabular-nums">
              {nextLevel.pointsNeeded.toLocaleString()} to {nextLevel.nextLevel}
            </span>
          )}
          {isMaxLevel && (
            <span className="text-xs text-warning-600/70 font-semibold">
              Max level reached
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div
          className={`h-2 rounded-full ${config.progressBg} overflow-hidden`}
          role="progressbar"
          aria-valuenow={Math.round(nextLevel.progress * 100)}
          aria-valuemax={100}
        >
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

      {/* Stats grid (shared <Stat> primitive, themed per level) */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat
          label="Completed"
          value={displayCompleted}
          surfaceClassName={`${config.badgeBg} border ${config.badgeBorder}`}
        />
        <Stat
          label="Attempted"
          value={displayAttempted}
          surfaceClassName={`${config.badgeBg} border ${config.badgeBorder}`}
        />
        <Stat
          label="Best streak"
          value={profile.longestStreak}
          suffix={profile.longestStreak === 1 ? " day" : " days"}
          surfaceClassName={`${config.badgeBg} border ${config.badgeBorder}`}
        />
      </div>

      {/* Streak freeze — the first points sink. One freeze absorbs one missed
          day; buy with points, hold max 2. */}
      <div className="flex items-center justify-between rounded-xl bg-white/60 border border-gray-200 px-3.5 py-3">
        <div>
          <p className="text-[13px] font-semibold text-gray-900">
            Streak freeze {((profile as { streakFreezes?: number }).streakFreezes || 0) > 0 ? `· ${(profile as { streakFreezes?: number }).streakFreezes} held` : ""}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">Covers one missed day. 30 pts each, hold 2.</p>
        </div>
        <button
          onClick={async () => {
            if (!address || freezeBusy) return;
            setFreezeBusy(true);
            setFreezeMsg(null);
            try {
              const res = await fetch("/api/proof-of-favour/freeze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address }),
              });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) {
                setFreezeMsg(typeof d.error === "string" ? d.error : "Couldn't buy a freeze");
              } else {
                setFreezeMsg(null);
                setData((prev) => prev ? { ...prev, profile: { ...prev.profile, totalPoints: d.totalPoints, streakFreezes: d.streakFreezes } as typeof prev.profile } : prev);
              }
            } catch {
              setFreezeMsg("Network hiccup, try again");
            }
            setFreezeBusy(false);
          }}
          disabled={freezeBusy}
          className="shrink-0 bg-gray-900 text-white text-[12px] font-semibold px-3.5 py-2 rounded-full active:scale-95 transition-transform disabled:opacity-50"
        >
          {freezeBusy ? "..." : "Buy freeze"}
        </button>
      </div>
      {freezeMsg && <p className="text-[11px] text-red-600 -mt-2">{freezeMsg}</p>}

      {/* Recent points history */}
      {recentHistory.length > 0 && (
        <Section eyebrow="Recent Activity" className="gap-1.5">
          {recentHistory.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/60"
            >
              <Typography variant="body" level={4} className="text-gray-500">
                {formatAction(entry.action)}
              </Typography>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-success-700 tabular-nums">
                  +{entry.points}
                </span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Footer branding */}
      <div className="flex items-center justify-center pt-1">
        <Typography
          variant="body"
          level={4}
          className="uppercase tracking-[0.2em] text-gray-400"
        >
          RELAY FAVOURS
        </Typography>
      </div>
    </div>
  );
}

