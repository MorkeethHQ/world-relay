import { describe, it, expect } from "vitest";
import { personalDataAsk, safetyClauseProblem } from "@/lib/favour-safety";

// 2026-10-05, cold walk item 1. The pack review stayed green on a row that asked
// for a passport photo, a phone number and a home address. This is the check
// that was missing. It reads the POSTED text only, because that is all a person sees.
describe("a favour must not ask for personal data", () => {
  const BAD: Array<[string, string]> = [
    ["identity document", "Photo your passport next to today's newspaper so we know you are real."],
    ["identity document", "Hold up your ID card or driving licence and take a photo."],
    ["contact detail", "Tell us your phone number and the best time to call."],
    ["contact detail", "Reply with your email address and your full name."],
    ["home or precise location", "Send your home address and a photo of your front door."],
    ["home or precise location", "Photo the street outside right now and name your town."],
    ["home or precise location", "Share your exact location as GPS coordinates."],
    ["face of another person", "Take a photo of a stranger on the bus and say what they are wearing."],
    ["face of another person", "Photo the cashier at your nearest shop, face visible."],
    ["financial screen", "Photo the ATM screen and say if it charges a fee."],
    ["financial screen", "Screenshot your bank app balance and tell us your city."],
    ["account or network identifier", "Run a speed test on your phone, screenshot the result and name your network."],
    ["account or network identifier", "Tell us your Wi-Fi name and your username on X."],
  ];
  it.each(BAD)("%s: %s", (kind, text) => {
    expect(personalDataAsk(text)?.kind).toBe(kind);
  });

  it("the walker's row is rejected on every count", () => {
    const hit = personalDataAsk("Send a photo of your passport, your phone number and your home address.");
    expect(hit).not.toBeNull();
  });

  const FINE = [
    "Photo the opening hours sign on the pharmacy nearest you, and say the day and time you took it.",
    "Name one free thing to do in your town this week. Say where and when.",
    "Tell us one thing about where you live that outsiders always get wrong.",
    "What is the cheapest filling hot meal within a ten minute walk of you? Name the place, the dish and the price.",
  ];
  it.each(FINE)("an ordinary ask passes: %s", (text) => {
    expect(personalDataAsk(text)).toBeNull();
  });

  it("a declared safety clause is not read as an ask, and only that clause is excused", () => {
    const safety = "No people, no phone numbers and no number plates in the photo.";
    expect(personalDataAsk(`Photo a public recycling point near you. ${safety}`, safety)).toBeNull();
    // The same words outside the declared clause are still caught.
    expect(personalDataAsk("Photo a public recycling point and any phone numbers on it.", safety)?.kind).toBe("contact detail");
  });

  it("a safety clause must limit, never ask", () => {
    expect(safetyClauseProblem("No people in the photo.")).toBeNull();
    expect(safetyClauseProblem("Words only: do not send a screenshot.")).toBeNull();
    expect(safetyClauseProblem("Sign only: no people, no number plates.")).toBeNull();
    expect(safetyClauseProblem("No kidding, send your passport.")).toMatch(/asks/);
    expect(safetyClauseProblem("Please include your phone number.")).toMatch(/limit/);
    expect(safetyClauseProblem("No.")).toMatch(/short/);
  });
});
