import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { personalDataAsk, safetyClauseProblem } from "@/lib/favour-safety";

// THE PERSONAL DATA CHECK (reworked 2026-10-05 after a second cold walk).
//
// The first version was a list of exact phrases. A walker wrote five plain unsafe
// asks and it caught none of them, and it excused anything placed inside the
// declared safety clause. This file holds (1) those six asks as cases that must
// go red, (2) the rules about negation, and (3) a MEASUREMENT on two frozen sets of
// 20 unsafe and 20 safe asks each (fixtures/personal-data-asks.json).
const set = JSON.parse(readFileSync("src/__tests__/fixtures/personal-data-asks.json", "utf8")) as {
  walker: Array<{ kind: string; text: string }>;
  unsafe: string[];
  safe: string[];
  unsafe2: string[];
  safe2: string[];
};

describe("the six asks the first version missed", () => {
  it.each(set.walker.map((w) => [w.kind, w.text]))("%s: %s", (_kind, text) => {
    expect(personalDataAsk(text)).not.toBeNull();
  });

  it("an ask hidden inside a declared safety clause is caught: the whole posted text is read", () => {
    const hit = personalDataAsk("Photo the opening hours sign on the pharmacy nearest you. No people in the photo, only your passport held next to the sign.");
    expect(hit?.kind).toBe("identity document");
    expect(safetyClauseProblem("No people in the photo, only your passport held next to the sign.")).not.toBeNull();
  });
});

describe("negation: a thing that is forbidden is not a thing that is asked for", () => {
  const OK = [
    "Photo the sign. No people and no number plates in the photo.",
    "Words only: no photo, no names and no phone numbers.",
    "Tell us in one sentence. Do not send a screenshot.",
    "Photo the entrance without any people in it.",
    "Never include your address or your phone number.",
  ];
  it.each(OK)("allowed: %s", (text) => { expect(personalDataAsk(text)).toBeNull(); });

  const NOT_OK: Array<[string, string]> = [
    ["an exception after the ban", "No people in the photo, only your passport held next to the sign."],
    ["an exception after the ban", "No names, but do give your phone number."],
    ["a ban on one thing, an ask for another", "No kidding, send your passport."],
    ["a ban on one thing, an ask for another", "No tricks: tell us your home address."],
    ["the ask comes first", "Give your phone number. No spam, we promise."],
    ["a negator that governs something else", "Do not worry, just photo your bank statement."],
  ];
  it.each(NOT_OK)("caught, %s: %s", (_why, text) => { expect(personalDataAsk(text)).not.toBeNull(); });
});

describe("a safety clause must limit, never ask", () => {
  it("accepts clauses that only limit", () => {
    for (const s of ["No people in the photo.", "Words only: do not send a screenshot.", "Sign only: no people and no number plates.", "Words only, no photo."]) {
      expect(safetyClauseProblem(s), s).toBeNull();
    }
  });
  it("refuses a clause that asks, however it starts", () => {
    expect(safetyClauseProblem("No kidding, send your passport.")).not.toBeNull();
    expect(safetyClauseProblem("Please include your phone number.")).not.toBeNull();
    expect(safetyClauseProblem("No.")).toMatch(/short/);
    expect(safetyClauseProblem("Take care out there, friend.")).toMatch(/limit/);
  });
});

// THE MEASUREMENT. Two sets, and they do not mean the same thing.
//
// SET 1 (unsafe, safe) was written before the reworked check, but by the same
// person in the same sitting. The check scores 20 of 20 on both halves. That is
// shared authorship showing, and it is NOT the check's reach.
//
// SET 2 (unsafe2, safe2) was written after the check was frozen in commit b71b5fe,
// in wording that avoids the obvious nouns and possessives. The check was not
// tuned to it. Its score there is the honest number: it catches a quarter of
// plainly unsafe asks. One fix was made after the first measurement of set 2, a
// pattern that matched the word "long" as if it were "longitude"; that fix LOWERED
// the score from 6 to 5.
//
// Every miss and every false alarm is listed by name. They are true statements
// about what this aid does not see. Do not edit a case to change a number.
describe("known reach, measured on the frozen sets", () => {
  const score = (unsafe: string[], safe: string[]) => ({
    unsafeCaught: unsafe.filter((t) => personalDataAsk(t) !== null).length,
    unsafeMissed: unsafe.filter((t) => personalDataAsk(t) === null),
    safePassed: safe.filter((t) => personalDataAsk(t) === null).length,
    safeFalseAlarms: safe.filter((t) => personalDataAsk(t) !== null),
  });

  it("each set is 20 unsafe and 20 safe", () => {
    for (const k of ["unsafe", "safe", "unsafe2", "safe2"] as const) expect(set[k], k).toHaveLength(20);
  });

  it("set 1, same sitting as the check: 20 of 20 and 20 of 20, which is not reach", () => {
    expect(score(set.unsafe, set.safe)).toEqual({ unsafeCaught: 20, unsafeMissed: [], safePassed: 20, safeFalseAlarms: [] });
  });

  it("set 2, written after the check was frozen: 5 of 20 unsafe asks caught, 17 of 20 safe asks passed", () => {
    expect(score(set.unsafe2, set.safe2)).toEqual({
      unsafeCaught: 5,
      unsafeMissed: MISSED_2,
      safePassed: 17,
      safeFalseAlarms: FALSE_ALARMS_2,
    });
  });

  it("one of the 5 catches in set 2 is for the wrong reason", () => {
    // "does it face the road" is caught as a face. The ask is about a home.
    expect(personalDataAsk("Which floor is the bedroom window on, and does it face the road?")).toEqual({ kind: "face or other people", match: "face" });
  });
});

const MISSED_2 = [
  "Point the camera at whoever is cooking tonight and press record.",
  "Take a mirror shot before leaving the house this morning.",
  "Copy the long number from the front of the plastic used at the till.",
  "What gets deducted from the monthly wage before it lands?",
  "Show the pattern used to open the handset.",
  "Paste the link to the page where the holiday pictures are.",
  "Photograph the envelope from the tax office that came last week.",
  "Tell us which clinic the appointment is at on Thursday and what for.",
  "Give the digits a courier would dial at the entrance.",
  "Describe the route walked every morning, with the time of leaving.",
  "Photo the registration document of the car.",
  "Show the top of the chat list in the messaging app.",
  "What is the name on the doorbell?",
  "Photo the boarding card for the next trip.",
  "Tell us the hour the flat is usually left unlocked."
];
const FALSE_ALARMS_2 = [
  "Name a medicine-free way people in your country treat a cold.",
  "Photo a sign showing the phone number of the tourist office in your town.",
  "What is the first name most common among people your age in your country?"
];
