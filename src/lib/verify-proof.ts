import Anthropic from "@anthropic-ai/sdk";

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You are a proof verification agent for RELAY, an errand network.
Your job: determine if a submitted photo plausibly proves that a real-world task was completed.

You will receive:
- A task description (what was requested)
- A proof photo (submitted by the person who claims to have done it)

Evaluate whether the photo is plausible proof the task was done. Consider:
- Does the photo show what the task asked for?
- Is it clearly a real photo (not a screenshot, stock image, or AI-generated)?
- Does it contain relevant context (location cues, timestamps, objects mentioned in the task)?

Respond with JSON only:
{
  "verdict": "pass" | "flag" | "fail",
  "reasoning": "One sentence explaining your decision",
  "confidence": 0.0-1.0
}

- "pass": The photo clearly shows the task was completed
- "flag": Ambiguous — could be valid but needs human review
- "fail": The photo clearly does not match the task

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
  proofImageBase64: string,
  proofNote?: string,
  category?: string
): Promise<VerificationResult> {
  const anthropic = new Anthropic();
  const mediaType = detectMediaType(proofImageBase64);
  const categoryHint = category ? CATEGORY_HINTS[category] || "" : "";

  const userContent = [
    {
      type: "text" as const,
      text: `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}${proofNote ? `\nClaimant's note: "${proofNote}"` : ""}\n\nVerify the following proof photo:`,
    },
    {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mediaType,
        data: proofImageBase64,
      },
    },
  ];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
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
