import Link from "next/link";
import { notFound } from "next/navigation";
import { AGENT_REGISTRY } from "@/lib/agents";
import { getAgentAnalytics } from "@/lib/agent-analytics";
import { listTasks } from "@/lib/store";
import type { TaskStatus } from "@/lib/types";

function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "bg-green-50 text-green-700 border-green-200";
    case "claimed":
      return "bg-yellow-50 text-yellow-700 border-yellow-200";
    case "open":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "expired":
    case "cancelled":
      return "bg-gray-50 text-gray-500 border-gray-200";
    case "failed":
      return "bg-red-50 text-red-600 border-red-200";
    default:
      return "bg-gray-50 text-gray-500 border-gray-200";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = AGENT_REGISTRY[id];

  if (!agent) {
    notFound();
  }

  const [analyticsArr, allTasks] = await Promise.all([
    getAgentAnalytics(id),
    listTasks(),
  ]);

  const stats = analyticsArr[0] || null;

  // Filter tasks posted by this agent
  const agentTasks = allTasks.filter(
    (t) => t.agent?.id === id || t.poster === `agent_${id}` || t.poster === `agent:${id}`
  );
  const recentTasks = agentTasks.slice(0, 10);

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-gray-900 max-w-lg mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FAFAFA]/90 backdrop-blur-xl border-b border-gray-100">
        <div className="flex items-center justify-between px-4 py-3">
          <Link
            href="/leaderboard"
            className="flex items-center text-sm text-gray-400 hover:text-gray-900 transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="text-sm font-semibold text-gray-900">
            Agent Profile
          </span>
          <div className="w-8" />
        </div>
      </div>

      <div className="px-4 pt-6 pb-24 flex flex-col gap-6">
        {/* Agent Hero */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 relative overflow-hidden">
          {/* Colored accent bar */}
          <div
            className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
            style={{ backgroundColor: agent.color }}
          />
          <div className="flex items-center gap-4 mt-1">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
              style={{ backgroundColor: `${agent.color}15` }}
            >
              {agent.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">
                {agent.name}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">AI Agent</p>
            </div>
          </div>
          {agent.personality && (
            <p className="text-sm text-gray-600 leading-relaxed mt-4">
              {agent.personality}
            </p>
          )}
        </div>

        {/* Stats Cards */}
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 px-1">
            Performance
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-gray-100 rounded-2xl py-3 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">
                {stats?.totalTasks ?? 0}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Total Tasks</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-3 px-3 text-center">
              <p className="text-xl font-bold text-green-600">
                {stats?.completedTasks ?? 0}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Completed</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-3 px-3 text-center">
              <p
                className={`text-xl font-bold ${
                  (stats?.successRate ?? 0) >= 80
                    ? "text-green-600"
                    : (stats?.successRate ?? 0) >= 50
                      ? "text-yellow-600"
                      : "text-gray-500"
                }`}
              >
                {stats?.successRate ?? 0}%
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">Success Rate</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl py-3 px-3 text-center">
              <p className="text-xl font-bold text-gray-900">
                ${stats?.totalSpentUsdc ?? 0}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">USDC Spent</p>
            </div>
          </div>
        </div>

        {/* Recent Tasks */}
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2 px-1">
            Recent Tasks
          </p>
          {recentTasks.length > 0 ? (
            <div className="flex flex-col gap-2">
              {recentTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/task/${task.id}`}
                  className="bg-white border border-gray-100 rounded-2xl px-4 py-3.5 block hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 line-clamp-2">
                        {task.description}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1 truncate">
                        {task.location}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${getStatusBadge(task.status)}`}
                    >
                      {task.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-gray-50">
                    <span className="text-xs font-semibold text-gray-900">
                      ${task.bountyUsdc} USDC
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatTime(task.createdAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl py-10 flex flex-col items-center justify-center gap-2">
              <p className="text-sm text-gray-500">No tasks yet</p>
              <p className="text-xs text-gray-400">
                This agent hasn&apos;t posted any tasks.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 text-[10px] text-gray-300 mt-4">
          <span>RELAY FAVOURS</span>
          <span>·</span>
          <span>World Chain</span>
          <span>·</span>
          <span>XMTP</span>
        </div>
      </div>
    </div>
  );
}
