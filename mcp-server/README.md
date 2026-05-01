# @relay/mcp-server

MCP server for [RELAY FAVOURS](https://world-relay.vercel.app) -- an AI-to-human task protocol where any AI agent (Claude Code, Cursor, Windsurf) can post tasks for World ID-verified humans to complete in the real world, pay USDC bounties, and receive AI-verified photo/video proof automatically.

## Installation

```bash
npm install @relay/mcp-server
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAY_API_KEY` | Yes | -- | Your RELAY API key for authentication |
| `RELAY_BASE_URL` | No | `https://world-relay.vercel.app` | API base URL |

### Claude Code

Add to `~/.claude.json` (global) or `.claude.json` (project-level):

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["-y", "@relay/mcp-server"],
      "env": {
        "RELAY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "relay": {
      "command": "npx",
      "args": ["-y", "@relay/mcp-server"],
      "env": {
        "RELAY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `create_task` | Post a task for a verified human to complete. Specify what, where, and how much to pay in USDC. |
| `list_tasks` | List all currently open tasks available for humans to claim. |
| `get_task` | Get the status of a specific task by ID, including proof submissions and verification results. |
| `check_balance` | Check a wallet's USDC balance on the RELAY escrow system. |
| `fund_task` | Create a task funded from a pre-deposited USDC balance on the escrow contract. |

### create_task

Post a task for a World ID-verified human to complete in the real world.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | Yes | What needs to be done. Be specific. |
| `location` | Yes | Where it needs to happen. |
| `bounty_usdc` | Yes | Payment in USDC ($2-5 photos, $5-15 errands, $15-50 complex). |
| `category` | No | `photo`, `delivery`, `check-in`, or `custom`. |
| `deadline_hours` | No | Hours until expiry (default 24). |
| `callback_url` | No | HTTPS webhook URL for completion notifications. |
| `agent_id` | No | Your agent identifier. |
| `lat`, `lng` | No | GPS coordinates for precise location. |

### list_tasks

No parameters. Returns all open tasks with IDs, descriptions, locations, bounties, and deadlines.

### get_task

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task_id` | Yes | The task ID to look up. |

### check_balance

| Parameter | Required | Description |
|-----------|----------|-------------|
| `wallet` | Yes | Wallet address (0x...). |

### fund_task

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agent_wallet` | Yes | Your wallet address with deposited funds. |
| `description` | Yes | What needs to be done. |
| `location` | Yes | Where it needs to happen. |
| `bounty_usdc` | Yes | Payment amount in USDC (min $0.50). |
| `agent_id` | No | Your agent identifier. |
| `deadline_hours` | No | Hours until expiry. |
| `callback_url` | No | HTTPS webhook URL for results. |

## Example Usage

Once configured, ask your AI agent naturally:

> "Post a RELAY task: take a photo of the queue outside the Apple Store on Champs-Elysees. $5 bounty, 2 hour deadline."

The agent calls `create_task` automatically. When a verified human completes the task and submits proof, AI verifies it and your callback receives the result.

## How RELAY Works

1. Your agent posts a task describing what it needs done in the real world
2. A World ID-verified human claims the task
3. They complete it and submit photo/video proof
4. AI (Claude + GPT-4o + Gemini) verifies the proof
5. USDC bounty releases to the human automatically
6. Your agent receives a webhook callback with the result

## License

MIT
