import { describe, it, expect } from "vitest";
import { getLevel, getPointsToNextLevel, fundingRewardPoints, FUNDING_REWARD_PER_USD, FUNDING_REWARD_CAP } from "@/lib/proof-of-favour";

describe("getLevel", () => {
  it("returns New Runner for 0 points", () => {
    expect(getLevel(0)).toBe("New Runner");
  });

  it("returns Local Runner at 50 points", () => {
    expect(getLevel(50)).toBe("Local Runner");
  });

  it("returns Trusted Runner at 150 points", () => {
    expect(getLevel(150)).toBe("Trusted Runner");
  });

  it("returns Veteran Runner at 400 points", () => {
    expect(getLevel(400)).toBe("Veteran Runner");
  });

  it("returns Legend at 1000 points", () => {
    expect(getLevel(1000)).toBe("Legend");
  });

  it("handles points between levels", () => {
    expect(getLevel(75)).toBe("Local Runner");
    expect(getLevel(200)).toBe("Trusted Runner");
    expect(getLevel(999)).toBe("Veteran Runner");
  });
});

describe("getPointsToNextLevel", () => {
  it("shows progress for New Runner", () => {
    const result = getPointsToNextLevel(25);
    expect(result.nextLevel).toBe("Local Runner");
    expect(result.pointsNeeded).toBe(25);
    expect(result.progress).toBe(0.5);
  });

  it("shows max level for Legend", () => {
    const result = getPointsToNextLevel(1500);
    expect(result.nextLevel).toBe("Legend");
    expect(result.pointsNeeded).toBe(0);
    expect(result.progress).toBe(1);
  });

  it("calculates correct progress mid-tier", () => {
    // Local Runner is 50-149, Trusted Runner starts at 150
    const result = getPointsToNextLevel(100);
    expect(result.nextLevel).toBe("Trusted Runner");
    expect(result.pointsNeeded).toBe(50);
    expect(result.progress).toBe(0.5);
  });
});

describe("fundingRewardPoints", () => {
  it("scales at the per-dollar rate", () => {
    expect(fundingRewardPoints(1)).toBe(FUNDING_REWARD_PER_USD);
    expect(fundingRewardPoints(5)).toBe(50);
  });

  it("caps a whale bounty", () => {
    expect(fundingRewardPoints(1000)).toBe(FUNDING_REWARD_CAP);
    expect(fundingRewardPoints(26)).toBe(FUNDING_REWARD_CAP); // 26*10=260 -> capped 250
  });

  it("rounds the dollar amount before scaling", () => {
    expect(fundingRewardPoints(2.4)).toBe(20); // round(2.4)=2
    expect(fundingRewardPoints(2.6)).toBe(30); // round(2.6)=3
  });

  it("pays nothing for zero, negative, or non-finite bounties", () => {
    expect(fundingRewardPoints(0)).toBe(0);
    expect(fundingRewardPoints(-5)).toBe(0);
    expect(fundingRewardPoints(NaN)).toBe(0);
    expect(fundingRewardPoints(Infinity)).toBe(0);
  });
});
