import { listTasks } from "./store";
import type { Task } from "./types";

export type AgentStats = {
  agentId: string;
  name: string;
  icon: string;
  totalTasks: number;
  openTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  successRate: number; // 0-100
  avgConfidence: number; // 0-1
  totalSpentUsdc: number;
  avgBountyUsdc: number;
  avgCompletionHours: number | null;
};

export type PlatformStats = {
  totalTasks: number;
  totalCompleted: number;
  totalBountyUsdc: number;
  activeAgents: number;
};

function isAgentTask(task: Task): boolean {
  if (task.agent) return true;
  if (task.poster.startsWith("agent_") || task.poster.startsWith("agent:")) return true;
  return false;
}

function getAgentKey(task: Task): { id: string; name: string; icon: string } {
  if (task.agent) {
    return { id: task.agent.id, name: task.agent.name, icon: task.agent.icon };
  }
  // Derive from poster prefix
  const id = task.poster.replace(/^agent[_:]/, "");
  return { id, name: id, icon: "🤖" };
}

export async function getAgentAnalytics(agentId?: string): Promise<AgentStats[]> {
  const allTasks = await listTasks();
  const agentTasks = allTasks.filter(isAgentTask);

  // Group by agent ID
  const grouped = new Map<string, { info: { id: string; name: string; icon: string }; tasks: Task[] }>();

  for (const task of agentTasks) {
    const key = getAgentKey(task);
    const existing = grouped.get(key.id);
    if (existing) {
      existing.tasks.push(task);
    } else {
      grouped.set(key.id, { info: key, tasks: [task] });
    }
  }

  // Calculate stats per agent
  const stats: AgentStats[] = [];

  for (const [, { info, tasks }] of grouped) {
    if (agentId && info.id !== agentId) continue;

    const completedTasks = tasks.filter((t) => t.status === "completed");
    const failedTasks = tasks.filter((t) => t.status === "failed");
    const cancelledTasks = tasks.filter((t) => t.status === "cancelled");
    const openTasks = tasks.filter((t) => t.status === "open");

    const resolvedCount = completedTasks.length + failedTasks.length;
    const successRate = resolvedCount > 0 ? (completedTasks.length / resolvedCount) * 100 : 0;

    // Average confidence from tasks with verification results
    const tasksWithVerification = tasks.filter((t) => t.verificationResult !== null);
    const avgConfidence =
      tasksWithVerification.length > 0
        ? tasksWithVerification.reduce((sum, t) => sum + t.verificationResult!.confidence, 0) /
          tasksWithVerification.length
        : 0;

    const totalSpentUsdc = completedTasks.reduce((sum, t) => sum + t.bountyUsdc, 0);
    const avgBountyUsdc = tasks.length > 0 ? tasks.reduce((sum, t) => sum + t.bountyUsdc, 0) / tasks.length : 0;

    stats.push({
      agentId: info.id,
      name: info.name,
      icon: info.icon,
      totalTasks: tasks.length,
      openTasks: openTasks.length,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      cancelledTasks: cancelledTasks.length,
      successRate: Math.round(successRate * 100) / 100,
      avgConfidence: Math.round(avgConfidence * 1000) / 1000,
      totalSpentUsdc: Math.round(totalSpentUsdc * 100) / 100,
      avgBountyUsdc: Math.round(avgBountyUsdc * 100) / 100,
      avgCompletionHours: null,
    });
  }

  // Sort by totalTasks descending
  stats.sort((a, b) => b.totalTasks - a.totalTasks);

  return stats;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const allTasks = await listTasks();
  const agentTasks = allTasks.filter(isAgentTask);

  const uniqueAgents = new Set<string>();
  for (const task of agentTasks) {
    uniqueAgents.add(getAgentKey(task).id);
  }

  const completedTasks = agentTasks.filter((t) => t.status === "completed");
  const totalBountyUsdc = agentTasks.reduce((sum, t) => sum + t.bountyUsdc, 0);

  return {
    totalTasks: agentTasks.length,
    totalCompleted: completedTasks.length,
    totalBountyUsdc: Math.round(totalBountyUsdc * 100) / 100,
    activeAgents: uniqueAgents.size,
  };
}
