import { describe, expect, it } from "vitest";
import { simplePaymentStep } from "@/lib/simple-payment";
import type { Task } from "@/lib/types";

const POSTER = "0x1111111111111111111111111111111111111111";
const RUNNER = "0x2222222222222222222222222222222222222222";

function paid(overrides: Partial<Task> = {}): Task {
  return {
    id: "paid-1",
    poster: POSTER,
    claimant: null,
    description: "Try the app and send one useful note",
    category: "review",
    location: "Online",
    bountyUsdc: 2,
    rewardType: "usdc-v2",
    status: "open",
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    escrowTxHash: null,
    settlementTx: null,
    escrowV2RefundTx: null,
    pendingRelease: false,
    onChainId: null,
    verificationResult: null,
    ...overrides,
  } as Task;
}

describe("simple paid favour path", () => {
  it("shows a stranger one next action from accept through payment", () => {
    expect(simplePaymentStep(paid(), RUNNER)).toBe("accept");
    expect(simplePaymentStep(paid({ status: "claimed", claimant: RUNNER }), RUNNER)).toBe("wait");
    expect(simplePaymentStep(paid({ status: "claimed", claimant: RUNNER }), POSTER)).toBe("fund");
    expect(simplePaymentStep(paid({ status: "claimed", claimant: RUNNER, escrowTxHash: "0xfund" }), RUNNER)).toBe("prove");
    expect(simplePaymentStep(paid({ status: "claimed", claimant: RUNNER, escrowTxHash: "0xfund", pendingRelease: true }), POSTER)).toBe("pay");
    expect(simplePaymentStep(paid({ status: "completed", claimant: RUNNER, escrowTxHash: "0xfund", settlementTx: "0xpay" }), RUNNER)).toBe("done");
  });

  it("never sends the runner to proof before the escrow is funded", () => {
    expect(simplePaymentStep(paid({ status: "claimed", claimant: RUNNER }), RUNNER)).not.toBe("prove");
  });

  it("does not change points favours", () => {
    expect(simplePaymentStep(paid({ rewardType: "points" }), RUNNER)).toBeNull();
  });
});
