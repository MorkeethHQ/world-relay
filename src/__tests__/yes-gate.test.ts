import { describe, expect, it } from "vitest";

// THE 10 YES GATE (pivot draft, 17 Oct 2026): a posted app stays pending until
// 10 distinct outside wallets say YES. Not ruled by Oscar yet; nothing reads it.

import { YES_GATE, gateState } from "@/lib/yes-gate";

const w = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const MAKER = w(999);
const OSCAR = w(0xa);
const FIXTURE = "0x7e57da7a000000000000000000000000000000b2";
const NONE = new Set<string>();
const tenOutside = Array.from({ length: 10 }, (_, i) => w(i + 100));

describe("the 10 YES gate", () => {
  it("publishes at 10 distinct outside wallets and holds at 9", () => {
    expect(YES_GATE).toBe(10);
    expect(gateState(tenOutside, MAKER, NONE)).toEqual({ yes: 10, of: 10, status: "published" });
    expect(gateState(tenOutside.slice(0, 9), MAKER, NONE)).toEqual({ yes: 9, of: 10, status: "pending" });
  });

  it("counts a wallet once, whatever its case", () => {
    const nine = tenOutside.slice(0, 9);
    expect(gateState([...nine, nine[0], nine[0].toUpperCase().replace("0X", "0x")], MAKER, NONE).status).toBe("pending");
  });

  it("never counts the maker, an excluded wallet, a fixture or a malformed address", () => {
    const nine = tenOutside.slice(0, 9);
    const exclude = new Set([OSCAR]);
    for (const extra of [MAKER, MAKER.toUpperCase().replace("0X", "0x"), OSCAR, FIXTURE, "0x123", "not a wallet"]) {
      expect(gateState([...nine, extra], MAKER, exclude)).toEqual({ yes: 9, of: 10, status: "pending" });
    }
  });

  it("holds an app with no votes, and caps nothing above the gate", () => {
    expect(gateState([], MAKER, NONE)).toEqual({ yes: 0, of: 10, status: "pending" });
    const twelve = [...tenOutside, w(500), w(501)];
    expect(gateState(twelve, MAKER, NONE)).toEqual({ yes: 12, of: 10, status: "published" });
  });
});
