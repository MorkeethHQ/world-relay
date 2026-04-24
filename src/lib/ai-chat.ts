import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "./types";
import type { VerificationResult } from "./verify-proof";

const HAIKU = "claude-haiku-4-5-20251001";

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

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

const CATEGORY_TIPS: Record<string, string> = {
  photo: "Focus on framing, clarity, and capturing the exact subject. Include context clues (signage, street names) that prove location.",
  delivery: "Photograph the item at the destination. Include any receipts, packaging labels, or handoff confirmation.",
  "check-in": "Capture current conditions clearly. Include timestamps or dateable context (newspapers, digital signs) if possible.",
  custom: "Follow the task description precisely. When in doubt, more context in the photo is better.",
};

export async function generateClaimBriefing(task: Task): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 200,
      system: `You are RELAY's AI assistant. A verified human just claimed a physical-world task. Generate a SHORT, friendly briefing with 3-4 specific tips for getting their proof photo verified on the first try. Be specific to THIS task — no generic advice. Use bullet points. Keep it under 100 words. No greeting, no sign-off.`,
      messages: [{
        role: "user",
        content: `Task: "${task.description}"\nLocation: ${task.location}\nCategory: ${task.category}\nBounty: $${task.bountyUsdc} USDC\n\nCategory tips: ${CATEGORY_TIPS[task.category] || CATEGORY_TIPS.custom}`,
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : null;
    return text;
  } catch (err) {
    console.error("[AI-Chat] Briefing error:", err);
    return null;
  }
}

export async function generateFollowUpQuestion(
  task: Task,
  proofImageBase64: string,
  initialVerdict: { reasoning: string; confidence: number }
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 150,
      system: `You are RELAY's AI verifier. A proof photo was submitted but you're not fully confident it proves the task was completed. Ask ONE specific follow-up question to the claimant that would help you decide. Be conversational and specific — reference what you can see in the photo and what's missing. Under 60 words. No greeting.`,
      messages: [{
        role: "user",
        content: [
          {
            type: "text" as const,
            text: `Task: "${task.description}"\nLocation: ${task.location}\nInitial verdict: ${initialVerdict.reasoning} (confidence: ${Math.round(initialVerdict.confidence * 100)}%)\n\nWhat follow-up question would resolve the ambiguity?`,
          },
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: detectMediaType(proofImageBase64),
              data: proofImageBase64,
            },
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : null;
    return text;
  } catch (err) {
    console.error("[AI-Chat] Follow-up error:", err);
    return null;
  }
}

export async function evaluateFollowUp(
  task: Task,
  proofImageBase64: string,
  threadMessages: string,
  initialVerdict: { reasoning: string; confidence: number }
): Promise<VerificationResult> {
  const client = getClient();
  if (!client) {
    return { verdict: "flag", reasoning: "AI unavailable — flagged for manual review", confidence: 0 };
  }

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 256,
      system: `You are RELAY's AI verifier re-evaluating a proof after receiving additional context from the claimant via chat.

You previously flagged this proof with medium confidence. Now the claimant has responded with more information. Re-evaluate considering BOTH the original photo AND the new context from the conversation.

Respond with JSON only:
{"verdict": "pass" | "flag" | "fail", "reasoning": "One sentence", "confidence": 0.0-1.0}

Be fair — if the follow-up response resolves your concern, pass it. If it doesn't help, flag or fail.`,
      messages: [{
        role: "user",
        content: [
          {
            type: "text" as const,
            text: `Task: "${task.description}"\nLocation: ${task.location}\n\nInitial verdict: ${initialVerdict.reasoning} (confidence: ${Math.round(initialVerdict.confidence * 100)}%)\n\nThread conversation after follow-up:\n${threadMessages}\n\nRe-evaluate this proof:`,
          },
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: detectMediaType(proofImageBase64),
              data: proofImageBase64,
            },
          },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(extractJson(text));
    return { verdict: parsed.verdict, reasoning: parsed.reasoning, confidence: parsed.confidence };
  } catch (err) {
    console.error("[AI-Chat] Re-evaluation error:", err);
    return { verdict: "flag", reasoning: "Re-evaluation failed — flagged for manual review", confidence: 0 };
  }
}

export async function mediateDispute(
  task: Task,
  proofImageBase64: string | null,
  threadMessages: string
): Promise<{ approved: boolean; reasoning: string; confidence: number }> {
  const client = getClient();
  if (!client) {
    return { approved: false, reasoning: "AI unavailable for dispute resolution", confidence: 0 };
  }

  try {
    const textBlock = {
      type: "text" as const,
      text: `Task: "${task.description}"\nLocation: ${task.location}\nBounty: $${task.bountyUsdc} USDC\nPoster: ${task.poster}\nClaimant: ${task.claimant}\n\nOriginal AI verdict: ${task.verificationResult?.reasoning || "N/A"} (confidence: ${Math.round((task.verificationResult?.confidence || 0) * 100)}%)\n\nFull thread conversation:\n${threadMessages}\n\nAnalyze all evidence and render your verdict:`,
    };

    const userContent = proofImageBase64
      ? [
          textBlock,
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: detectMediaType(proofImageBase64),
              data: proofImageBase64,
            },
          },
        ]
      : [textBlock];

    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 300,
      system: `You are RELAY's AI dispute mediator. A task proof was flagged and the poster and claimant may have discussed it in the XMTP thread.

Review ALL evidence: the original proof photo, the AI's initial analysis, and the full conversation thread. Consider both sides fairly.

Respond with JSON only:
{"approved": true/false, "reasoning": "2-3 sentences explaining your decision, referencing specific evidence", "confidence": 0.0-1.0}

Be thorough but fair. If the proof fundamentally shows the task was done, approve even if imperfect. Only reject if the evidence clearly fails to prove completion.`,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(extractJson(text));
    return { approved: parsed.approved, reasoning: parsed.reasoning, confidence: parsed.confidence };
  } catch (err) {
    console.error("[AI-Chat] Dispute mediation error:", err);
    return { approved: false, reasoning: "Dispute mediation failed — defaulting to poster review", confidence: 0 };
  }
}
