import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/types";
import { taskMarketState } from "@/lib/task-market-state";

const NOW = Date.parse("2026-09-29T12:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1", poster: "human_1", claimant: null, category: "feedback",
    description: "Try the product", location: "Online", lat: null, lng: null,
    bountyUsdc: 5, deadline: "2026-09-29T14:15:00.000Z", status: "open",
    proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null,
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null,
    callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null,
    taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 4, completionCount: 1, createdAt: "2026-09-29T11:42:00.000Z",
    ...overrides,
  };
}

describe("taskMarketState", () => {
  it("derives honest live urgency and capacity", () => {
    const state = taskMarketState(task(), NOW);
    expect(state.deadlineLabel).toBe("2h 15m left");
    expect(state.slotsLabel).toBe("3 of 4 spots left");
    expect(state.isEndingSoon).toBe(true);
    expect(state.isJustOpened).toBe(true);
    expect(state.fundingLabel).toBe("5 pts reward");
  });

  it("does not describe unescrowed USDC as funded", () => {
    const state = taskMarketState(task({ rewardType: "usdc-v2", bountyUsdc: 1 }), NOW);
    expect(state.fundingLabel).toBe("$1 USDC · funds on accept");
  });

  it("shows funded USDC only from an existing funding signal", () => {
    const state = taskMarketState(task({ rewardType: "usdc-v2", bountyUsdc: 2, escrowTxHash: "0xfunded" }), NOW);
    expect(state.fundingLabel).toBe("$2 USDC funded");
  });

  it("shows terminal state instead of a misleading countdown", () => {
    const state = taskMarketState(task({ status: "completed", completionCount: 4 }), NOW);
    expect(state.deadlineLabel).toBe("Proof landed");
    expect(state.slotsLabel).toBe("No spots left");
  });
});
