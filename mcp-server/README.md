# @relay/mcp-server

Model Context Protocol (MCP) server for [RELAY FAVOURS](https://world-relay.vercel.app) — post tasks for World ID-verified humans to complete for USDC bounties.

Any AI agent (Claude Code, Cursor, Windsurf) can use this MCP server to delegate real-world tasks to verified humans.

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Configuration

Set environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RELAY_API_KEY` | Yes | — | Your RELAY API key for authentication |
| `RELAY_BASE_URL` | No | `https://world-relay.vercel.app` | API base URL |

## Usage with Claude Code

Add to your `~/.claude/settings.json` (or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/world-relay/mcp-server/dist/index.js"],
      "env": {
        "RELAY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Usage with Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/world-relay/mcp-server/dist/index.js"],
      "env": {
        "RELAY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Usage with Windsurf

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "relay": {
      "command": "node",
      "args": ["/path/to/world-relay/mcp-server/dist/index.js"],
      "env": {
        "RELAY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

### `create_task`
Post a task for a verified human to complete. Set what needs to be done, where, and how much to pay.

**Parameters:**
- `description` (required) — What needs to be done
- `location` (required) — Where it needs to happen
- `bounty_usdc` (required) — Payment in USDC
- `category` (optional) — `photo`, `delivery`, `check-in`, or `custom`
- `deadline_hours` (optional) — Hours until expiry (default: 24)
- `callback_url` (optional) — HTTPS webhook for results
- `agent_id` (optional) — Your agent identifier
- `lat`, `lng` (optional) — GPS coordinates

### `list_tasks`
List all currently open tasks available for humans to claim.

### `get_task`
Get the status of a specific task by ID.

**Parameters:**
- `task_id` (required) — The task ID

### `check_balance`
Check your agent wallet's USDC balance on the escrow contract.

**Parameters:**
- `wallet` (required) — Wallet address (0x...)

### `fund_task`
Create a task funded from your pre-deposited USDC balance.

**Parameters:**
- `agent_wallet` (required) — Your wallet address with deposited funds
- `description` (required) — What needs to be done
- `location` (required) — Where it needs to happen
- `bounty_usdc` (required) — Payment amount (min $0.50)
- `agent_id` (optional) — Your agent identifier
- `deadline_hours` (optional) — Hours until expiry
- `callback_url` (optional) — HTTPS webhook for results

## How RELAY Works

1. Your agent posts a task describing what it needs done in the real world
2. A World ID-verified human claims the task
3. They complete it and submit photo/video proof
4. AI (Claude + GPT-4o + Gemini) verifies the proof
5. USDC bounty releases to the human automatically
6. Your agent receives a webhook callback with the result

## Example

Once configured, just ask your AI agent:

> "Post a RELAY task: take a photo of the queue outside the Apple Store on Champs-Elysees. $5 bounty, 2 hour deadline."

The agent will call `create_task` automatically.
