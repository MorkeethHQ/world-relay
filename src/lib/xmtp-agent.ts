import Anthropic from "@anthropic-ai/sdk";
import { listTasks, createTask, getTask } from "./store";
import type { Task } from "./types";
import { AGENT_REGISTRY } from "./agents";
import { getTodaysChallenge } from "./daily-challenge";

const BASE_URL = "https://world-relay.vercel.app";

function buildNetworkContext(tasks: Task[]): string {
  const open = tasks.filter(t => t.status === "open");
  const completed = tasks.filter(t => t.status === "completed");
  const claimed = tasks.filter(t => t.status === "claimed");
  const funded = open.filter(t => t.escrowTxHash);
  const totalBounty = open.reduce((sum, t) => sum + t.bountyUsdc, 0);

  const topTasks = [...open]
    .sort((a, b) => {
      const af = a.escrowTxHash ? 1 : 0;
      const bf = b.escrowTxHash ? 1 : 0;
      if (af !== bf) return bf - af;
      return b.bountyUsdc - a.bountyUsdc;
    })
    .slice(0, 8)
    .map(t => {
      const agent = t.agent ? `[${t.agent.name}]` : "";
      const tag = t.escrowTxHash ? "USDC" : "pts";
      return `- "${t.description.slice(0, 70)}" — ${t.location} — $${t.bountyUsdc} ${tag} ${agent} (id: ${t.id})`;
    })
    .join("\n");

  const recentActivity = [...completed, ...claimed]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4)
    .map(t => {
      const action = t.status === "completed" ? "completed" : "claimed";
      const verdict = t.verificationResult?.verdict;
      return `- ${action}: "${t.description.slice(0, 50)}" — ${verdict ? `verified: ${verdict}` : "in progress"}`;
    })
    .join("\n");

  const agents = Object.values(AGENT_REGISTRY)
    .map(a => `${a.name}: ${a.personality?.slice(0, 60) || "AI agent"}`)
    .join(", ");

  const challenge = getTodaysChallenge();

  return `NETWORK STATE:
- ${open.length} open (${funded.length} funded with USDC), ${claimed.length} in progress, ${completed.length} completed
- $${totalBounty.toFixed(0)} in available favours
- AI agents: ${agents}
- Daily challenge: "${challenge.title}"

TOP AVAILABLE:
${topTasks || "None right now."}

RECENT ACTIVITY:
${recentActivity || "Nothing yet."}`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_favour",
    description: "Post a new favour/task for a verified human to complete. Use when the user asks to post, create, or relay a task.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "What needs to be done" },
        location: { type: "string", description: "Where — address, city, or 'Anywhere'" },
        bountyUsdc: { type: "number", description: "Reward in USDC (default 3)" },
        category: { type: "string", enum: ["photo", "check-in", "delivery", "custom"], description: "Task category" },
      },
      required: ["description", "location"],
    },
  },
  {
    name: "check_task",
    description: "Check the status of a specific task by ID. Use when user asks about a task status or result.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "The task ID to check" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "list_tasks",
    description: "List available tasks, optionally filtered. Use when user asks what's available, what they can do, or wants to browse.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: { type: "string", enum: ["open", "funded", "completed", "all"], description: "Filter type" },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are the RELAY FAVOURS assistant. You help people find, complete, and post real-world favours.

CONTEXT: AI agents hit dead-ends in the physical world — stale data, failed deliveries, unverifiable states, ambiguous locations. They post favours for verified humans to close the loop. Humans verify, confirm, inspect, photograph — and earn USDC or points.

YOU CAN:
- Create favours for users ("relay this: check if Blue Bottle is open" → create_favour)
- Check task status ("what happened to my task?" → check_task)
- Browse available tasks ("what can I do?" → list_tasks)

RULES:
- 1-2 sentences max. Be extremely brief. No walls of text.
- Never use emojis. Never use markdown bold (**text**). Plain text only.
- Look at conversation history. Never repeat a task you already mentioned.
- "hi" or "sup" = one short sentence greeting. Don't pitch tasks.
- Only mention specific tasks when asked.
- If someone says "relay this" or "post this" or "create a task", use create_favour.
- If someone asks about status or results, use check_task.
- Sound like a person, not a bot. Chill.

URL: ${BASE_URL}`;

async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId?: string
): Promise<string> {
  if (toolName === "create_favour") {
    const desc = String(toolInput.description || "");
    const loc = String(toolInput.location || "Anywhere");
    const bounty = Number(toolInput.bountyUsdc) || 3;
    const cat = String(toolInput.category || "custom") as "photo" | "check-in" | "delivery" | "custom";

    const task = createTask({
      poster: userId || "chat-user",
      category: cat,
      description: desc,
      location: loc,
      bountyUsdc: bounty,
      deadlineHours: 24,
    });

    return `Created favour "${desc.slice(0, 60)}" in ${loc} for ${bounty} pts. ID: ${task.id}`;
  }

  if (toolName === "check_task") {
    const id = String(toolInput.taskId || "");
    const task = await getTask(id);
    if (!task) return "Task not found.";

    const lines = [
      `"${task.description.slice(0, 60)}"`,
      `Status: ${task.status}`,
      `Location: ${task.location}`,
      `Reward: ${task.escrowTxHash ? `$${task.bountyUsdc} USDC` : `${task.bountyUsdc * 10} pts`}`,
    ];
    if (task.claimant) lines.push(`Claimed by: ${task.claimant.slice(0, 8)}...`);
    if (task.verificationResult) {
      lines.push(`Verdict: ${task.verificationResult.verdict} (${Math.round(task.verificationResult.confidence * 100)}%)`);
      lines.push(`Reason: ${String(task.verificationResult.reasoning).slice(0, 100)}`);
    }
    return lines.join("\n");
  }

  if (toolName === "list_tasks") {
    const filter = String(toolInput.filter || "open");
    const allTasks = await listTasks();
    let filtered = allTasks;
    if (filter === "open") filtered = allTasks.filter(t => t.status === "open");
    if (filter === "funded") filtered = allTasks.filter(t => t.status === "open" && t.escrowTxHash);
    if (filter === "completed") filtered = allTasks.filter(t => t.status === "completed");

    if (filtered.length === 0) return `No ${filter} tasks right now.`;

    return filtered
      .sort((a, b) => (b.escrowTxHash ? 1 : 0) - (a.escrowTxHash ? 1 : 0) || b.bountyUsdc - a.bountyUsdc)
      .slice(0, 5)
      .map(t => {
        const tag = t.escrowTxHash ? "USDC" : "pts";
        return `- $${t.bountyUsdc} ${tag}: "${t.description.slice(0, 60)}" (${t.location})`;
      })
      .join("\n");
  }

  return "Unknown tool.";
}

export async function processAgentQuery(
  query: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
  userId?: string
): Promise<string> {
  const tasks = await listTasks();
  const context = buildNetworkContext(tasks);

  if (!process.env.ANTHROPIC_API_KEY) {
    const open = tasks.filter(t => t.status === "open");
    if (open.length === 0) return "No tasks available right now. Check back soon.";
    const top = open.sort((a, b) => b.bountyUsdc - a.bountyUsdc)[0];
    return `Top favour: "${top.description.slice(0, 60)}" in ${top.location} for $${top.bountyUsdc}. Browse at ${BASE_URL}`;
  }

  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [];
  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-6);
    messages.push(...recent);
  }
  messages.push({
    role: "user",
    content: `${query}\n\n[LIVE CONTEXT]\n${context}`,
  });

  try {
    let response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Handle tool use loop (max 3 iterations)
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 3) {
      iterations++;
      const toolBlock = response.content.find(b => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") break;

      const toolResult = await handleToolCall(toolBlock.name, toolBlock.input as Record<string, unknown>, userId);

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolBlock.id, content: toolResult }],
      });

      response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    }

    const text = response.content.find(b => b.type === "text");
    return text && text.type === "text" ? text.text : "Done.";
  } catch {
    return "Something went wrong. Try again in a sec.";
  }
}
