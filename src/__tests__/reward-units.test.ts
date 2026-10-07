import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import * as reward from "@/lib/reward";
import { usdcUnitsToText, usdcTextToUnits, sumUsdcUnits } from "@/lib/reward";

// Exact USDC amounts in reward.ts. The tsconfig target is ES2017, which has no
// bigint literal, so every bigint here is built with BigInt().
const b = (n: number | string) => BigInt(n);

describe("exact USDC amounts: base units and text", () => {
  it("prints 1000 units as 0.001 and parses it back to 1000 units", () => {
    expect(usdcUnitsToText(b(1000))).toBe("0.001");
    expect(usdcTextToUnits("0.001")).toBe(b(1000));
    expect(usdcTextToUnits(usdcUnitsToText(b(1000)))).toBe(b(1000));
  });

  it.each([
    ["0", "0"],
    ["1", "0.000001"],
    ["10", "0.00001"],
    ["999999", "0.999999"],
    ["1000000", "1"],
    ["1000001", "1.000001"],
    ["1500000", "1.5"],
    ["100000", "0.1"],
    ["12500000", "12.5"],
    ["200000000", "200"],
  ])("%s units prints as %s and parses back", (units, text) => {
    expect(usdcUnitsToText(b(units))).toBe(text);
    expect(usdcTextToUnits(text)).toBe(b(units));
  });

  it("round trips every amount from 1 to 2000 units with no loss", () => {
    for (let i = 1; i <= 2000; i++) {
      const units = b(i);
      expect(usdcTextToUnits(usdcUnitsToText(units))).toBe(units);
    }
  });

  it("stays exact above the largest safe float integer", () => {
    // 2^53 + 1 cannot be held by a JS number. A helper that passes through a
    // float loses the last unit here.
    const units = b("9007199254740993");
    expect(usdcUnitsToText(units)).toBe("9007199254.740993");
    expect(usdcTextToUnits("9007199254.740993")).toBe(units);
    expect(sumUsdcUnits([b("9007199254740992"), b(1)])).toBe(units);
  });

  it("accepts trailing zeros on input and drops them on output", () => {
    expect(usdcTextToUnits("0.100000")).toBe(b(100000));
    expect(usdcTextToUnits("2.50")).toBe(b(2500000));
    expect(usdcUnitsToText(b(2500000))).toBe("2.5");
  });

  it.each([
    "", " ", "abc", "-1", "+1", "1e3", "0x10", ".5", "5.", "1,000", "1 000", "0.0000001", "1.2.3", " 1", "1 ", "NaN", "Infinity", "١",
  ])("refuses %j and never rounds or guesses", (text) => {
    expect(() => usdcTextToUnits(text)).toThrow(RangeError);
  });

  it("refuses a value that is not a string, and a float where units are needed", () => {
    expect(() => usdcTextToUnits(0.001 as unknown as string)).toThrow(RangeError);
    expect(() => usdcUnitsToText(1000 as unknown as bigint)).toThrow(TypeError);
    expect(() => sumUsdcUnits([b(1), 0.5 as unknown as bigint])).toThrow(TypeError);
  });

  it("prints a negative difference exactly, and refuses to parse a sign", () => {
    expect(usdcUnitsToText(b(-1000))).toBe("-0.001");
    expect(() => usdcTextToUnits("-0.001")).toThrow(RangeError);
  });
});

describe("exact USDC amounts: sum", () => {
  it("sums nothing to zero", () => {
    expect(sumUsdcUnits([])).toBe(b(0));
  });

  it("adds 0.001 USDC one thousand times and gets exactly 1 USDC", () => {
    const step = usdcTextToUnits("0.001");
    const steps: bigint[] = [];
    for (let i = 0; i < 1000; i++) steps.push(step);
    const total = sumUsdcUnits(steps);
    expect(total).toBe(usdcTextToUnits("1"));
    expect(usdcUnitsToText(total)).toBe("1");
    // The control: the same sum in floats is not 1. This is the error the
    // bigint helpers exist to remove.
    let float = 0;
    for (let i = 0; i < 1000; i++) float += 0.001;
    expect(float).not.toBe(1);
  });

  it("adds the ten settled legacy transfers to 12.5 USDC", () => {
    // Amounts from favour-receipt.json (ten public legacy records, second RPC).
    const amounts = [1900000, 1900000, 1900000, 950000, 950000, 950000, 950000, 1000000, 1000000, 1000000].map(b);
    expect(usdcUnitsToText(sumUsdcUnits(amounts))).toBe("12.5");
  });
});

describe("reward.ts keeps its eleven earlier exports", () => {
  const EARLIER = [
    "isPointsReward", "isEscrowV2Task", "FUNDING_REWARD_PER_USD", "FUNDING_REWARD_CAP", "fundingRewardPoints",
    "isFunded", "isRealMoney", "hasOnChainEscrow", "rewardAmountLabel", "rewardKindLabel", "sumRewards",
  ];

  it("exports the eleven earlier names plus the three new helpers, and nothing else", () => {
    expect(Object.keys(reward).sort()).toEqual([...EARLIER, "usdcUnitsToText", "usdcTextToUnits", "sumUsdcUnits"].sort());
  });

  it("leaves the float helpers behaving as before", () => {
    expect(reward.FUNDING_REWARD_PER_USD).toBe(10);
    expect(reward.FUNDING_REWARD_CAP).toBe(250);
    expect(reward.fundingRewardPoints(5)).toBe(50);
    expect(reward.fundingRewardPoints(1000)).toBe(250);
    expect(reward.rewardAmountLabel({ rewardType: "points", bountyUsdc: 10 })).toBe("10 pts");
    expect(reward.rewardAmountLabel({ rewardType: "usdc", bountyUsdc: 5 })).toBe("$5 USDC");
    expect(reward.rewardKindLabel({ rewardType: "points" })).toBe("points");
    const tasks = [
      { rewardType: "points" as const, escrowTxHash: null, onChainId: null, bountyUsdc: 10, status: "completed" as const },
      { rewardType: "usdc" as const, escrowTxHash: "0x" + "a".repeat(64), onChainId: 1, bountyUsdc: 0.001, status: "completed" as const },
    ];
    // The earlier float sum still rounds 0.001 away. Unchanged on purpose.
    expect(reward.sumRewards(tasks)).toEqual({ points: 10, usdc: 0 });
  });

  it("uses no float arithmetic in the three new helpers", () => {
    const src = readFileSync(join(__dirname, "..", "lib", "reward.ts"), "utf8");
    const start = src.indexOf("// EXACT USDC AMOUNTS");
    expect(start).toBeGreaterThan(0);
    const added = src.slice(start).replace(/\/\/.*$/gm, "");
    expect(added).not.toMatch(/\bNumber\s*[.(]|parseFloat|parseInt|Math\./);
  });
});
