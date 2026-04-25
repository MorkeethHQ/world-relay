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
  | { type: "about" }
  | { type: "nearby" }
  | { type: "default" };

function parseIntent(query: string): QueryIntent {
  const q = query.toLowerCase().trim();

  // About
  if (
    q === "about" ||
    q === "team" ||
    q === "who built relay" ||
    q === "who built relay?" ||
    q === "who made relay" ||
    q === "who made relay?" ||
    q === "what is relay" ||
    q === "what is relay?" ||
    q === "who are you" ||
    q === "who are you?"
  ) {
    return { type: "about" };
  }

  // Nearby
  if (
    q === "nearby" ||
    q === "near me" ||
    q === "close" ||
    q === "close by" ||
    q === "around here" ||
    q === "what's nearby" ||
    q === "whats nearby" ||
    q === "tasks nearby" ||
    q === "local" ||
    q === "local tasks"
  ) {
    return { type: "nearby" };
  }

  // Help
  if (q === "help" || q === "explain" || q === "intro") {
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
    "\u{1F680} RELAY — Real-world tasks, verified by AI, paid in USDC",
    "",
    "AI agents post micro-bounties. Humans complete them. Earn USDC on World Chain.",
    "",
    "\u{1F50D} Try these commands:",
    '  "tasks near Seoul" — by location',
    '  "over $1" — by bounty amount',
    '  "photo tasks" — by category',
    '  "PriceHawk tasks" — by AI agent',
    '  "nearby" — all open tasks',
    '  "stats" — network stats',
    '  "about" — about RELAY',
    "",
    `\u{1F310} ${BASE_URL}`,
  ].join("\n");
}

function formatAbout(): string {
  return [
    "\u{1F30D} RELAY — Trust Protocol for World Build 3",
    "",
    "AI agents post bounties. World ID-verified humans complete real-world tasks. Get paid in USDC on World Chain.",
    "",
    "\u{1F527} How it works:",
    "1. AI agents post micro-bounties",
    "2. Humans claim + complete tasks",
    "3. AI verifies proof photos",
    "4. USDC settles on-chain",
    "",
    "\u{1F464} Built by Oscar Morkeeth (Staff PM @ Ledger) with Claude Code.",
    "One human orchestrator + AI implementation.",
    "",
    `\u{1F310} ${BASE_URL}`,
  ].join("\n");
}

function formatNearby(tasks: Task[]): string {
  const openTasks = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (openTasks.length === 0) {
    return `No open tasks right now. Check back soon!\n\n\u{1F310} ${BASE_URL}`;
  }

  const list = openTasks
    .slice(0, 5)
    .map((t, i) => [
      `${i + 1}. ${t.description.slice(0, 60)}`,
      `   \u{1F4CD} ${t.location} | \u{1F4B0} $${t.bountyUsdc} USDC`,
      `   ${BASE_URL}/task/${t.id}`,
    ].join("\n"))
    .join("\n\n");

  return [
    `\u{1F4CD} ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"} (most recent first):`,
    "",
    list,
    openTasks.length > 5 ? `\n...and ${openTasks.length - 5} more at ${BASE_URL}` : "",
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
    "\u{1F4CA} RELAY Network Stats",
    "\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}\u{2501}",
    "",
    `\u{1F4CB} Tasks: ${tasks.length} total`,
    `   \u{1F7E2} Open: ${open.length}`,
    `   \u{1F7E1} Claimed: ${claimed.length}`,
    `   ✅ Completed: ${completed.length}`,
    "",
    `\u{1F4B0} Bounties`,
    `   Total: $${totalBounty.toFixed(2)} USDC`,
    `   Available: $${openBounty.toFixed(2)} USDC`,
    "",
    "\u{1F916} Top AI Agents",
    topAgents || "   No agent tasks yet",
    "",
    `\u{1F310} ${BASE_URL}`,
  ].join("\n");
}

/** Truncate response to stay within XMTP message size limits */
function truncateResponse(text: string, maxLen = 1000): string {
  if (text.length <= maxLen) return text;
  const suffix = `\n...\n\u{1F310} ${BASE_URL}`;
  return text.slice(0, maxLen - suffix.length) + suffix;
}

export async function processAgentQuery(query: string): Promise<string> {
  const tasks = await listTasks();
  const openTasks = tasks.filter((t) => t.status === "open");
  const intent = parseIntent(query);

  let response: string;

  switch (intent.type) {
    case "help":
      response = formatHelp();
      break;

    case "about":
      response = formatAbout();
      break;

    case "nearby":
      response = formatNearby(tasks);
      break;

    case "stats":
      response = await formatStats(tasks);
      break;

    case "location": {
      const keyword = intent.keyword.toLowerCase();
      const matched = openTasks.filter(
        (t) =>
          t.location.toLowerCase().includes(keyword) ||
          t.description.toLowerCase().includes(keyword),
      );
      if (matched.length === 0) {
        response = `No open tasks found matching "${intent.keyword}". Try "stats" to see what's available or browse ${BASE_URL}`;
        break;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      response = [
        `Found ${matched.length} open task${matched.length === 1 ? "" : "s"} matching "${intent.keyword}":`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
      break;
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
        response = `No open tasks match that bounty filter. ${openTasks.length} tasks available at ${BASE_URL}`;
        break;
      }

      // Sort by bounty for display
      if (intent.direction === "high") {
        filtered.sort((a, b) => b.bountyUsdc - a.bountyUsdc);
      } else {
        filtered.sort((a, b) => a.bountyUsdc - b.bountyUsdc);
      }

      const list = filtered.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      response = [
        `${label}:`,
        "",
        list,
        filtered.length > 5 ? `\n...and ${filtered.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
      break;
    }

    case "category": {
      const matched = openTasks.filter((t) => t.category === intent.category);
      if (matched.length === 0) {
        response = `No open ${intent.category} tasks right now. Check ${BASE_URL} for all available tasks.`;
        break;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      response = [
        `${matched.length} open ${intent.category} task${matched.length === 1 ? "" : "s"}:`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
      break;
    }

    case "agent": {
      const agent = AGENT_REGISTRY[intent.agentId];
      const matched = openTasks.filter(
        (t) => t.agent?.id === intent.agentId,
      );
      if (matched.length === 0) {
        response = `No open tasks from ${agent?.name || intent.agentId} right now. Check ${BASE_URL} for all tasks.`;
        break;
      }
      const list = matched.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      response = [
        `${agent?.icon || ""} ${agent?.name || intent.agentId} has ${matched.length} open task${matched.length === 1 ? "" : "s"}:`,
        "",
        list,
        matched.length > 5 ? `\n...and ${matched.length - 5} more. Browse all: ${BASE_URL}` : "",
      ].join("\n");
      break;
    }

    case "default": {
      if (openTasks.length === 0) {
        response = `No open tasks right now. Check back soon or browse ${BASE_URL}`;
        break;
      }
      const sorted = [...openTasks].sort((a, b) => b.bountyUsdc - a.bountyUsdc);
      const list = sorted.slice(0, 5).map((t, i) => formatTask(t, i + 1)).join("\n\n");
      response = [
        `Top open tasks by bounty:`,
        "",
        list,
        openTasks.length > 5 ? `\n${openTasks.length - 5} more available. Browse all: ${BASE_URL}` : "",
        "",
        'Send "help" to learn more about RELAY.',
      ].join("\n");
      break;
    }
  }

  return truncateResponse(response);
}
