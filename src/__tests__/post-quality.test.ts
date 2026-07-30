/**
 * Gibberish gate — born from the 2026-07-31 dogfood: "Hhfthhcucucyx" went
 * live on the public board with a $1 reward label. The gate must kill
 * keyboard-mash while never rejecting an honest favour description.
 */
import { describe, it, expect } from "vitest";
import { gibberishReason } from "@/lib/post-quality";

describe("gibberish gate rejects keyboard-mash", () => {
  it("rejects the incident string itself", () => {
    expect(gibberishReason("Hhfthhcucucyx")).not.toBeNull();
  });

  it("rejects single-token posts (a favour instructs a human)", () => {
    expect(gibberishReason("asdfghjkl")).not.toBeNull();
    expect(gibberishReason("teststring")).not.toBeNull();
    expect(gibberishReason("hello")).not.toBeNull();
  });

  it("rejects repeated-character mash", () => {
    expect(gibberishReason("aaaaaaaaaa help me")).not.toBeNull();
    expect(gibberishReason("do this !!!!!!!!!!")).not.toBeNull();
  });

  it("rejects multi-word consonant mash", () => {
    expect(gibberishReason("xkcdqwrtz plfgstn vbnmkl")).not.toBeNull();
    expect(gibberishReason("hjkl hjkl qwrtzu sdfghj")).not.toBeNull();
  });

  it("rejects vowel-starved letter noise", () => {
    expect(gibberishReason("Hhfthh cucyx brtk")).not.toBeNull();
  });
});

describe("gibberish gate passes honest descriptions", () => {
  const honest = [
    "Go to a place like Park, Playground, Groceries Store. Review it honestly.",
    "Take a photo of the sunrise from your window tomorrow morning",
    "Try my app and tell me what breaks first. Screenshots welcome.",
    "I dare you to compliment a stranger today. Photo proof.",
    "Buy me a coffee at the corner bakery and drop it at reception",
    "Review the strengths and weaknesses of my landing page", // "strengths": 5-consonant run must pass
    "Check whether the pharmacy on Rue Oberkampf is open right now",
  ];
  for (const d of honest) {
    it(`passes: "${d.slice(0, 40)}..."`, () => {
      expect(gibberishReason(d)).toBeNull();
    });
  }

  it("passes non-Latin scripts (structural rules only)", () => {
    expect(gibberishReason("请帮我在公园拍一张日落的照片 谢谢")).toBeNull();
    expect(gibberishReason("Сфотографируй закат в парке сегодня вечером")).toBeNull();
  });

  it("passes short-but-real two-word requests", () => {
    expect(gibberishReason("Walk my dog around the block today")).toBeNull();
  });
});
