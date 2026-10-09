// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// THE FAVOURS BOARD in a browser page (jsdom), with its reads answered by one
// table and its buttons tapped. The local app has no database, so the real page
// shows the empty state; the filled state is proven here (10 Oct 2026).

const nav = vi.hoisted(() => ({ path: "/favours", pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({
    push: (to: string) => { nav.pushed.push(to); nav.path = to; },
    replace: () => {},
    prefetch: () => {},
    back: () => {},
  }),
}));

import { FavoursBoard, doneToday, targetLine, todayOf, whoAsked } from "@/components/FavoursBoard";
import type { Task } from "@/lib/types";

const ME = "0x1111111111111111111111111111111111111111";
const POSTER = "0x2222222222222222222222222222222222222222";
const NOW = Date.now();
const LATER = new Date(NOW + 3 * 86_400_000).toISOString();
const SEEDED = "Tell us one thing the sign-up screen got wrong.";
const MONEY_ASK = "Walk past the bakery on Main Street and say if it is open.";
const WELCOME_ASK = "Say hello in the room of an app you like.";

function task(over: Partial<Task>): Task {
  return {
    id: "t1", poster: POSTER, claimant: null, category: "feedback", description: SEEDED, location: "Anywhere", lat: null, lng: null,
    bountyUsdc: 10, deadline: LATER, status: "open", proofImageUrl: null, proofImages: null, proofNote: null, verificationResult: null,
    attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null,
    claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false,
    pendingRelease: false, maxCompletions: 1, completionCount: 0, createdAt: new Date(NOW - 3600_000).toISOString(),
    ...over,
  } as Task;
}

const points = task({ id: "t1" });
const unfundedMoney = task({ id: "t2", description: MONEY_ASK, category: "check-in", rewardType: "usdc-v2", bountyUsdc: 5, maxCompletions: 4, completionCount: 1 });
const welcomeInstance = task({ id: "w-inst", description: WELCOME_ASK, category: "social", bountyUsdc: 5, campaignId: "first-favour" });
const welcomeView = {
  campaign: { id: "first-favour", name: "Welcome", tagline: "", description: "", heroImage: null, endsAt: "2026-12-31T00:00:00Z", rewardPerTask: 5 },
  provenance: {}, authenticated: true, done: 1,
  steps: [
    { sourceTaskId: "w0", description: "Welcome step 1", category: "feedback", points: 5, state: "done" },
    { sourceTaskId: "w1", description: WELCOME_ASK, category: "social", points: 5, state: "todo" },
  ],
};

let answers: Record<string, { status?: number; body: unknown }>;
let calls: { path: string; method: string }[];

beforeEach(() => {
  nav.path = "/favours";
  nav.pushed = [];
  calls = [];
  answers = {
    "/api/tasks": { body: { tasks: [points, unfundedMoney] } },
    "/api/me/contributions": { body: { authenticated: true, contributions: [] } },
    "/api/welcome": { body: { welcome: null } },
    "/api/welcome/start": { body: { task: welcomeInstance } },
    "/api/campaigns/company": { body: { campaigns: [] } },
    "/api/jury/record": { body: { authenticated: true, record: { judged: 3, correct: 2 }, qualified: false, flaggedWaiting: 0 } },
    "/api/jury": { body: { cards: [], practice: true, waiting: 0 } },
    "/api/escrow-v2": { body: { enabled: false } },
    "/api/v1/query": { body: [] },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    calls.push({ path, method: init?.method ?? "GET" });
    const a = answers[path];
    if (!a) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the favours board, filled", () => {
  it("shows a seeded favour and its reward text", async () => {
    render(<FavoursBoard userId={ME} />);
    expect(await screen.findByText(SEEDED)).toBeTruthy();
    expect(screen.getByText("10 pts")).toBeTruthy();
    expect(screen.getByText("$5 USDC")).toBeTruthy();
  });

  it("a tap on a favour row opens the proof step, the same one the old board opens", async () => {
    render(<FavoursBoard userId={ME} />);
    fireEvent.click(await screen.findByLabelText(`Open favour: ${SEEDED}`));
    // SubmitProof: a points favour is a quick ask, its bar says "Answer", and the
    // favour's own words are on the screen with Cancel back to the board.
    expect(await screen.findByText("Answer")).toBeTruthy();
    expect(screen.getByText(SEEDED)).toBeTruthy();
    expect(nav.pushed).toEqual([]);
    fireEvent.click(screen.getAllByText("Cancel")[0]);
    expect(await screen.findByLabelText(`Open favour: ${SEEDED}`)).toBeTruthy();
  });

  it("a USDC favour with no deposit is gray, not green, and says so", async () => {
    render(<FavoursBoard userId={ME} />);
    const amount = await screen.findByText("$5 USDC");
    const reward = amount.parentElement!;
    expect(reward.getAttribute("data-funded")).toBe("no");
    expect(reward.className).not.toMatch(/money/);
    expect(screen.getByText("Funds on accept")).toBeTruthy();
    // a points favour is never green either
    expect(screen.getByText("10 pts").parentElement!.className).not.toMatch(/money/);
  });

  it("draws a target bar only for a favour that takes more than one reply", async () => {
    render(<FavoursBoard userId={ME} />);
    await screen.findByText(SEEDED);
    expect(screen.getByLabelText("1 of 4 done")).toBeTruthy();
    expect(screen.queryByLabelText("0 of 1 done")).toBeNull();
  });

  it("draws the reviewer's graded calls from the server's record", async () => {
    render(<FavoursBoard userId={ME} />);
    expect(await screen.findByLabelText("3 of 10 graded calls")).toBeTruthy();
    expect(screen.getByText("Review favours", { selector: "button" })).toBeTruthy();
  });

  it("the banner shows open favours and zeros for the day", async () => {
    render(<FavoursBoard userId={ME} />);
    await screen.findByText(SEEDED);
    expect(screen.getByText("open").previousSibling!.textContent).toBe("2");
    expect(screen.getByText("done today").previousSibling!.textContent).toBe("0");
    expect(screen.getByText("pts today").previousSibling!.textContent).toBe("0");
    expect(screen.getByText("Open favours").textContent).toContain("2");
  });

  it("Welcome Open calls /api/welcome/start once and opens the step on the instance", async () => {
    answers["/api/welcome"] = { body: { welcome: welcomeView } };
    answers["/api/tasks"] = { body: { tasks: [] } };
    render(<FavoursBoard userId={ME} />);
    expect(await screen.findByLabelText("1 of 2 done")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open the next Welcome favour"));
    // A Welcome instance is a campaign task, so the step keeps its full title.
    expect(await screen.findByText("Submit proof")).toBeTruthy();
    expect(screen.getByText(WELCOME_ASK)).toBeTruthy();
    expect(calls.filter((c) => c.path === "/api/welcome/start" && c.method === "POST")).toHaveLength(1);
  });

  it("Welcome Open shows the server's own words when the step cannot be opened", async () => {
    answers["/api/welcome"] = { body: { welcome: welcomeView } };
    answers["/api/welcome/start"] = { status: 409, body: { error: "You already did this one." } };
    render(<FavoursBoard userId={ME} />);
    fireEvent.click(await screen.findByLabelText("Open the next Welcome favour"));
    expect(await screen.findByText("You already did this one.")).toBeTruthy();
    expect(screen.queryByText("Submit proof")).toBeNull();
  });

  it("the ask pill opens the old board's composer", async () => {
    render(<FavoursBoard userId={ME} />);
    fireEvent.click(await screen.findByText("Ask a one-off favour"));
    expect(await screen.findByPlaceholderText("Ask anyone for something quick")).toBeTruthy();
    expect(screen.getByText("Ask for a favour")).toBeTruthy();
  });

  it("the composer's place or USDC link opens the quick post step", async () => {
    render(<FavoursBoard userId={ME} />);
    fireEvent.click(await screen.findByText("Ask a one-off favour"));
    // The link appears once an ask is typed, as on the old board.
    fireEvent.change(await screen.findByPlaceholderText("Ask anyone for something quick"), { target: { value: "Tell me the name of the nearest bakery to you." } });
    fireEvent.click(await screen.findByText("At a specific place, or for USDC"));
    expect(await screen.findByText(/Post · \d+ pts/)).toBeTruthy();
  });
});

describe("the favours board, empty, loading and broken", () => {
  it("the empty state says what to do next and holds the one dark button", async () => {
    answers["/api/tasks"] = { body: { tasks: [] } };
    render(<FavoursBoard userId={ME} />);
    expect(await screen.findByText("No open favour today")).toBeTruthy();
    expect(screen.getByText("open").previousSibling!.textContent).toBe("0");
    fireEvent.click(screen.getByText("Post your own app"));
    expect(nav.pushed).toEqual(["/post"]);
  });

  it("the error state offers Try again, and the retry reads the board", async () => {
    answers["/api/tasks"] = { status: 500, body: { error: "down" } };
    render(<FavoursBoard userId={ME} />);
    expect(await screen.findByText(/could not be read/)).toBeTruthy();
    answers["/api/tasks"] = { body: { tasks: [points] } };
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText(SEEDED)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it("the loading state is present before the data arrives", async () => {
    render(<FavoursBoard userId={ME} />);
    expect(screen.getByLabelText("Reading favours")).toBeTruthy();
    expect(screen.getByText("Reading favours…")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Reading favours")).toBeNull());
  });
});

describe("the small rules", () => {
  it("never names a wallet address", () => {
    expect(whoAsked({ poster: POSTER, agent: null }, () => "0x2222...2222")).toBe("A person asked");
    expect(whoAsked({ poster: POSTER, agent: null }, () => "@jonas")).toBe("@jonas asked");
    expect(whoAsked({ poster: "agent:openclaw", agent: { name: "OpenClaw" } as Task["agent"] }, () => "")).toBe("OpenClaw · FAVOUR agent");
  });

  it("gives a target only above one reply", () => {
    expect(targetLine({ maxCompletions: 1, completionCount: 0 })).toBeNull();
    expect(targetLine({ maxCompletions: 100, completionCount: 7 })).toEqual({ done: 7, of: 100 });
  });

  it("counts only today's contributions and the points the server paid for them", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const c = (at: string, points = 1) => ({ taskId: "x", description: "", points, streakBonus: 0, proofImageUrl: null, proofNote: null, campaignId: null, at });
    expect(doneToday([c("2026-10-10T01:00:00Z"), c("2026-10-09T23:59:00Z")], now)).toBe(1);
    expect(todayOf([c("2026-10-10T01:00:00Z", 7), c("2026-10-10T02:00:00Z", 5), c("2026-10-09T23:59:00Z", 100)], now)).toEqual({ done: 2, points: 12 });
    expect(todayOf([], now)).toEqual({ done: 0, points: 0 });
  });
});
