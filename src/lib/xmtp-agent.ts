import { listTasks } from "./store";
import type { Task, TaskCategory } from "./types";
import { AGENT_REGISTRY } from "./agents";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// XMTP Agent – Natural Language Query Processor
// Handles DM-style queries about RELAY tasks so
// users can discover, filter, and explore bounties
// through conversational XMTP messages.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BASE_URL = "https://world-relay.vercel.app";

type QueryIntent =
  | { type: "location"; keyword: string }
  | { type: "bounty"; direction: "high" | "low"; threshold?: number }
  | { type: "category"; category: TaskCategory }
  | { type: "agent"; agentId: string }
  | { type: "stats" }
  | { type: "help" }
  | { type: "default" };

function parseIntent(query: string): QueryIntent {
  const q = query.toLowerCase().trim();

  // Help
  if (q === "help" || q === "what is relay" || q === "what is relay?" || q === "explain" || q === "intro") {
    return { type: "help" };
  }

  // Stats
  if (q === "stats" || q === "how many tasks" || q === "how many tasks?" || q === "statistics" || q === "numbers") {
    return { type: "stats" };
  }

  // Bounty queries
  const bountyOverMatch = q.match(/(?:over|above|more than|>\s*)\$?(\d+(?:\.\d+)?)/);
  if (bountyOverMatch) {
    return { type: "bounty", direction: "high", threshold: parseFloat(bountyOverMatch[1]) };
  }
  const bountyUnderMatch = q.match(/(?:under|below|less than|cheaper than|<\s*)\$?(\d+(?:\.\d+)?)/);
  if (bountyUnderMatch) {
    return { type: "bounty", direction: "low", threshold: parseFloat(bountyUnderMatch[1]) };
  }
  if (q.includes("high bounty") || q.includes("highest bounty") || q.includes("best paying") || q.includes("top bounty") || q.includes("expensive")) {
    return { type: "bounty", direction: "high" };
  }
  if (q.includes("cheap") || q.includes("low bounty") || q.includes("lowest bounty") || q.includes("affordable")) {
    return { type: "bounty", direction: "low" };
  }

  // Category queries
  if (q.includes("photo") || q.includes("picture") || q.includes("image")) {
    return { type: "category", category: "photo" };
  }
  if (q.includes("check-in") || q.includes("checkin") || q.includes("check in")) {
    return { type: "category", category: "check-in" };
  }
  if (q.includes("delivery") || q.includes("deliver")) {
    return { type: "category", category: "delivery" };
  }
  if (q.includes("custom")) {
    return { type: "category", category: "custom" };
  }

  // Agent queries
  for (const [id, agent] of Object.entries(AGENT_REGISTRY)) {
    if (q.includes(id) || q.includes(agent.name.toLowerCase())) {
      return { type: "agent", agentId: id };
    }
  }

  // Location queries – match common patterns
  const locationPatterns = [
    /(?:near|around|close to|by)\s+(.+)/,
    /(?:in|at)\s+(.+)/,
    /(.+?)\s+tasks?$/,
    /tasks?\s+(?:in|at|near)\s+(.+)/,
  ];
  for (const pattern of locationPatterns) {
    const match = q.match(pattern);
    if (match) {
      const keyword = match[1].trim().replace(/[?.!]/g, "");
      // Avoid false positives for other intents
      if (keyword.length > 1 && !["me", "the", "a", "my", "this"].includes(keyword)) {
        return { type: "location", keyword };
      }
    }
  }

  return { type: "default" };
}

function formatTask(task: Task, index: number): string {
  const agentLabel = task.agent ? ` ${task.agent.icon} ${task.agent.name}` : "";
  const statusIcon = task.status === "open" ? "OPEN" : task.status === "claimed" ? "CLAIMED" : task.status.toUpperCase();
  return [
    `${index}. ${task.description.slice(0, 80)}${task.description.length > 80 ? "..." : ""}`,
    `   ${task.location} | $${task.bountyUsdc} USDC | ${statusIcon}${agentLabel}`,
    `   ${BASE_URL}/task/${task.id}`,
  ].join("\n");
}

function formatHelp(): string {
  return [
    "RELAY — Real-world tasks, verified by AI, paid in USDC",
    "",
    "RELAY is a task network where AI agents post micro-bounties and humans complete them. Take a photo, check a queue, verify a listing — earn USDC on World Chain.",
    "",
    "Ask me anything:",
    '  "tasks near Seoul" — find tasks by location',
    '  "over $1" — filter by bounty amount',
    '  "photo tasks" — filter by category',
    '  "PriceHawk tasks" — filter by AI agent',
    '  "stats" — network statistics',
    "",
    `Explore all tasks: ${BASE_URL}`,
  ].join("\n");
}

async function formatStats(tasks: Task[]): Promise<string> {
  const open = tasks.filter((t) => t.status === "open");
  const claimed = tasks.filter((t) => t.status === "claimed");
  const completed = tasks.filter((t) => t.status === "completed");
  const totalBounty = tasks.reduce((sum, t) => sum + t.bountyUsdc, 0);
  const openBounty = open.reduce((sum, t) => sum + t.bountyUsdc, 0);

  const agentCounts = new Map<string, number>();
  for (const t of tasks) {
    if (t.agent) {
      agentCounts.set(t.agent.name, (agentCounts.get(t.agent.name) || 0) + 1);
    }
  }
  const topAgents = Array.from(agentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `  ${name}: ${count} tasks`)
    .join("\n");

  return [
    "RELAY Network Stats",
    "---",
    `Total tasks: ${tasks.length}`,
    `Open: ${open.length} | Claimed: ${claimed.length} | Completed: ${completed.length}`,
    `Total bounties: $${totalBounty.toFixed(2)} USDC`,
    `Available bounties: $${openBounty.toFixed(2)} USDC`,
    "",
    "Top AI agents:",
    topAgents || "  No agent tasks yet",
    "",
    `Explore: ${BASE_URL}`,
  ].join("\n");
}

export async function processAgentQuery(query: string): Promise<string> {
  const tasks = await listTasks();
  const openTasks = tasks.filter((t) => t.status === "open");
  const intent = parseIntent(query);

  switch (intent.type) {
    case "help":
      return formatHelp();

    case "stats":
      return formatStats(tasks);

    case "location": {
      const keyword = intent.keyword.toLowerCase();
      const matched = openTasks.filter(
        (t) =>
          t.location.toLowerCase().includes(keyword) ||
          t.description.toLowerCase().includes(keyword),
      );
      if (matched.length === 0) {
        return `No open tasks found matching "${intent.keyword}". Try "stats" to see what's available or browse ${BASE_URL}`;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      return [
        `Found ${matched.length} open task${matched.length === 1 ? "" : "s"} matching "${intent.keyword}":`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
    }

    case "bounty": {
      let filtered: Task[];
      let label: string;
      if (intent.threshold !== undefined) {
        if (intent.direction === "high") {
          filtered = openTasks.filter((t) => t.bountyUsdc > intent.threshold!);
          label = `Open tasks with bounty over $${intent.threshold}`;
        } else {
          filtered = openTasks.filter((t) => t.bountyUsdc < intent.threshold!);
          label = `Open tasks with bounty under $${intent.threshold}`;
        }
      } else {
        filtered = [...openTasks].sort((a, b) =>
          intent.direction === "high" ? b.bountyUsdc - a.bountyUsdc : a.bountyUsdc - b.bountyUsdc,
        );
        label = intent.direction === "high" ? "Highest-paying open tasks" : "Most affordable open tasks";
      }

      if (filtered.length === 0) {
        return `No open tasks match that bounty filter. ${openTasks.length} tasks available at ${BASE_URL}`;
      }

      // Sort by bounty for display
      if (intent.direction === "high") {
        filtered.sort((a, b) => b.bountyUsdc - a.bountyUsdc);
      } else {
        filtered.sort((a, b) => a.bountyUsdc - b.bountyUsdc);
      }

      const list = filtered.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      return [
        `${label}:`,
        "",
        list,
        filtered.length > 5 ? `\n...and ${filtered.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
    }

    case "category": {
      const matched = openTasks.filter((t) => t.category === intent.category);
      if (matched.length === 0) {
        return `No open ${intent.category} tasks right now. Check ${BASE_URL} for all available tasks.`;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      return [
        `${matched.length} open ${intent.category} task${matched.length === 1 ? "" : "s"}:`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
    }

    case "agent": {
      const agent = AGENT_REGISTRY[intent.agentId];
      const matched = openTasks.filter(
        (t) => t.agent?.id === intent.agentId,
      );
      if (matched.length === 0) {
        return `No open tasks from ${agent?.name || intent.agentId} right now. Check ${BASE_URL} for all tasks.`;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      return [
        `${agent?.icon || ""} ${agent?.name || intent.agentId} has ${matched.length} open task${matched.length === 1 ? "" : "s"}:`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
    }

    case "default": {
      if (openTasks.length === 0) {
        return `No open tasks right now. Check back soon or browse ${BASE_URL}`;
      }
      const sorted = [...openTasks].sort((a, b) => b.bountyUsdc - a.bountyUsdc);
      const list = sorted.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      return [
        `Top open tasks by bounty:`,
        "",
        list,
        openTasks.length > 5 ? `\n${openTasks.length - 5} more available. Browse all: ${BASE_URL}` : "",
        "",
        'Send "help" to learn more about RELAY.',
      ].join("\n");
    }
  }
}
