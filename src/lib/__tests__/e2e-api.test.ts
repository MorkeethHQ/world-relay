/**
 * E2E API Tests for RELAY
 *
 * Tests real Anthropic API calls (Sonnet for verification, Haiku for chat).
 * Requires ANTHROPIC_API_KEY in .env.local.
 *
 * Run: npx vitest run src/lib/__tests__/e2e-api.test.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";

// Load .env.local before any module that reads process.env
config({ path: resolve(__dirname, "../../../.env.local") });

import { describe, it, expect } from "vitest";
import { verifyProof, type VerificationResult } from "../verify-proof";
import {
  generateClaimBriefing,
  generateFollowUpQuestion,
  evaluateFollowUp,
  mediateDispute,
} from "../ai-chat";
import { createTask } from "../store";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// Test image: a 640x480 JPEG of a building-like scene (sky, building, windows,
// door, sidewalk, tree, lamp) generated with Python PIL and saved as base64.
// Loaded from an adjacent file to keep this test readable.
// ---------------------------------------------------------------------------
const TEST_IMAGE_BASE64 = readFileSync(
  resolve(__dirname, "test-image.b64"),
  "utf-8"
).trim();

// ---------------------------------------------------------------------------
// Helper to build a realistic mock Task (without hitting Redis/store)
// ---------------------------------------------------------------------------
function mockTask(overrides?: Partial<Task>): Task {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 10),
    poster: "0xTestPoster",
    claimant: "0xTestClaimant",
    category: "photo",
    description:
      "Photograph the exterior of the building at 22 Rue de Rivoli. Capture the full facade, windows, and entrance.",
    location: "Rue de Rivoli, Paris 4e",
    lat: 48.8558,
    lng: 2.358,
    bountyUsdc: 10,
    deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
    status: "claimed",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    donOnChainId: null,
    donStakeTxHash: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Precondition: ANTHROPIC_API_KEY must be set
// ---------------------------------------------------------------------------
const API_KEY = process.env.ANTHROPIC_API_KEY;

describe("E2E Anthropic API tests", () => {
  if (!API_KEY) {
    it.skip("ANTHROPIC_API_KEY not set — skipping E2E tests", () => {});
    return;
  }

  // -----------------------------------------------------------------------
  // 1. Sonnet vision verification (verifyProof)
  // -----------------------------------------------------------------------
  describe("Sonnet vision verification", () => {
    it(
      "returns a valid VerificationResult with proper JSON parsing",
      async () => {
        const result = await verifyProof(
          "Photograph the exterior of the building at 22 Rue de Rivoli, including full facade and entrance.",
          TEST_IMAGE_BASE64,
          "Here is the building photo as requested.",
          "photo"
        );

        // Structure checks
        expect(result).toBeDefined();
        expect(result).toHaveProperty("verdict");
        expect(result).toHaveProperty("reasoning");
        expect(result).toHaveProperty("confidence");

        // Verdict must be one of the three valid values
        expect(["pass", "flag", "fail"]).toContain(result.verdict);

        // Reasoning must be a non-empty string
        expect(typeof result.reasoning).toBe("string");
        expect(result.reasoning.length).toBeGreaterThan(0);

        // Confidence must be a number between 0 and 1
        expect(typeof result.confidence).toBe("number");
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);

        console.log("[Sonnet verification]", JSON.stringify(result, null, 2));
      },
      30_000
    );

    it(
      "handles extractJson when Sonnet wraps response in code fences",
      async () => {
        // This implicitly tests the extractJson fix: if Sonnet wraps
        // its JSON in ```json ... ```, the function should still parse it
        // and NOT return the fallback "Could not parse AI response" result.
        const result = await verifyProof(
          "Photo the queue at the Louvre Pyramid entrance.",
          TEST_IMAGE_BASE64,
          undefined,
          "check-in"
        );

        // The key assertion: if extractJson is broken, confidence === 0
        // and reasoning contains "Could not parse AI response"
        expect(result.reasoning).not.toContain("Could not parse AI response");
        expect(["pass", "flag", "fail"]).toContain(result.verdict);
        expect(result.confidence).toBeGreaterThan(0);

        console.log("[extractJson check]", JSON.stringify(result, null, 2));
      },
      30_000
    );
  });

  // -----------------------------------------------------------------------
  // 2. Haiku claim briefing (generateClaimBriefing)
  // -----------------------------------------------------------------------
  describe("Haiku claim briefing", () => {
    it(
      "returns a non-null string with useful content",
      async () => {
        const task = mockTask();
        const briefing = await generateClaimBriefing(task);

        expect(briefing).not.toBeNull();
        expect(typeof briefing).toBe("string");
        expect(briefing!.length).toBeGreaterThan(20);

        // Should contain bullet-point-like content (tips)
        // Haiku is asked to use bullet points
        console.log("[Claim briefing]", briefing);
      },
      30_000
    );
  });

  // -----------------------------------------------------------------------
  // 3. Haiku follow-up question (generateFollowUpQuestion)
  // -----------------------------------------------------------------------
  describe("Haiku follow-up question", () => {
    it(
      "returns a non-null question string",
      async () => {
        const task = mockTask();
        const question = await generateFollowUpQuestion(
          task,
          TEST_IMAGE_BASE64,
          {
            reasoning:
              "The photo shows a building but it is unclear if this is 22 Rue de Rivoli. No street sign visible.",
            confidence: 0.45,
          }
        );

        expect(question).not.toBeNull();
        expect(typeof question).toBe("string");
        expect(question!.length).toBeGreaterThan(10);

        // Should read like a question
        console.log("[Follow-up question]", question);
      },
      30_000
    );
  });

  // -----------------------------------------------------------------------
  // 4. Haiku re-evaluation (evaluateFollowUp)
  // -----------------------------------------------------------------------
  describe("Haiku re-evaluation", () => {
    it(
      "returns a valid VerificationResult with parsed JSON",
      async () => {
        const task = mockTask();
        const result = await evaluateFollowUp(
          task,
          TEST_IMAGE_BASE64,
          "AI: Can you confirm this is 22 Rue de Rivoli? Is there a street sign nearby?\nClaimant: Yes, the blue street sign is just to the left of the frame. The building number 22 is visible on the door.",
          {
            reasoning:
              "Photo shows a building but location cannot be confirmed.",
            confidence: 0.45,
          }
        );

        expect(result).toBeDefined();
        expect(["pass", "flag", "fail"]).toContain(result.verdict);
        expect(typeof result.reasoning).toBe("string");
        expect(result.reasoning.length).toBeGreaterThan(0);
        expect(typeof result.confidence).toBe("number");
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);

        // Should NOT be the fallback (which has confidence 0 and specific text)
        expect(result.reasoning).not.toContain("Re-evaluation failed");

        console.log("[Re-evaluation]", JSON.stringify(result, null, 2));
      },
      30_000
    );
  });

  // -----------------------------------------------------------------------
  // 5. Haiku dispute mediation (mediateDispute)
  // -----------------------------------------------------------------------
  describe("Haiku dispute mediation", () => {
    it(
      "returns a valid dispute result with approved, reasoning, confidence",
      async () => {
        const task = mockTask({
          verificationResult: {
            verdict: "flag",
            reasoning:
              "Photo shows a building but unclear if it matches the task location.",
            confidence: 0.5,
          },
        });

        const result = await mediateDispute(
          task,
          TEST_IMAGE_BASE64,
          "Poster: This does not look like the right building.\nClaimant: It is the correct building, the street sign is just outside the frame. I can provide another photo.\nPoster: Okay, let the AI decide."
        );

        expect(result).toBeDefined();
        expect(typeof result.approved).toBe("boolean");
        expect(typeof result.reasoning).toBe("string");
        expect(result.reasoning.length).toBeGreaterThan(0);
        expect(typeof result.confidence).toBe("number");
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);

        // Should NOT be the fallback error
        expect(result.reasoning).not.toContain("Dispute mediation failed");

        console.log("[Dispute mediation]", JSON.stringify(result, null, 2));
      },
      30_000
    );

    it(
      "works without a proof image (null image)",
      async () => {
        const task = mockTask({
          verificationResult: {
            verdict: "flag",
            reasoning: "No proof image was provided.",
            confidence: 0.2,
          },
        });

        const result = await mediateDispute(
          task,
          null,
          "Poster: Where is the photo?\nClaimant: I forgot to attach it, but I did complete the task. I can resubmit."
        );

        expect(result).toBeDefined();
        expect(typeof result.approved).toBe("boolean");
        expect(typeof result.reasoning).toBe("string");
        expect(typeof result.confidence).toBe("number");

        console.log(
          "[Dispute no-image]",
          JSON.stringify(result, null, 2)
        );
      },
      30_000
    );
  });

  // -----------------------------------------------------------------------
  // 6. Full lifecycle test
  // -----------------------------------------------------------------------
  describe("Full lifecycle", () => {
    it(
      "creates a task, generates briefing, and verifies proof end-to-end",
      async () => {
        // Step 1: Create a task via the store
        const task = createTask({
          poster: "0xLifecyclePoster",
          category: "photo",
          description:
            "Photo the exterior of the Louvre Pyramid. Include the glass structure and surrounding courtyard.",
          location: "Musee du Louvre, Paris 1er",
          lat: 48.8606,
          lng: 2.3376,
          bountyUsdc: 5,
          deadlineHours: 24,
        });

        expect(task).toBeDefined();
        expect(task.id).toBeTruthy();
        expect(task.status).toBe("open");

        // Step 2: Generate a claim briefing
        const briefing = await generateClaimBriefing(task);
        expect(briefing).not.toBeNull();
        expect(typeof briefing).toBe("string");
        expect(briefing!.length).toBeGreaterThan(10);

        // Step 3: Verify proof with Sonnet
        const verification = await verifyProof(
          task.description,
          TEST_IMAGE_BASE64,
          "Here is the Louvre Pyramid as requested.",
          task.category
        );

        expect(verification).toBeDefined();
        expect(["pass", "flag", "fail"]).toContain(verification.verdict);
        expect(typeof verification.reasoning).toBe("string");
        expect(verification.reasoning.length).toBeGreaterThan(0);
        expect(typeof verification.confidence).toBe("number");
        expect(verification.confidence).toBeGreaterThanOrEqual(0);
        expect(verification.confidence).toBeLessThanOrEqual(1);

        // The structures are consistent — all fields present and typed correctly
        console.log("[Lifecycle] Task ID:", task.id);
        console.log("[Lifecycle] Briefing length:", briefing!.length);
        console.log(
          "[Lifecycle] Verification:",
          JSON.stringify(verification, null, 2)
        );
      },
      60_000
    );
  });
});
