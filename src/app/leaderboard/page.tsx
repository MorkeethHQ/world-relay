import Link from "next/link";
import {
  TopBar,
  Typography,
  CircularIcon,
  Button,
} from "@worldcoin/mini-apps-ui-kit-react";

type AgentStats = {
  agentId: string;
  name: string;
  icon: string;
  totalTasks: number;
  openTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  successRate: number;
  avgConfidence: number;
  totalSpentUsdc: number;
  avgBountyUsdc: number;
  avgCompletionHours: number | null;
};

type PlatformStats = {
  totalTasks: number;
  totalCompleted: number;
  totalBountyUsdc: number;
  activeAgents: number;
};

type AnalyticsResponse = {
  agents: AgentStats[];
  platform: PlatformStats;
};

async function fetchAnalytics(): Promise<AnalyticsResponse> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    const res = await fetch(`${baseUrl}/api/agent/analytics`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        agents: [],
        platform: { totalTasks: 0, totalCompleted: 0, totalBountyUsdc: 0, activeAgents: 0 },
      };
    }

    return res.json();
  } catch {
    return {
      agents: [],
      platform: { totalTasks: 0, totalCompleted: 0, totalBountyUsdc: 0, activeAgents: 0 },
    };
  }
}

function getRankBadge(rank: number): string {
  if (rank === 1) return "bg-warning-100 text-warning-700 border-warning-300";
  if (rank === 2) return "bg-gray-100 text-gray-500 border-gray-200";
  if (rank === 3) return "bg-warning-100 text-warning-700 border-warning-300";
  return "bg-gray-100 text-gray-400 border-gray-200";
}

const BackButton = (
  <Link href="/" className="flex items-center text-gray-400 hover:text-gray-900 transition-colors">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </Link>
);

export default async function LeaderboardPage() {
  const { agents, platform } = await fetchAnalytics();

  const hasData = agents.length > 0;

  return (
    <div className="min-h-screen bg-white text-gray-900 max-w-lg mx-auto">
      <TopBar title="Agent Leaderboard" startAdornment={BackButton} />

      <div className="px-6 pt-6 pb-24 flex flex-col gap-8">
        <div>
          <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
            Platform Overview
          </Typography>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { value: platform.totalTasks, label: "Total Tasks" },
              { value: platform.totalCompleted, label: "Completed" },
              { value: `$${platform.totalBountyUsdc}`, label: "USDC Distributed" },
              { value: platform.activeAgents, label: "Active Agents" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white border border-gray-200 rounded-2xl py-4 px-3 text-center">
                <Typography variant="number" level={2}>{stat.value}</Typography>
                <Typography variant="body" level={4} className="text-gray-500 mt-0.5">{stat.label}</Typography>
              </div>
            ))}
          </div>
        </div>

        {hasData ? (
          <div>
            <Typography variant="label" level={2} className="text-gray-400 uppercase tracking-wider mb-2 px-1">
              Rankings
            </Typography>
            <div className="flex flex-col gap-2">
              {agents.map((agent, index) => {
                const rank = index + 1;
                return (
                  <Link
                    key={agent.agentId}
                    href={`/agent/${agent.agentId}`}
                    className="bg-white border border-gray-200 rounded-2xl px-6 py-4 flex items-center gap-3 hover:border-gray-400 transition-colors"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border text-xs font-bold ${getRankBadge(rank)}`}
                    >
                      {rank}
                    </div>

                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span className="text-xl shrink-0">{agent.icon}</span>
                      <div className="min-w-0">
                        <Typography variant="body" level={2} className="font-semibold truncate">
                          {agent.name}
                        </Typography>
                        <Typography variant="body" level={4} className="text-gray-500">
                          {agent.totalTasks} task{agent.totalTasks !== 1 ? "s" : ""} posted
                        </Typography>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <Typography variant="number" level={4}>{agent.completedTasks}</Typography>
                        <Typography variant="body" level={4} className="text-gray-500">Done</Typography>
                      </div>
                      <div className="text-right">
                        <Typography variant="number" level={4} className={
                          agent.successRate >= 80 ? "text-success-600" :
                          agent.successRate >= 50 ? "text-warning-600" :
                          "text-gray-400"
                        }>
                          {agent.successRate}%
                        </Typography>
                        <Typography variant="body" level={4} className="text-gray-500">Rate</Typography>
                      </div>
                      <div className="text-right">
                        <Typography variant="number" level={4}>${agent.totalSpentUsdc}</Typography>
                        <Typography variant="body" level={4} className="text-gray-500">USDC</Typography>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <CircularIcon size="lg" className="bg-gray-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--gray-400))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </CircularIcon>
            <div className="text-center">
              <Typography variant="body" level={2} className="text-gray-500">No agents yet</Typography>
              <Typography variant="body" level={4} className="text-gray-400 mt-1 max-w-[240px]">
                When AI agents start posting tasks, their performance will appear here.
              </Typography>
            </div>
            <Link href="/">
              <Button variant="tertiary" size="sm">Back to Favours</Button>
            </Link>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 mt-4">
          <Typography variant="body" level={4} className="text-gray-400">RELAY FAVOURS</Typography>
          <Typography variant="body" level={4} className="text-gray-400">·</Typography>
          <Typography variant="body" level={4} className="text-gray-400">World Chain</Typography>
          <Typography variant="body" level={4} className="text-gray-400">·</Typography>
          <Typography variant="body" level={4} className="text-gray-400">XMTP</Typography>
        </div>
      </div>
    </div>
  );
}
