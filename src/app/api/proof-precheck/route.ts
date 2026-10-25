import { getAuthedAddress } from "@/lib/session";
import { isTestFixture } from "@/lib/test-fixture";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getRedis } from "@/lib/redis";

const RATE_KEY = "ratelimit:proof-precheck";
const MAX_PER_HOUR = 30;

async function checkRateLimit(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const count = await redis.incr(RATE_KEY);
    if (count === 1) await redis.expire(RATE_KEY, 3600);
    return count <= MAX_PER_HOUR;
  } catch {
    return true;
  }
}

const SYSTEM_PROMPT = `You are a quick photo quality checker. Given a task description and a photo, give a brief assessment of whether this photo will pass verification. Be encouraging but honest. Respond in 2-3 sentences max.

Respond with JSON only:
{
  "assessment": "Your 2-3 sentence assessment here",
  "likely": "pass" | "marginal" | "retake"
}

- "pass": The photo clearly shows evidence matching the task
- "marginal": The photo might work but has issues (blurry, partial, unclear)
- "retake": The photo is unlikely to pass verification`;

function detectMediaType(base64: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGO")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export async function POST(req: NextRequest) {
  if (!getAuthedAddress(req, Date.now())) return NextResponse.json({ error: "Sign in before sending a photo.", code: "reauth_required" }, { status: 403 });
  const { imageBase64, taskDescription, proofConsent } = await req.json();
  if (proofConsent !== true) return NextResponse.json({ error: "Agree to send this photo for review first.", code: "proof_consent_required" }, { status: 422 });

  if (!imageBase64 || !taskDescription) {
    return NextResponse.json({ error: "Missing imageBase64 or taskDescription" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    if (isTestFixture()) return NextResponse.json({ assessment: "TEST DATA: photo selected. This local quality-check stand-in did not call a model.", likely: "marginal" });
    return NextResponse.json({ error: "Photo checking is unavailable. No photo assessment was made.", code: "check_unavailable" }, { status: 503 });
  }

  if (!(await checkRateLimit())) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 });
  }

  try {
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Task description: "${taskDescription}"\n\nCheck this proof photo:`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: detectMediaType(imageBase64),
                data: imageBase64,
              },
            },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const parsed = JSON.parse(extractJson(text));
      return NextResponse.json({
        assessment: parsed.assessment || "Could not assess the photo.",
        likely: ["pass", "marginal", "retake"].includes(parsed.likely) ? parsed.likely : "marginal",
      });
    } catch {
      return NextResponse.json({
        assessment: text.slice(0, 200) || "Could not assess the photo.",
        likely: "marginal" as const,
      });
    }
  } catch (err) {
    console.error("[proof-precheck] AI error:", err);
    return NextResponse.json({
      assessment: "Pre-check unavailable right now. You can still submit your proof.",
      likely: "marginal" as const,
    });
  }
}
