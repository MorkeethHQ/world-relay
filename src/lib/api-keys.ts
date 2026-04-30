import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";

/* ── Types ─────────────────────────────────────────────────────────── */

export type AgentRecord = {
  agentId: string;
  name: string;
  apiKey: string;
  webhookUrl: string | null;
  createdAt: string;
};

export type ValidateResult = {
  valid: boolean;
  agentId: string | null;
  name: string | null;
};

export type AuthResult = {
  authenticated: boolean;
  agentId: string | null;
};

/* ── Helpers ───────────────────────────────────────────────────────── */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ── Key Generation ────────────────────────────────────────────────── */

export function generateApiKey(): string {
  return `rlk_${randomHex(16)}`;
}

/* ── Register Agent ────────────────────────────────────────────────── */

export async function registerAgent(
  name: string,
  webhookUrl?: string
): Promise<{ agentId: string; apiKey: string; name: string; createdAt: string }> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis is not configured — cannot register agent keys");
  }

  const slug = slugify(name);
  const suffix = randomHex(2); // 4 hex chars
  const agentId = `${slug}-${suffix}`;
  const apiKey = generateApiKey();
  const createdAt = new Date().toISOString();

  const record: AgentRecord = {
    agentId,
    name,
    apiKey,
    webhookUrl: webhookUrl || null,
    createdAt,
  };

  // Store by key for fast lookup during auth
  await redis.set(`apikey:${apiKey}`, JSON.stringify(record));
  // Store by agentId for admin operations
  await redis.set(`agent:${agentId}`, JSON.stringify({ ...record, apiKey: undefined, keyRef: apiKey }));
  // Track all agent IDs
  await redis.sadd("agent_ids", agentId);

  return { agentId, apiKey, name, createdAt };
}

/* ── Validate API Key ──────────────────────────────────────────────── */

export async function validateApiKey(key: string): Promise<ValidateResult> {
  // Legacy env-var key — backwards compat
  const legacyKey = process.env.AGENT_API_KEY;
  if (legacyKey && key === legacyKey) {
    return { valid: true, agentId: "legacy", name: "Legacy API Key" };
  }

  const redis = getRedis();
  if (!redis) {
    return { valid: false, agentId: null, name: null };
  }

  try {
    const raw = await redis.get(`apikey:${key}`);
    if (!raw) {
      return { valid: false, agentId: null, name: null };
    }
    const record: AgentRecord = typeof raw === "string" ? JSON.parse(raw) : (raw as AgentRecord);
    return { valid: true, agentId: record.agentId, name: record.name };
  } catch {
    return { valid: false, agentId: null, name: null };
  }
}

/* ── Get Agent By Key ──────────────────────────────────────────────── */

export async function getAgentByKey(key: string): Promise<AgentRecord | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get(`apikey:${key}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : (raw as AgentRecord);
  } catch {
    return null;
  }
}

/* ── Revoke API Key ────────────────────────────────────────────────── */

export async function revokeApiKey(agentId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const agentRaw = await redis.get(`agent:${agentId}`);
    if (!agentRaw) return false;

    const agentData = typeof agentRaw === "string" ? JSON.parse(agentRaw) : (agentRaw as { keyRef: string });
    const keyRef = agentData.keyRef;

    if (keyRef) {
      await redis.del(`apikey:${keyRef}`);
    }
    await redis.del(`agent:${agentId}`);
    await redis.srem("agent_ids", agentId);

    return true;
  } catch {
    return false;
  }
}

/* ── List Agent Keys (admin) ───────────────────────────────────────── */

export async function listAgentKeys(): Promise<
  Array<{ agentId: string; name: string; webhookUrl: string | null; createdAt: string }>
> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    const ids = await redis.smembers("agent_ids");
    if (!ids || ids.length === 0) return [];

    const agents: Array<{ agentId: string; name: string; webhookUrl: string | null; createdAt: string }> = [];

    for (const id of ids) {
      const raw = await redis.get(`agent:${id}`);
      if (!raw) continue;
      const data = typeof raw === "string" ? JSON.parse(raw) : (raw as AgentRecord);
      agents.push({
        agentId: data.agentId,
        name: data.name,
        webhookUrl: data.webhookUrl || null,
        createdAt: data.createdAt,
      });
    }

    return agents;
  } catch {
    return [];
  }
}

/* ── Shared Auth Helper ────────────────────────────────────────────── */

export async function checkAgentAuth(req: NextRequest): Promise<AuthResult> {
  const auth = req.headers.get("authorization");
  if (!auth) {
    return { authenticated: false, agentId: null };
  }

  const token = auth.replace("Bearer ", "");
  if (!token) {
    return { authenticated: false, agentId: null };
  }

  const result = await validateApiKey(token);
  if (result.valid) {
    return { authenticated: true, agentId: result.agentId };
  }

  return { authenticated: false, agentId: null };
}
