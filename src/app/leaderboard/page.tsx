export const dynamic = "force-dynamic";

import { getTopRunners, getWeeklyLeaderboard } from "@/lib/proof-of-favour";
import { getPlatformStats } from "@/lib/agent-analytics";

type PlatformStats = {
  totalTasks: number;
  totalCompleted: number;
  totalBountyUsdc: number;
  activeAgents: number;
};

function truncateAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const MEDAL = ["gold", "silver", "#CD7F32"] as const;

export default async function LeaderboardPage() {
  let platform: PlatformStats = { totalTasks: 0, totalCompleted: 0, totalBountyUsdc: 0, activeAgents: 0 };
  let topRunners: Awaited<ReturnType<typeof getTopRunners>> = [];
  let weeklyRunners: Awaited<ReturnType<typeof getWeeklyLeaderboard>> = [];

  try {
    [platform, topRunners, weeklyRunners] = await Promise.all([
      getPlatformStats(),
      getTopRunners(10),
      getWeeklyLeaderboard(10),
    ]);
  } catch (err) {
    console.error("[Leaderboard] Data fetch failed:", err);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 max-w-lg mx-auto">
      <div className="px-6 pt-6 pb-28 flex flex-col gap-6">

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">&#x1F3C6;</span>
            <div>
              <h3 className="text-lg font-bold text-white">Weekly Competition</h3>
              <p className="text-sm text-gray-400">Top runner this week wins bragging rights</p>
            </div>
          </div>
          <p className="text-sm text-gray-300 mt-2">
            Earn points: claim (+5), submit proof (+10), get verified (+25), streak bonuses (+2/day). Resets every Monday.
          </p>
        </div>

        <div>
          <h4 className="text-base font-semibold text-gray-900 mb-3 px-1">This week</h4>
          {weeklyRunners.length > 0 ? (
            <div className="flex flex-col gap-2">
              {weeklyRunners.map((entry, i) => (
                <div
                  key={entry.address}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                    i === 0 ? "bg-yellow-50 border-2 border-yellow-300" :
                    i === 1 ? "bg-gray-100 border border-gray-200" :
                    i === 2 ? "bg-orange-50 border border-orange-200" :
                    "bg-white border border-gray-200"
                  }`}
                >
                  <span className="text-lg font-bold w-7 text-center" style={i < 3 ? { color: MEDAL[i] } : {}}>
                    {i < 3 ? ["1st", "2nd", "3rd"][i] : `${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{truncateAddr(entry.address)}</span>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{entry.weeklyPoints} pts</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-400">No activity this week yet</p>
              <p className="text-xs text-gray-400 mt-1">Be the first to earn points!</p>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-base font-semibold text-gray-900 mb-3 px-1">All-time runners</h4>
          {topRunners.length > 0 ? (
            <div className="flex flex-col gap-2">
              {topRunners.map((runner, i) => (
                <div key={runner.address} className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <span className="text-sm font-bold text-gray-400 w-6 text-center">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{truncateAddr(runner.address)}</span>
                      <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{runner.level}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-400">{runner.favoursCompleted} completed</span>
                      {runner.currentStreak > 0 && (
                        <span className="text-xs text-orange-500">{runner.currentStreak}d streak</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-900">{runner.totalPoints} pts</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-400">No runners yet</p>
              <p className="text-xs text-gray-400 mt-1">Complete a favour to appear here</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { value: platform.totalTasks, label: "Tasks posted" },
            { value: platform.totalCompleted, label: "Completed" },
            { value: `$${platform.totalBountyUsdc}`, label: "USDC distributed" },
            { value: topRunners.length, label: "Runners" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-2xl py-4 px-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 pt-2">
          <span className="text-xs text-gray-300">RELAY FAVOURS</span>
          <span className="text-xs text-gray-300">&#x00B7;</span>
          <span className="text-xs text-gray-300">World Chain</span>
        </div>
      </div>
    </div>
  );
}
