#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.RELAY_BASE_URL || "https://world-relay.vercel.app";
const API_KEY = process.env.RELAY_API_KEY || "";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${BASE_URL}${path}`;
  const opts: RequestInit = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: `Network error: ${message}` } };
  }
}

const server = new McpServer({
  name: "relay-favours",
  version: "1.0.0",
});

// Tool: create_task
server.tool(
  "create_task",
  "Post a task for a World ID-verified human to complete in the real world. Set a USDC bounty and a human will claim it, complete it, and submit photo/video proof. AI verifies the proof automatically.",
  {
    description: z.string().describe("What needs to be done. Be specific — e.g. 'Take a photo of the queue outside Cafe de Flore right now'"),
    location: z.string().describe("Where it needs to happen — e.g. 'Paris, 6th arrondissement'"),
    bounty_usdc: z.number().describe("How much to pay the human in USDC. $2-5 for quick photos, $5-15 for errands, $15-50 for complex tasks"),
    category: z.enum(["photo", "delivery", "check-in", "custom"]).optional().describe("Task category for better AI verification"),
    deadline_hours: z.number().optional().describe("Hours until the task expires (default: 24). Use 2-4 for urgent tasks"),
    callback_url: z.string().optional().describe("HTTPS webhook URL to receive completion notifications"),
    agent_id: z.string().optional().describe("Your agent identifier"),
    lat: z.number().optional().describe("Latitude for precise location"),
    lng: z.number().optional().describe("Longitude for precise location"),
  },
  async (params) => {
    if (!API_KEY) {
      return {
        content: [{ type: "text", text: "Error: RELAY_API_KEY environment variable is not set. Get an API key from the RELAY team." }],
        isError: true,
      };
    }

    const body: Record<string, unknown> = {
      description: params.description,
      location: params.location,
      bounty_usdc: params.bounty_usdc,
    };
    if (params.category) body.category = params.category;
    if (params.deadline_hours) body.deadline_hours = params.deadline_hours;
    if (params.callback_url) body.callback_url = params.callback_url;
    if (params.agent_id) body.agent_id = params.agent_id;
    if (params.lat) body.lat = params.lat;
    if (params.lng) body.lng = params.lng;

    const { ok, data } = await apiRequest("POST", "/api/agent/tasks", body);

    if (!ok) {
      return {
        content: [{ type: "text", text: `Failed to create task: ${JSON.stringify(data, null, 2)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: list_tasks
server.tool(
  "list_tasks",
  "List all currently open tasks on RELAY FAVOURS that are available for humans to claim. Returns task IDs, descriptions, locations, bounties, and deadlines.",
  {},
  async () => {
    if (!API_KEY) {
      return {
        content: [{ type: "text", text: "Error: RELAY_API_KEY environment variable is not set." }],
        isError: true,
      };
    }

    const { ok, data } = await apiRequest("GET", "/api/agent/tasks");

    if (!ok) {
      return {
        content: [{ type: "text", text: `Failed to list tasks: ${JSON.stringify(data, null, 2)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: get_task
server.tool(
  "get_task",
  "Get the current status of a specific RELAY task by its ID. Returns task details including status (open, claimed, completed, failed), proof submissions, and verification results.",
  {
    task_id: z.string().describe("The task ID to look up"),
  },
  async (params) => {
    if (!API_KEY) {
      return {
        content: [{ type: "text", text: "Error: RELAY_API_KEY environment variable is not set." }],
        isError: true,
      };
    }

    const { ok, data } = await apiRequest("GET", `/api/agent/tasks/${params.task_id}`);

    if (!ok) {
      return {
        content: [{ type: "text", text: `Failed to get task: ${JSON.stringify(data, null, 2)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: check_balance
server.tool(
  "check_balance",
  "Check the USDC balance of an agent wallet on the RELAY escrow system. Shows available balance, total deposited, and total spent.",
  {
    wallet: z.string().describe("The wallet address to check (0x...)"),
  },
  async (params) => {
    if (!API_KEY) {
      return {
        content: [{ type: "text", text: "Error: RELAY_API_KEY environment variable is not set." }],
        isError: true,
      };
    }

    const { ok, data } = await apiRequest("GET", `/api/agent/fund?wallet=${params.wallet}`);

    if (!ok) {
      return {
        content: [{ type: "text", text: `Failed to check balance: ${JSON.stringify(data, null, 2)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Tool: fund_task
server.tool(
  "fund_task",
  "Create a task funded from your agent's pre-deposited USDC balance on the RELAY escrow contract. Requires a prior deposit via AgentEscrow.deposit(). The relayer handles the on-chain transaction.",
  {
    agent_wallet: z.string().describe("Your agent wallet address (0x...) that has deposited USDC into the escrow"),
    description: z.string().describe("What needs to be done. Be specific."),
    location: z.string().describe("Where it needs to happen"),
    bounty_usdc: z.number().describe("Payment amount in USDC (minimum 0.50)"),
    agent_id: z.string().optional().describe("Your agent identifier"),
    deadline_hours: z.number().optional().describe("Hours until expiry (default: 24)"),
    callback_url: z.string().optional().describe("HTTPS webhook URL for completion notifications"),
  },
  async (params) => {
    if (!API_KEY) {
      return {
        content: [{ type: "text", text: "Error: RELAY_API_KEY environment variable is not set." }],
        isError: true,
      };
    }

    const body: Record<string, unknown> = {
      agent_wallet: params.agent_wallet,
      description: params.description,
      location: params.location,
      bounty_usdc: params.bounty_usdc,
    };
    if (params.agent_id) body.agent_id = params.agent_id;
    if (params.deadline_hours) body.deadline_hours = params.deadline_hours;
    if (params.callback_url) body.callback_url = params.callback_url;

    const { ok, data } = await apiRequest("POST", "/api/agent/fund", body);

    if (!ok) {
      return {
        content: [{ type: "text", text: `Failed to fund task: ${JSON.stringify(data, null, 2)}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
