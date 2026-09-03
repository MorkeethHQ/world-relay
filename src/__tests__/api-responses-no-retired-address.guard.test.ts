/**
 * GUARD: no API response, route source or agent-facing doc carries a retired
 * escrow address.
 *
 * 2026-09-03: POST /api/agent/tasks answered 201 "no money moves" and, in the
 * same body, `escrow_contract: 0x274C…9351` (the retired v1 UUPS proxy). The
 * keyless discovery endpoint GET /api/agent advertised 0xbF20…DD98 (the retired
 * "V2 Agent Escrow", itself replaced then abandoned). A bot author reading
 * either would send USDC to a dead contract.
 *
 * Ruling (coordinator, 2026-09-03): a response that says no money moves carries
 * NO contract address. The two literals may live only in src/lib (historical,
 * read-only accounting), the task page's clearly-named legacy constant (pinned
 * by public-surface-retired-address.guard), and the retired-address guard tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const RETIRED_V1 = /0x274C38eA9944f57D24A59fbEf558bba2264f9351/i;
const RETIRED_AGENT_V2 = /0xbF2002356EC592460c3F71ad27D169402cA1DD98/i;
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(p);
  }
  return out;
}

vi.hoisted(() => {
  process.env.AGENT_API_KEY = "rlk_no_retired_address_guard";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

vi.mock("@/lib/store", () => ({
  createTask: async (input: Record<string, unknown>) => ({
    id: "g1",
    status: "open",
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    agent: null,
    onChainId: input.onChainId ?? null,
    escrowTxHash: input.escrowTxHash ?? null,
    rewardType: input.rewardType || "points",
    ...input,
  }),
  listTasks: async () => [],
  getTask: async () => null,
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/xmtp", () => ({ postTaskCreated: async () => {} }));
vi.mock("@/lib/sse", () => ({ broadcastEvent: () => {} }));
vi.mock("@/lib/ai-chat", () => ({ generateLocationBriefing: async () => null }));
vi.mock("@/lib/messages", () => ({ addMessage: async () => {} }));
vi.mock("@/lib/escrow", () => ({
  isEscrowTaskFunded: async () => false,
  createEscrowTaskWithKey: async () => null,
}));

beforeEach(() => {
  // The route falls back to the retired literal if the env is set to it; the
  // fix removes the field entirely, so the env must not matter. Pin the worst
  // case anyway.
  process.env.NEXT_PUBLIC_ESCROW_ADDRESS = "0x274C38eA9944f57D24A59fbEf558bba2264f9351";
});

describe("route sources and agent-facing docs", () => {
  it("no file under src/app/api contains either retired address", () => {
    const offenders = walk(join(ROOT, "src/app/api")).filter((p) => {
      const s = readFileSync(p, "utf8");
      return RETIRED_V1.test(s) || RETIRED_AGENT_V2.test(s);
    });
    expect(offenders, "retired escrow literal in an API route source").toEqual([]);
  });

  it("the docs a bot is pointed at carry no retired address", () => {
    const docs = ["AGENT.md", "docs/AGENT-DOOR.md", "LAUNCH-NOTE.md"]
      .map((f) => join(ROOT, f))
      .filter((p) => existsSync(p));
    expect(docs.length).toBeGreaterThan(0);
    const offenders = docs.filter((p) => {
      const s = readFileSync(p, "utf8");
      return RETIRED_V1.test(s) || RETIRED_AGENT_V2.test(s);
    });
    expect(offenders, "retired escrow literal in an agent-facing doc").toEqual([]);
  });
});

describe("live response bodies", () => {
  it("GET /api/agent (keyless discovery) publishes no contract address", async () => {
    const { GET } = await import("@/app/api/agent/route");
    const body = await (await GET()).json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(RETIRED_V1);
    expect(text).not.toMatch(RETIRED_AGENT_V2);
    expect(body.platform.escrow_contract).toBeNull();
    expect(body.platform.escrow_note).toMatch(/no money moves/);
  });

  it("GET /api/agent/openapi.json neither documents nor requires escrow_contract on the 201", async () => {
    const { GET } = await import("@/app/api/agent/openapi.json/route");
    const body = await (await GET()).json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(RETIRED_V1);
    expect(text).not.toMatch(RETIRED_AGENT_V2);
    expect(text).not.toMatch(/escrow_contract/);
    expect(text).not.toMatch(/fund_url/);
  });

  it("POST /api/agent/tasks 201 says no money moves and carries no address", async () => {
    const { POST } = await import("@/app/api/agent/tasks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer rlk_no_retired_address_guard" },
        body: JSON.stringify({ description: "Photo of the sign at 12 Rue de Rivoli", location: "Paris", bounty_usdc: 3 }),
      }) as never,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(body).not.toHaveProperty("escrow_contract");
    expect(text).not.toMatch(RETIRED_V1);
    expect(text).not.toMatch(RETIRED_AGENT_V2);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    // The message copy itself ("points ... no money moves") is pinned by
    // agent-door.test.ts; this guard owns the address, not the sentence.
  });
});
