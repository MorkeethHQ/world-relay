import { describe, it, expect } from "vitest";
import {
  isAppealable,
  appealPool,
  isQualifiedJudge,
  appealOutcome,
  APPEAL_QUORUM,
  APPEAL_CLEAR_MAJORITY,
  JUDGE_MIN_GRADED,
  JUDGE_MIN_ACCURACY,
} from "@/lib/jury-appeal";
import type { Task } from "@/lib/types";

// A flagged, points-only, image-bearing proof — the ONLY shape a human jury may
// clear. Every test below mutates one field off this and expects a refusal.
function flaggedPointsProof(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    poster: "0xposter000000000000000000000000000000aaaa",
    claimant: "0xclaimant00000000000000000000000000000bbb",
    category: "photo",
    description: "Find a public sign with a mistake on it",
    location: "Anywhere",
    bountyUsdc: 10,
    rewardType: "points",
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: "completed",
    proofImageUrl: "/api/jury/card/x/image",
    proofNote: "here it is",
    verificationResult: { verdict: "flag", reasoning: "appears to be a genuine phone capture, but", confidence: 0.7 },
    onChainId: null,
    escrowTxHash: null,
    donOnChainId: null,
    completionCount: 0,
    maxCompletions: 1,
    createdAt: new Date().toISOString(),
    ...over,
  } as unknown as Task;
}

describe("isAppealable — the money boundary (SECURITY-INVARIANTS 2, 6, 8)", () => {
  it("accepts the flagged points-only proof with an image", () => {
    expect(isAppealable(flaggedPointsProof())).toBe(true);
  });

  // Each of these is a route by which a human verdict could reach money or
  // campaign progress. All must be refused, by construction, not by convention.
  const moneyShapes: Array<[string, Partial<Task>]> = [
    ["a USDC reward type", { rewardType: "usdc" } as Partial<Task>],
    ["an escrow-v2 reward type", { rewardType: "usdc-v2" } as Partial<Task>],
    ["an escrow funding tx", { escrowTxHash: "0x" + "a".repeat(64) } as Partial<Task>],
    ["an on-chain escrow id", { onChainId: 12 } as Partial<Task>],
    ["a Double-or-Nothing stake", { donOnChainId: 3 } as Partial<Task>],
    ["campaign progress (Inv 8)", { campaignId: "comeback-2026" } as Partial<Task>],
    ["a pinned escrow-v2 contract", { escrowV2Address: "0x" + "b".repeat(40) } as Partial<Task>],
  ];
  for (const [label, over] of moneyShapes) {
    it(`REFUSES a proof carrying ${label}`, () => {
      expect(isAppealable(flaggedPointsProof(over))).toBe(false);
    });
  }

  it("refuses anything the AI did not flag — pass and fail are not appeals", () => {
    expect(isAppealable(flaggedPointsProof({ verificationResult: { verdict: "pass", reasoning: "", confidence: 1 } } as Partial<Task>))).toBe(false);
    expect(isAppealable(flaggedPointsProof({ verificationResult: { verdict: "fail", reasoning: "", confidence: 1 } } as Partial<Task>))).toBe(false);
    expect(isAppealable(flaggedPointsProof({ verificationResult: undefined } as Partial<Task>))).toBe(false);
  });

  it("refuses a proof with no image to judge, and one with no claimant to credit", () => {
    expect(isAppealable(flaggedPointsProof({ proofImageUrl: null } as Partial<Task>))).toBe(false);
    expect(isAppealable(flaggedPointsProof({ claimant: null } as Partial<Task>))).toBe(false);
  });
});

describe("appealPool — nobody grades their own homework", () => {
  it("hides the judge's own proof from both sides of it", () => {
    const mine = flaggedPointsProof({ id: "mine", claimant: "0xJUDGE00000000000000000000000000000000001" });
    const iPosted = flaggedPointsProof({ id: "posted", poster: "0xjudge00000000000000000000000000000000001" });
    const theirs = flaggedPointsProof({ id: "theirs" });
    const pool = appealPool([mine, iPosted, theirs], "0xjudge00000000000000000000000000000000001");
    expect(pool.map((t) => t.id)).toEqual(["theirs"]);
  });

  it("with no judge, returns every appealable proof and no others", () => {
    const ok = flaggedPointsProof({ id: "ok" });
    const funded = flaggedPointsProof({ id: "funded", rewardType: "usdc" } as Partial<Task>);
    expect(appealPool([ok, funded], null).map((t) => t.id)).toEqual(["ok"]);
  });
});

describe("isQualifiedJudge — the graded game is the qualification exam", () => {
  it("refuses a judge who has not played enough, however accurate", () => {
    expect(isQualifiedJudge({ judged: JUDGE_MIN_GRADED - 1, correct: JUDGE_MIN_GRADED - 1 })).toBe(false);
  });
  it("refuses an experienced but inaccurate judge — a coin-flipper cannot clear a flag", () => {
    expect(isQualifiedJudge({ judged: 100, correct: 50 })).toBe(false);
  });
  it("accepts exactly at both thresholds", () => {
    expect(isQualifiedJudge({ judged: JUDGE_MIN_GRADED, correct: Math.ceil(JUDGE_MIN_GRADED * JUDGE_MIN_ACCURACY) })).toBe(true);
  });
  it("a judge with zero history is never qualified (no divide-by-zero pass)", () => {
    expect(isQualifiedJudge({ judged: 0, correct: 0 })).toBe(false);
  });
});

describe("appealOutcome — quorum then majority", () => {
  it("stays pending below quorum, even if every vote so far says real", () => {
    expect(appealOutcome({ real: APPEAL_QUORUM - 1, not: 0 })).toBe("pending");
  });
  it("clears on the majority at quorum", () => {
    expect(appealOutcome({ real: APPEAL_CLEAR_MAJORITY, not: APPEAL_QUORUM - APPEAL_CLEAR_MAJORITY })).toBe("cleared");
  });
  it("upholds the flag when the humans agree with the model", () => {
    expect(appealOutcome({ real: 0, not: APPEAL_QUORUM })).toBe("upheld");
    expect(appealOutcome({ real: 1, not: 2 })).toBe("upheld");
  });
});
