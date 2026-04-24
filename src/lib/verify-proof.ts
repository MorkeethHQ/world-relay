import Anthropic from "@anthropic-ai/sdk";
import { AGENT_REGISTRY } from "./agents";

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You are a proof verification agent for RELAY, an errand network.
Your job: determine if submitted proof photos plausibly prove that a real-world task was completed.

You will receive:
- A task description (what was requested)
- One or more proof photos (submitted by the person who claims to have done it)

You may receive multiple proof photos from different angles. Consider ALL photos together when evaluating.

Evaluate whether the photos are plausible proof the task was done. Consider:
- Do the photos show what the task asked for?
- Are they clearly real photos (not screenshots, stock images, or AI-generated)?
- Do they contain relevant context (location cues, timestamps, objects mentioned in the task)?
- Do multiple angles/photos corroborate each other?

Respond with JSON only:
{
  "verdict": "pass" | "flag" | "fail",
  "reasoning": "One sentence explaining your decision",
  "confidence": 0.0-1.0
}

- "pass": The photos clearly show the task was completed
- "flag": Ambiguous — could be valid but needs human review
- "fail": The photos clearly do not match the task

Be strict but fair. When in doubt, flag rather than fail.`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function detectMediaType(base64: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGO")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

const CATEGORY_HINTS: Record<string, string> = {
  photo: "This is a PHOTO task. The claimant was asked to photograph something specific. Focus on whether the photo shows what was requested.",
  delivery: "This is a DELIVERY task. Look for evidence that an item was delivered — packaging, receipt, handoff, or the item at the destination.",
  "check-in": "This is a CHECK-IN task. The claimant was asked to confirm a status at a location. Look for signs, current conditions, or timestamps.",
  custom: "",
};

export async function verifyProof(
  taskDescription: string,
  proofImages: string | string[],
  proofNote?: string,
  category?: string,
  agentId?: string
): Promise<VerificationResult> {
  const anthropic = new Anthropic();
  const images = Array.isArray(proofImages) ? proofImages : [proofImages];
  const categoryHint = category ? CATEGORY_HINTS[category] || "" : "";

  // Build agent-specific system prompt section
  let agentSection = "";
  if (agentId) {
    const agent = AGENT_REGISTRY[agentId.toLowerCase()];
    if (agent?.verificationPrompt) {
      agentSection = `\n\nAGENT-SPECIFIC INSTRUCTIONS (${agent.name}):\n${agent.verificationPrompt}`;
    }
  }

  const systemPrompt = SYSTEM_PROMPT + agentSection;

  const userContent: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }> = [
    {
      type: "text" as const,
      text: `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}${proofNote ? `\nClaimant's note: "${proofNote}"` : ""}\n\nVerify the following proof photo${images.length > 1 ? "s" : ""}:`,
    },
  ];

  for (let i = 0; i < images.length; i++) {
    if (images.length > 1) {
      userContent.push({
        type: "text" as const,
        text: `Photo ${i + 1} of ${images.length}:`,
      });
    }
    userContent.push({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: detectMediaType(images[i]),
        data: images[i],
      },
    });
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(extractJson(text));
    return {
      verdict: parsed.verdict,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
    };
  } catch {
    return {
      verdict: "flag",
      reasoning: "Could not parse AI response — flagged for manual review",
      confidence: 0,
    };
  }
}

export function verifyProofStub(
  _taskDescription: string,
  _proofImageBase64: string
): VerificationResult {
  return {
    verdict: "pass",
    reasoning: "Proof verified — task completion confirmed with visual evidence matching the request.",
    confidence: 0.92,
  };
}
