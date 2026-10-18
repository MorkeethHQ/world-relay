import { describe, expect, it } from "vitest";
import { askLine, hostOf, pipsFor, progressLabel, voteNote } from "@/lib/apps-view";

describe("what the app screens say", () => {
  it("fills one pip per YES, never more than the gate", () => {
    expect(pipsFor(0, 10)).toEqual(Array(10).fill(false));
    expect(pipsFor(3, 10).filter(Boolean)).toHaveLength(3);
    expect(pipsFor(3, 10).slice(0, 3)).toEqual([true, true, true]);
    expect(pipsFor(14, 10).filter(Boolean)).toHaveLength(10);
    expect(progressLabel(3, 10)).toBe("3 of 10 YES");
  });

  it("counts the ask in words against the minimum", () => {
    expect(askLine("one two three", 20)).toBe("3 of 20 words");
    expect(askLine(Array(20).fill("w").join(" "), 20)).toBe("20 words");
  });

  it("names the host, not the whole link", () => {
    expect(hostOf("https://www.agentic-strava.vercel.app/x?y=1")).toBe("agentic-strava.vercel.app");
    expect(hostOf("not a link")).toBe("");
  });

  it("says what a vote did", () => {
    expect(voteNote({ ok: true, yes: 1, of: 10, status: "pending", first: true })).toBe("Your YES is in. 1 of 10.");
    expect(voteNote({ ok: true, yes: 1, of: 10, status: "pending", first: false })).toBe("You already said YES. 1 of 10.");
    expect(voteNote({ ok: true, yes: 10, of: 10, status: "published", first: true })).toBe("That was the 10th YES. This app is live now.");
    expect(voteNote({ error: "You cannot vote for your own app.", code: "own_app" })).toBe("You cannot vote for your own app.");
    expect(voteNote({ error: "Sign in to vote.", code: "reauth_required" })).toBe("Sign in to vote. Open FAVOUR in World App and sign in first.");
    expect(voteNote(null)).toBe("Your vote was not saved. Try again.");
  });
});
