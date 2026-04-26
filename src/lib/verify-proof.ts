import Anthropic from "@anthropic-ai/sdk";
import { AGENT_REGISTRY } from "./agents";

export type VerificationResult = {
  verdict: "pass" | "flag" | "fail";
  reasoning: string;
  confidence: number;
};

export type ModelResult = {
  name: string;
  verdict: "pass" | "flag" | "fail";
  confidence: number;
  reasoning: string;
};

export type ConsensusResult = {
  verdict: "pass" | "flag" | "fail";
  confidence: number;
  reasoning: string;
  models: ModelResult[];
  consensusMethod: "majority" | "unanimous";
};

const SYSTEM_PROMPT = `You are a proof verification agent for RELAY, a real-world micro-task network.
Your job: determine if submitted proof plausibly demonstrates that a task was completed.

Tasks may require photos, text reports, price checks, reviews, or research. You will receive:
- A task description (what was requested)
- Proof: one or more photos AND/OR a written text response

For PHOTO proofs, evaluate:
- Do the photos show what the task asked for?
- Are they clearly real photos (not screenshots, stock images, or AI-generated)?
- Do they contain relevant context (location cues, timestamps, objects mentioned)?

For TEXT proofs (no photos), evaluate:
- Does the response answer what the task asked?
- Is it specific enough to be credible (names, numbers, details)?
- Does it seem like firsthand observation vs. generic info?

Respond with JSON only:
{
  "verdict": "pass" | "flag" | "fail",
  "reasoning": "One sentence explaining your decision",
  "confidence": 0.0-1.0
}

- "pass": The proof clearly demonstrates the task was completed
- "flag": Ambiguous — could be valid but needs human review
- "fail": The proof clearly does not match the task

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

  const hasImages = images.length > 0 && images[0].length > 10;
  const userContent: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }> = [];

  if (hasImages) {
    userContent.push({
      type: "text" as const,
      text: `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}${proofNote ? `\nClaimant's note: "${proofNote}"` : ""}\n\nVerify the following proof photo${images.length > 1 ? "s" : ""}:`,
    });
    for (let i = 0; i < images.length; i++) {
      if (images.length > 1) {
        userContent.push({ type: "text" as const, text: `Photo ${i + 1} of ${images.length}:` });
      }
      userContent.push({
        type: "image" as const,
        source: { type: "base64" as const, media_type: detectMediaType(images[i]), data: images[i] },
      });
    }
  } else {
    userContent.push({
      type: "text" as const,
      text: `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}\n\nThis is a TEXT-ONLY proof submission (no photos). The claimant's response:\n\n"${proofNote || "(empty)"}"`,
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

// --- Multi-model consensus verification ---

const MODEL_TIMEOUT_MS = 15000;

async function callClaude(
  systemPrompt: string,
  userText: string,
  images: string[]
): Promise<ModelResult> {
  const anthropic = new Anthropic();

  const userContent: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
          data: string;
        };
      }
  > = [{ type: "text" as const, text: userText }];

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await anthropic.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: controller.signal }
    );

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(extractJson(text));
    return {
      name: "Claude Sonnet 4.6",
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenRouter(
  model: string,
  modelDisplayName: string,
  systemPrompt: string,
  userText: string,
  images: string[]
): Promise<ModelResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  // Build content array with text and images in OpenAI vision format
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: userText }];

  for (let i = 0; i < images.length; i++) {
    if (images.length > 1) {
      content.push({ type: "text", text: `Photo ${i + 1} of ${images.length}:` });
    }
    const mediaType = detectMediaType(images[i]);
    content.push({
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${images[i]}` },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://world-relay.vercel.app",
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenRouter ${model} returned ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(extractJson(text));
    return {
      name: modelDisplayName,
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function aggregateResults(results: ModelResult[]): ConsensusResult {
  // Count verdicts
  const verdictCounts: Record<string, number> = { pass: 0, flag: 0, fail: 0 };
  for (const r of results) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }

  // Find majority verdict
  let majorityVerdict: "pass" | "flag" | "fail" = "flag";
  let maxCount = 0;
  for (const v of ["pass", "flag", "fail"] as const) {
    if (verdictCounts[v] > maxCount) {
      maxCount = verdictCounts[v];
      majorityVerdict = v;
    }
  }

  const isUnanimous = maxCount === results.length;

  // Average confidence
  const avgConfidence =
    Math.round(
      (results.reduce((sum, r) => sum + r.confidence, 0) / results.length) * 100
    ) / 100;

  // Combine reasonings
  const combinedReasoning = results
    .map((r) => `[${r.name}] ${r.reasoning}`)
    .join(" | ");

  return {
    verdict: majorityVerdict,
    confidence: avgConfidence,
    reasoning: combinedReasoning,
    models: results,
    consensusMethod: isUnanimous ? "unanimous" : "majority",
  };
}

export async function verifyProofConsensus(
  taskDescription: string,
  proofImages: string | string[],
  proofNote?: string,
  category?: string,
  agentId?: string
): Promise<ConsensusResult> {
  const images = Array.isArray(proofImages) ? proofImages.filter(i => i && i.length > 10) : (proofImages && proofImages.length > 10 ? [proofImages] : []);
  const categoryHint = category ? CATEGORY_HINTS[category] || "" : "";

  let agentSection = "";
  if (agentId) {
    const agent = AGENT_REGISTRY[agentId.toLowerCase()];
    if (agent?.verificationPrompt) {
      agentSection = `\n\nAGENT-SPECIFIC INSTRUCTIONS (${agent.name}):\n${agent.verificationPrompt}`;
    }
  }

  const systemPrompt = SYSTEM_PROMPT + agentSection;
  const hasImages = images.length > 0;
  const userText = hasImages
    ? `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}${proofNote ? `\nClaimant's note: "${proofNote}"` : ""}\n\nVerify the following proof photo${images.length > 1 ? "s" : ""}:`
    : `Task description: "${taskDescription}"${categoryHint ? `\nCategory: ${categoryHint}` : ""}\n\nThis is a TEXT-ONLY proof submission (no photos). The claimant's response:\n\n"${proofNote || "(empty)"}"`;


  // Launch all 3 models in parallel with individual error handling
  const modelPromises: Promise<ModelResult>[] = [
    callClaude(systemPrompt, userText, images).catch((err) => {
      console.error("[Consensus] Claude failed:", err);
      return {
        name: "Claude Sonnet 4.6",
        verdict: "flag" as const,
        confidence: 0,
        reasoning: "Model unavailable — flagged for manual review",
      };
    }),
    callOpenRouter(
      "openai/gpt-4o",
      "GPT-4o",
      systemPrompt,
      userText,
      images
    ).catch((err) => {
      console.error("[Consensus] GPT-4o failed:", err);
      return {
        name: "GPT-4o",
        verdict: "flag" as const,
        confidence: 0,
        reasoning: "Model unavailable — flagged for manual review",
      };
    }),
    callOpenRouter(
      "google/gemini-2.0-flash-001",
      "Gemini 2.0 Flash",
      systemPrompt,
      userText,
      images
    ).catch((err) => {
      console.error("[Consensus] Gemini failed:", err);
      return {
        name: "Gemini 2.0 Flash",
        verdict: "flag" as const,
        confidence: 0,
        reasoning: "Model unavailable — flagged for manual review",
      };
    }),
  ];

  const results = await Promise.all(modelPromises);
  return aggregateResults(results);
}

export function verifyProofStub(
  _taskDescription: string,
  _proofImageBase64: string
): VerificationResult {
  const roll = Math.random();
  if (roll < 0.70) {
    // 70% pass with varied confidence
    const confidence = 0.75 + Math.random() * 0.2; // 0.75–0.95
    return {
      verdict: "pass",
      reasoning: "Proof verified — visual evidence matches the task request.",
      confidence: Math.round(confidence * 100) / 100,
    };
  } else if (roll < 0.90) {
    // 20% flag
    const confidence = 0.55 + Math.random() * 0.2; // 0.55–0.75
    return {
      verdict: "flag",
      reasoning: "Proof is ambiguous — photo partially matches but context is unclear. Flagged for human review.",
      confidence: Math.round(confidence * 100) / 100,
    };
  } else {
    // 10% fail
    return {
      verdict: "fail",
      reasoning: "Proof does not appear to match the task description.",
      confidence: 0.3 + Math.random() * 0.15,
    };
  }
}
