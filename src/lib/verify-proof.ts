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

const SYSTEM_PROMPT = `You are a proof verification agent for RELAY, a real-world task network.
Your job: determine if submitted proof genuinely demonstrates that a task was completed.
Real people earn rewards from this, so fake, generated, or low-effort proof must not pass.

You will receive:
- A task description (what was requested)
- A category hint (how strict to be)
- Proof: one or more photos AND/OR a written text response

For PHOTO proofs, actively scrutinize the image before trusting it. FAIL or FLAG proof that shows any of these:
1. AI-GENERATED or SYNTHETIC images. Look hard for telltale signs: waxy or plastic skin, malformed hands or fingers, extra or missing limbs, garbled or nonsensical text on signs and labels, warped or repeating backgrounds, impossible reflections or lighting, unnaturally perfect symmetry, or a smooth generic render look. If the image looks generated rather than captured by a real phone camera, FAIL it.
2. STOCK PHOTOS or professional marketing shots: watermarks, studio lighting, unrealistic polish, or no personal or situational context.
3. SCREENSHOTS OF A SCREEN: a photo or capture of another display, browser, or app. Reject these unless the task explicitly asks for a screenshot.
4. IRRELEVANT images that do not show what the task actually asked for.
5. LOW-EFFORT or REUSED content: blank, black, generic filler, or images that look pulled from the internet.

Only PASS a photo when it is a genuine, task-relevant photo that a real person plausibly captured. Real phone photos are messy, slightly blurry, or badly framed, and that is fine. But when you are unsure about authenticity or relevance, choose "flag", not "pass". When you are confident it is fake, generated, stock, a screenshot of a screen, or unrelated, choose "fail".
Screenshots of social media posts ARE valid proof for SOCIAL tasks specifically.

For TEXT proofs (no photos):
- Does the response address the task?
- Is it a genuine attempt, not copy-pasted spam?
- Short honest on-topic answers are fine. Be lenient here.

Respond with JSON only:
{
  "verdict": "pass" | "flag" | "fail",
  "reasoning": "One sentence explaining your decision",
  "confidence": 0.0-1.0
}

- "pass": The proof genuinely demonstrates the task was completed
- "flag": Ambiguous, or you cannot rule out that it is fake, generated, or unrelated. Needs human review.
- "fail": Clearly fake, AI-generated, stock, a screenshot of a screen, spam, or unrelated to the task

For image-based tasks, do NOT default to pass. Reserve "pass" for proof you actively believe is genuine, and lean toward "flag" or "fail" for anything suspicious. For text-only and opinion or feedback tasks, stay lenient and pass any honest on-topic attempt.`;

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
  photo: "This is a PHOTO task. The claimant was asked to photograph something specific. Confirm the photo genuinely shows what was requested AND is a real phone capture, not AI-generated, stock, or a screenshot of a screen. Reject synthetic or irrelevant images.",
  delivery: "This is a DELIVERY task. Look for genuine evidence that an item was delivered: packaging, receipt, handoff, or the item at the destination. Reject AI-generated, stock, or screenshot images, and anything unrelated to the delivery.",
  "check-in": "This is a CHECK-IN task. The claimant was asked to confirm a status at a location. Look for real signs, current conditions, or timestamps. Reject AI-generated, stock, or screenshot images that do not show a genuine on-location capture.",
  custom: "",
  review: "This is a REVIEW task. The claimant was asked to share an honest opinion. Be LENIENT: any genuine personal opinion counts, and a short honest response is fine. Do not require photos unless the task explicitly asks for them.",
  social: "This is a SOCIAL MEDIA task. The claimant should provide a screenshot of their published post. A screenshot of a real social media post (X/Instagram/TikTok) is expected and valid here. Verify it looks like a genuine post and is not obviously edited, fabricated, or AI-generated. Do not judge content quality, just that a real post was made.",
  feedback: "This is a FEEDBACK task. Be VERY LENIENT. Any genuine response that addresses the question counts as a pass. Short answers are fine. The bar is: did they engage with the question at all? If yes, pass.",
  errand: "This is an ERRAND task. The claimant was asked to complete a physical task. Look for genuine photo evidence of the completed errand. Reject AI-generated, stock, or screenshot images, and anything unrelated to the errand.",
};

// Categories where proof is expected to be text or opinion, so verification stays lenient.
// Image-based categories require a real majority to pass (see aggregateResults).
const LENIENT_CATEGORIES = new Set(["review", "feedback"]);

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

const MODEL_TIMEOUT_MS = 30000;

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
        source:
          | { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }
          | { type: "url"; url: string };
      }
  > = [{ type: "text" as const, text: userText }];

  for (let i = 0; i < images.length; i++) {
    if (images.length > 1) {
      userContent.push({
        type: "text" as const,
        text: `Photo ${i + 1} of ${images.length}:`,
      });
    }
    const isUrl = images[i].startsWith("http://") || images[i].startsWith("https://");
    userContent.push({
      type: "image" as const,
      source: isUrl
        ? { type: "url" as const, url: images[i] }
        : { type: "base64" as const, media_type: detectMediaType(images[i]), data: images[i] },
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
    const isUrl = images[i].startsWith("http://") || images[i].startsWith("https://");
    content.push({
      type: "image_url",
      image_url: { url: isUrl ? images[i] : `data:${detectMediaType(images[i])};base64,${images[i]}` },
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

function aggregateResults(results: ModelResult[], lenient = false): ConsensusResult {
  const available = results.filter(r => r.confidence > 0 || !r.reasoning.includes("unavailable"));
  const toCount = available.length > 0 ? available : results;

  const verdictCounts: Record<string, number> = { pass: 0, flag: 0, fail: 0 };
  for (const r of toCount) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }

  let majorityVerdict: "pass" | "flag" | "fail" = "flag";
  let maxCount = 0;
  for (const v of ["pass", "flag", "fail"] as const) {
    if (verdictCounts[v] > maxCount) {
      maxCount = verdictCounts[v];
      majorityVerdict = v;
    }
  }

  if (lenient) {
    // Text and opinion tasks stay lenient: a single genuine pass is enough to pass.
    if (verdictCounts["pass"] > 0 && verdictCounts["pass"] >= verdictCounts["fail"]) {
      majorityVerdict = "pass";
    }
  } else {
    // Image-based tasks require a real majority. A single pass among fail/flag does NOT pass.
    const total = toCount.length;
    if (verdictCounts["pass"] * 2 > total) {
      majorityVerdict = "pass";
    } else if (verdictCounts["fail"] * 2 > total) {
      majorityVerdict = "fail";
    } else {
      // No clear majority: send to human review rather than auto-passing a possible fake.
      majorityVerdict = "flag";
    }
  }

  const isUnanimous = maxCount === toCount.length;

  const avgConfidence =
    Math.round(
      (toCount.reduce((sum, r) => sum + r.confidence, 0) / toCount.length) * 100
    ) / 100;

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
  // Text-only submissions cannot be AI-image fakes, and opinion/feedback tasks are meant to be lenient.
  const lenient = !hasImages || (category ? LENIENT_CATEGORIES.has(category) : false);
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
      "google/gemini-2.5-flash",
      "Gemini 2.5 Flash",
      systemPrompt,
      userText,
      images
    ).catch((err) => {
      console.error("[Consensus] Gemini failed:", err);
      return {
        name: "Gemini 2.5 Flash",
        verdict: "flag" as const,
        confidence: 0,
        reasoning: "Model unavailable — flagged for manual review",
      };
    }),
  ];

  const results = await Promise.all(modelPromises);
  const allFailed = results.every(r => r.confidence === 0 && r.reasoning.includes("unavailable"));

  if (allFailed) {
    console.error("[Consensus] All 3 models failed, attempting single-model fallback");
    try {
      const fallback = await callClaude(systemPrompt, userText, images);
      return aggregateResults([fallback], lenient);
    } catch (fallbackErr) {
      console.error("[Consensus] Fallback Claude also failed:", fallbackErr);
    }
  }

  return aggregateResults(results, lenient);
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
