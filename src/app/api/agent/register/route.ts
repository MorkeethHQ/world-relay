import { NextRequest, NextResponse } from "next/server";
import { registerAgent, validateApiKey } from "@/lib/api-keys";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

const NAME_REGEX = /^[a-zA-Z0-9\- ]{3,50}$/;

export async function POST(req: NextRequest) {
  // ── Auth: ADMIN_SECRET or valid existing AGENT_API_KEY ──
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");

  let authorized = false;

  if (ADMIN_SECRET && auth === ADMIN_SECRET) {
    authorized = true;
  } else if (auth) {
    const keyResult = await validateApiKey(auth);
    authorized = keyResult.valid;
  }

  if (!authorized) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        hint: "Pass ADMIN_SECRET or a valid AGENT_API_KEY as: Authorization: Bearer <key>",
      },
      { status: 401 }
    );
  }

  // ── Rate limit: 10 registrations per hour per IP ──
  const ip = getClientIp(req);
  const rl = await rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded — max 10 registrations per hour" },
      { status: 429 }
    );
  }

  // ── Parse & validate body ──
  let body: { name?: string; webhook_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, webhook_url } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "Missing required field: name (string, 3-50 chars)" },
      { status: 400 }
    );
  }

  if (!NAME_REGEX.test(name)) {
    return NextResponse.json(
      {
        error: "Invalid name — must be 3-50 characters, alphanumeric, hyphens, and spaces only",
      },
      { status: 400 }
    );
  }

  if (webhook_url) {
    try {
      const url = new URL(webhook_url);
      if (url.protocol !== "https:") {
        return NextResponse.json(
          { error: "webhook_url must use HTTPS" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook_url" },
        { status: 400 }
      );
    }
  }

  // ── Register ──
  try {
    const result = await registerAgent(name, webhook_url);

    return NextResponse.json(
      {
        agent_id: result.agentId,
        api_key: result.apiKey,
        name: result.name,
        created_at: result.createdAt,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Agent registration failed:", err);
    return NextResponse.json(
      { error: "Registration failed — Redis may not be configured" },
      { status: 500 }
    );
  }
}
