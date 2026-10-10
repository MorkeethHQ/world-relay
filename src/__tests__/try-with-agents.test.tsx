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
import { CANDIDATE_LINE, DEBATE, FIXED_LINE, FORECAST, UNTESTED_IDEA, STANDIN_LINE, STEPS, TRACKS, failedSteps, finished, firstStop, standinOutcome } from "@/lib/sim-standin";

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

describe("the one screen", () => {
  const runTo = (bet: string) => {
    fireEvent.click(screen.getByRole("radio", { name: bet }));
    fireEvent.click(screen.getByText("Run the stand-in"));
    act(() => { vi.advanceTimersByTime(550 * STEPS.length * 2); });
  };

  it("needs a bet before Run, and two taps on this screen reach the result", () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    expect(screen.getByText(STANDIN_LINE)).toBeTruthy();
    expect(screen.getByText(new RegExp(FIXED_LINE.slice(0, 40)))).toBeTruthy();
    expect((screen.getByText("Pick a bet to run").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/^Result against your bet/)).toBeNull();
    runTo("More finish");
    expect(screen.getByText(/^Result against your bet/)).toBeTruthy();
    expect(screen.getByText("You bet more. The stand-in shows more.")).toBeTruthy();
    expect(screen.getByText("Your bet matches")).toBeTruthy();
    expect(screen.getByText("Not run")).toBeTruthy();
    expect(screen.getByText(/says nothing about the change or about your judgement/)).toBeTruthy();
    expect(screen.getByText(STANDIN_LINE)).toBeTruthy();
  });

  it("says so when the bet does not match", () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    runTo("Fewer finish");
    expect(screen.getByText("You bet fewer. The stand-in shows more.")).toBeTruthy();
    expect(screen.getByText("Your bet does not match")).toBeTruthy();
  });

  it("shows the link and the change as examples, with no field to type in", async () => {
    render(<TryWithAgents id="strive" />);
    expect(await screen.findByText("strive.example")).toBeTruthy();
    expect(screen.getByText(FORECAST.edit)).toBeTruthy();
    expect(screen.getAllByText("Example")).toHaveLength(2);
    expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("Back and the last button return to the project page", async () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    fireEvent.click(screen.getAllByLabelText("Back")[0]);
    runTo("Same");
    fireEvent.click(screen.getByText(/^Back to /));
    expect(nav.pushed).toEqual(["/p/strive", "/p/strive"]);
  });

  it("reads the project's name and nothing else: no model, no write", async () => {
    render(<TryWithAgents id="strive" />);
    await screen.findByText("strive.example");
    fireEvent.click(screen.getByRole("radio", { name: "Same" }));
    fireEvent.click(screen.getByText("Run the stand-in"));
    expect(calls).toEqual(["/api/project/strive"]);
  });

  it("shows each track's end and opens a trace", () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    runTo("More finish");
    const stop = firstStop("base")!;
    expect(stop).toMatchObject({ condition: "c", stopAt: 3 });
    fireEvent.click(screen.getByLabelText("Condition A, Today's version: Stopped at step 4. Open the trace"));
    expect(screen.getByLabelText("Condition A trace, Today's version")).toBeTruthy();
    expect(screen.getByText(/No checker ran in this preview/)).toBeTruthy();
    expect(screen.getByLabelText(/^Condition A, With the change: Finished/)).toBeTruthy();
    expect(screen.getByLabelText(/^Condition C, With the change: Stopped at step 3/)).toBeTruthy();
  });

  it("marks a claim with no trace as a hypothesis and gives no score", () => {
    vi.useFakeTimers();
    render(<TryWithAgents id="strive" />);
    runTo("More finish");
    fireEvent.click(screen.getByText("See what the agents said"));
    expect(screen.getAllByText(/^Hypothesis\. No trace supports this claim\.$/)).toHaveLength(DEBATE.filter((c) => !c.trace).length);
    expect(screen.getByText("Untested")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/consensus|score|accuracy|\d+ ?%|\$|USDC/i);
  });
});

describe("the stand-in file", () => {
  it("is consistent with itself", () => {
    expect(DEBATE.some((c) => !c.trace)).toBe(true);
    for (const c of DEBATE) if (c.trace) expect(c.trace.step).toBeLessThanOrEqual(STEPS.length);
    expect(finished("base")).toBe(1);
    expect(finished("candidate")).toBe(2);
    expect(failedSteps("base")).toEqual([3, 4]);
    expect(TRACKS.base).toHaveLength(3);
    expect(["up", "down", "none"]).toContain(FORECAST.panel);
    // The forecast covers the candidate's one change, and the second idea is apart from it.
    expect(CANDIDATE_LINE).toMatch(/picture step can be skipped/);
    expect(FORECAST.edit).toBe("Let the picture step be skipped.");
    expect(FORECAST.edit).not.toMatch(/sign-in/);
    expect(UNTESTED_IDEA).toMatch(/sign-in/);
    expect(standinOutcome()).toBe("up");
  });
});
