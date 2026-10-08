import { describe, expect, it } from "vitest";
import { historyReason, showInHistory } from "@/lib/history-quality";

const ok = { description: "Check out yieldbound.com would you use it? Feedback the app!", proofNote: "I can use it occasionally", verificationResult: { verdict: "pass" } };

describe("which finished favours history shows", () => {
  it("keeps a real ask with a passed check and a proof", () => {
    expect(showInHistory(ok)).toBe(true);
    expect(showInHistory({ ...ok, proofNote: null, proofImageUrl: "https://blob.test/a.jpg" })).toBe(true);
    expect(showInHistory({ ...ok, description: "Watermelon or banana? Pick one and say why." })).toBe(true);
    expect(showInHistory({ ...ok, description: "無料で色々もらえたりゲームもできてウォレットまである" })).toBe(true); // no spaces, many letters
  });

  it("leaves out a favour whose check did not pass, whatever else it has", () => {
    for (const verdict of ["flag", "fail", null, undefined]) {
      expect(historyReason({ ...ok, verificationResult: { verdict } })).toBe("check_not_passed");
    }
    expect(historyReason({ ...ok, verificationResult: null })).toBe("check_not_passed");
  });

  it("leaves out an ask that is not a sentence", () => {
    for (const description of ["0xc9c064d0eb662b0ce2a233f3ec16afe5485a8a9b", "Apa apa la ba", "https://x.com/i/status/1", "ok", "", null, "test 123"]) {
      expect(historyReason({ ...ok, description }), String(description)).toBe("ask_not_a_sentence");
    }
  });

  it("leaves out a favour with no proof at all", () => {
    expect(historyReason({ ...ok, proofNote: "  ", proofImageUrl: null, proofImages: [] })).toBe("no_proof");
  });
});
