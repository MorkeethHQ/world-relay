// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// TRY IT WITH AGENTS, the local preview of 10 Oct 2026. Two things must hold:
// the route is closed without the flag, and no step shows a stand-in without
// the line that says nothing ran.

const nav = vi.hoisted(() => ({ pushed: [] as string[], notFound: 0 }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/p/strive/try",
  useRouter: () => ({ push: (to: string) => { nav.pushed.push(to); }, replace: () => {}, prefetch: () => {}, back: () => {} }),
  notFound: () => { nav.notFound += 1; throw new Error("NEXT_NOT_FOUND"); },
}));

import { TryWithAgents } from "@/components/TryWithAgents";
import TryPage from "@/app/p/[id]/try/page";
import { CANDIDATE_LINE, DEBATE, FIXED_LINE, FORECAST, UNTESTED_IDEA, STANDIN_LINE, STEPS, TRACKS, failedSteps, finished, firstStop } from "@/lib/sim-standin";

const calls: string[] = [];
let kept: string | undefined;
beforeEach(() => {
  nav.pushed = []; nav.notFound = 0; calls.length = 0;
  kept = process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ project: { kind: "vote", id: "strive", name: "STRIVE", url: "https://strive.example/" } }), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (kept === undefined) delete process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW; else process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW = kept;
});

describe("the route", () => {
  it("is not found without the flag", async () => {
    delete process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW;
    await expect(TryPage({ params: Promise.resolve({ id: "strive" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW = "true";
    await expect(TryPage({ params: Promise.resolve({ id: "strive" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toBe(2);
  });

  it("opens with the flag set to 1", async () => {
    process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW = "1";
    expect(await TryPage({ params: Promise.resolve({ id: "strive" }) })).toBeTruthy();
  });
});

describe("the five steps", () => {
  it("prints the stand-in line on every step, and ends on the project page", async () => {
    render(<TryWithAgents id="strive" />);
    for (const title of ["Bring the thing", "Choose the panel", "Watch them try", "Hear the debate", "Compare the options"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      expect(screen.getByText(STANDIN_LINE)).toBeTruthy();
      if (title !== "Compare the options") fireEvent.click(screen.getByText(/^Next: /));
    }
    expect(screen.getByText("Not run")).toBeTruthy();
    expect(screen.getByText("Untested")).toBeTruthy();
    expect(screen.getByText(/makes no claim that a forecast is right/)).toBeTruthy();
    fireEvent.click(await screen.findByText("Back to STRIVE"));
    expect(nav.pushed).toEqual(["/p/strive"]);
  });

  it("locks the two links and says the fields change no trace", async () => {
    render(<TryWithAgents id="strive" />);
    expect(screen.getByText(FIXED_LINE)).toBeTruthy();
    expect((await screen.findByDisplayValue("https://strive.example/") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/^Candidate/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText(/^Next: /));
    expect(screen.queryByText(FIXED_LINE)).toBeNull();
  });

  it("Back on the first step returns to the project page", () => {
    render(<TryWithAgents id="strive" />);
    fireEvent.click(screen.getAllByLabelText("Back")[0]);
    expect(nav.pushed).toEqual(["/p/strive"]);
  });

  it("reads the project's name and nothing else: no model, no write", async () => {
    render(<TryWithAgents id="strive" />);
    await screen.findByDisplayValue("https://strive.example/");
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText(/^Next: /));
    expect(calls).toEqual(["/api/project/strive"]);
  });

  it("pauses at the first stop, opens its trace, and goes on to the end", () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    fireEvent.click(screen.getByLabelText("Step 3: Watch them try"));
    fireEvent.click(screen.getByText("Play the stand-in"));
    const stop = firstStop("base")!;
    act(() => { vi.advanceTimersByTime(650 * STEPS.length * 2); });
    expect(screen.getByText(`First stop: Condition A, step ${stop.stopAt}`)).toBeTruthy();
    expect(screen.getByLabelText("Condition A trace, Today's version")).toBeTruthy();
    expect(screen.getByText(/No checker ran in this preview/)).toBeTruthy();
    fireEvent.click(screen.getByText("Continue"));
    act(() => { vi.advanceTimersByTime(650 * STEPS.length * 2); });
    expect(screen.getByLabelText(/^Condition B: Finished/)).toBeTruthy();
    expect(screen.getByLabelText(/^Condition C: Stopped at step 6/)).toBeTruthy();
    expect(screen.getByText("Play again")).toBeTruthy();
  });

  it("marks a claim with no trace as a hypothesis and gives no score", () => {
    render(<TryWithAgents id="strive" />);
    fireEvent.click(screen.getByLabelText("Step 4: Hear the debate"));
    expect(screen.getAllByText(/^Hypothesis\. No trace supports this claim\.$/)).toHaveLength(DEBATE.filter((c) => !c.trace).length);
    expect(document.body.textContent).not.toMatch(/consensus|score|accuracy|\d+ ?%/i);
  });
});

describe("the stand-in file", () => {
  it("is consistent with itself", () => {
    expect(DEBATE.some((c) => !c.trace)).toBe(true);
    for (const c of DEBATE) if (c.trace) expect(c.trace.step).toBeLessThanOrEqual(STEPS.length);
    expect(finished("base")).toBe(1);
    expect(finished("candidate")).toBe(2);
    expect(failedSteps("base")).toEqual([4, 6]);
    expect(TRACKS.base).toHaveLength(3);
    expect(["up", "down", "none"]).toContain(FORECAST.panel);
    // The forecast covers the candidate's one change, and the second idea is apart from it.
    expect(CANDIDATE_LINE).toMatch(/picture step can be skipped/);
    expect(FORECAST.edit).toBe("Let the picture step be skipped.");
    expect(FORECAST.edit).not.toMatch(/World App/);
    expect(UNTESTED_IDEA).toMatch(/World App/);
  });
});
