import { describe, it, expect } from "vitest";
import { validatePrompt, formatForDate, FORMATS } from "@/lib/daily-generator";
import { publicPrompt, type DailyPrompt } from "@/lib/daily";

// THE GENERATOR'S ONLY REAL JOB IS TO FAIL SAFE.
//
// The daily prompt is the gate in front of the whole app. A model that is down,
// rate-limited, or having a creative day must never be able to close that gate
// or put a question in front of every verified human on earth that nobody can
// answer from a bus. validatePrompt is the airlock, so it is tested hard.

const ok = (over: Partial<Record<string, unknown>> = {}) => ({
  question: "Are you inside or outside right now?",
  type: "choice",
  options: ["Inside", "Outside"],
  fact: "Most people underestimate how much of their day is spent indoors.",
  ...over,
});

describe("the airlock — what must never reach a user", () => {
  it("rejects a location-dependent question, however well written", () => {
    // The constraint that decides whether the gate delights or locks someone out
    // of their own app. These are great DATA prompts and belong in the weekly
    // mission, never in the gate.
    for (const q of [
      "What is the price of bread near you?",
      "How much does a coffee cost where you are?",
      "Photograph the nearest landmark, what is it?",
      "Go outside and tell us the weather?",
      "Look up today's exchange rate, what is it?",
    ]) {
      expect(validatePrompt(ok({ question: q })), q).toBeNull();
    }
  });

  it("rejects a question that is not a question", () => {
    expect(validatePrompt(ok({ question: "Tell us about your day" }))).toBeNull();
  });

  it("rejects questions too short to mean anything or too long for a phone", () => {
    expect(validatePrompt(ok({ question: "Hi?" }))).toBeNull();
    expect(validatePrompt(ok({ question: `${"a".repeat(115)}?` }))).toBeNull();
  });

  it("rejects a choice prompt with fewer than 2 or more than 5 options", () => {
    expect(validatePrompt(ok({ options: ["Only one"] }))).toBeNull();
    expect(validatePrompt(ok({ options: ["a", "b", "c", "d", "e", "f"] }))).toBeNull();
  });

  it("rejects duplicate options, which would split the world's answer in two", () => {
    expect(validatePrompt(ok({ options: ["Inside", "Inside"] }))).toBeNull();
  });

  it("rejects an unknown type rather than guessing", () => {
    expect(validatePrompt(ok({ type: "freetext" }))).toBeNull();
  });

  it("rejects junk without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], {}, { question: "?" }]) {
      expect(() => validatePrompt(junk)).not.toThrow();
      expect(validatePrompt(junk)).toBeNull();
    }
  });
});

describe("what it lets through", () => {
  it("accepts a well-formed choice prompt and keeps the fact", () => {
    const p = validatePrompt(ok());
    expect(p).not.toBeNull();
    expect(p!.options).toEqual(["Inside", "Outside"]);
    expect(p!.fact).toMatch(/indoors/);
  });

  it("accepts a number prompt without options", () => {
    const p = validatePrompt({
      question: "How many hours did you sleep?",
      type: "number",
      unit: "hours",
      fact: "Sleep need varies more between people than most assume.",
    });
    expect(p).not.toBeNull();
    expect(p!.type).toBe("number");
    expect(p!.unit).toBe("hours");
  });

  it("truncates an over-long fact rather than rejecting a good question", () => {
    const p = validatePrompt(ok({ fact: "x".repeat(500) }));
    expect(p).not.toBeNull();
    expect(p!.fact!.length).toBeLessThanOrEqual(220);
  });
});

describe("the fact never leaks to someone who has not answered", () => {
  it("publicPrompt strips it", () => {
    const full: DailyPrompt = {
      date: "2026-07-20",
      question: "Inside or outside?",
      type: "choice",
      options: ["Inside", "Outside"],
      fact: "The payoff nobody should see early.",
    };
    const pub = publicPrompt(full);
    expect(pub.fact).toBeUndefined();
    expect(pub.question).toBe(full.question);
    expect(JSON.stringify(pub)).not.toContain("payoff");
  });
});

describe("format rotation", () => {
  it("is deterministic — the same day is the same format for everyone", () => {
    expect(formatForDate("2026-08-01").id).toBe(formatForDate("2026-08-01").id);
  });

  it("varies across a week so the ritual does not feel like the same box", () => {
    const ids = new Set(
      ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].map(
        (d) => formatForDate(d).id,
      ),
    );
    expect(ids.size).toBeGreaterThan(1);
  });

  it("every format brief carries its own answer-anywhere shape", () => {
    for (const f of FORMATS) {
      expect(f.brief.length).toBeGreaterThan(10);
      expect(f.id).toMatch(/^[a-z_]+$/);
    }
  });
});

// ── Two bugs found by generating real prompts, not by reading the code ────────
// Both were the validator disagreeing with our own format spec, and both were
// invisible to tsc and to every test above. They only showed up as a generation
// success rate of 3/6 against the live API.
describe("the validator must agree with the formats we ask for", () => {
  it("accepts an imperative rating prompt — a '?' is not the only valid shape", () => {
    // The "rate" format is naturally imperative ("Rate today out of 10."). A bare
    // question-mark check rejected EVERY rate prompt, silently demoting them to
    // the fallback pool. Two of six generations, one whole format, lost.
    for (const q of [
      "Rate today out of 10.",
      "Rate how lucky you feel today.",
      "Score your morning out of 10.",
      "Count the windows you can see.",
    ]) {
      expect(validatePrompt({ question: q, type: "number", fact: "A true thing." }), q).not.toBeNull();
    }
  });

  it("still rejects a plain statement that is neither question nor imperative", () => {
    expect(validatePrompt({ question: "Tell us about your day today", type: "number", fact: "x" })).toBeNull();
  });

  it("allows a question long enough to carry a little context", () => {
    // 90 chars rejected legitimate spectrum questions. 110 is the real ceiling.
    const q = "How messy is the space you are sitting in right now, honestly, if you take a proper look around you?";
    expect(q.length).toBeGreaterThan(90);
    expect(validatePrompt({ question: q, type: "choice", options: ["Tidy", "Messy"], fact: "x" })).not.toBeNull();
  });

  it("the rate format tells the model to use a number, not 11 options", () => {
    // 0-10 emitted as 11 choice options hits the 2-5 cap and dies in validation.
    const rate = FORMATS.find((f) => f.id === "rate")!;
    expect(rate.brief).toMatch(/number/i);
  });
});
