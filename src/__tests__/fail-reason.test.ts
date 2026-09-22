import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// A FAILED PROOF SAYS WHY, TO THE PERSON (2026-09-22). The last 12 real verdicts
// were 6 pass and 6 fail, and the fails were weak proofs, so the check stays as it
// is. But a person who failed read "Try again with better proof", or a sentence
// written to a judge about "the claimant". The verifier now also returns a tip: one
// short, kind line to the person. It is display only.

const replies: string[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: async () => ({ content: [{ type: "text", text: replies.shift() ?? "{}" }] }) }; },
}));

import { verifyProof } from "@/lib/verify-proof";
import { cleanTip, personTip } from "@/lib/proof-tip";

describe("the tip is safe to show a person", () => {
  it("drops model tags and extra space", () => {
    expect(cleanTip("[Claude Sonnet 4.6]  Say what it smells like   where you are.")).toBe("Say what it smells like where you are.");
  });
  it("never shows a shaming line", () => {
    for (const t of ["That was a lazy placeholder, try harder.", "This looks like spam.", "Low-effort answer.", "Obviously fake photo."]) {
      expect(cleanTip(t), t).toBeUndefined();
    }
  });
  it("keeps it short", () => {
    const long = "Tell us one real smell from where you are right now. " + "Mention the place and the moment in your own words so it is clearly yours. ".repeat(4);
    expect(cleanTip(long)!.length).toBeLessThanOrEqual(161);
  });
  it("ignores anything that is not a sentence", () => {
    expect(cleanTip(undefined)).toBeUndefined();
    expect(cleanTip(42)).toBeUndefined();
    expect(cleanTip("ok")).toBeUndefined();
  });
});

describe("what the person reads", () => {
  it("nothing extra on a pass", () => {
    expect(personTip({ verdict: "pass", tip: "whatever" }, "custom")).toBeNull();
  });
  it("the AI's tip on a fail", () => {
    expect(personTip({ verdict: "fail", tip: "Say what today smells like where you are." }, "custom")).toBe("Say what today smells like where you are.");
  });
  it("a plain line for the category when the tip is missing or unkind", () => {
    expect(personTip({ verdict: "fail" }, "photo")).toMatch(/photo you took yourself/);
    expect(personTip({ verdict: "fail", tip: "lazy answer" }, "custom")).toMatch(/Answer the question itself/);
    expect(personTip({ verdict: "fail" }, "unknown-kind")).toMatch(/what the favour asks for/);
  });
  it("the social fallback asks for a link, as the favour does", () => {
    expect(personTip({ verdict: "fail" }, "social")).toMatch(/link/);
  });
});

describe("the verifier returns the tip and the verdict is untouched", () => {
  it("reads the tip from the model's JSON", async () => {
    replies.push(JSON.stringify({ verdict: "fail", reasoning: "The response 'Nice' is a single word.", confidence: 0.9, tip: "Say what today smells like where you are, in a sentence." }));
    const r = await verifyProof("What does today smell like where you are?", [], "Nice", "custom");
    expect(r.verdict).toBe("fail");
    expect(r.reasoning).toMatch(/single word/);
    expect(r.tip).toBe("Say what today smells like where you are, in a sentence.");
  });
  it("an old-style reply without a tip still parses to the same verdict", async () => {
    replies.push(JSON.stringify({ verdict: "pass", reasoning: "Genuine.", confidence: 0.8 }));
    const r = await verifyProof("q", [], "a real answer", "custom");
    expect(r.verdict).toBe("pass");
    expect(r.tip).toBeUndefined();
  });
});

describe("wiring", () => {
  const lib = readFileSync(join(__dirname, "../lib/verify-proof.ts"), "utf8");
  const route = readFileSync(join(__dirname, "../app/api/verify-proof/route.ts"), "utf8");
  const feed = readFileSync(join(__dirname, "../components/Feed.tsx"), "utf8");
  it("the prompt asks for a kind second-person tip", () => {
    expect(lib).toMatch(/"tip": "For fail or flag only: one short sentence TO the person/);
  });
  it("the social favour accepts a link, and the prompt follows the task's own ask", () => {
    expect(lib).toMatch(/and so is a link to the post\. Ask for what the task itself asks for\./);
    expect(lib).toMatch(/social: "[^"]*usually a link to the post in their note, or a screenshot of it\. Either is valid\./);
  });
  it("the fail notification carries the tip, not the generic line", () => {
    expect(route).not.toMatch(/Try again with better proof/);
    expect(route).toMatch(/body: `Not accepted yet: [^`]*\$\{personTip\(result, task\.category\)\}/);
  });
  it("the result screen shows the tip on a fail", () => {
    expect(feed).toMatch(/result\.verdict === "fail" && result\.tip \?/);
    expect(feed).toMatch(/tip: typeof data\.personTip === "string"/);
  });
  it("no verdict, credit or payout code reads the tip", () => {
    const reads = route.split("\n").filter((l) => /\.tip\b|personTip/.test(l));
    for (const l of reads) expect(l, l).toMatch(/personTip\(|tip: consensusResult\.tip|import/);
  });
});
