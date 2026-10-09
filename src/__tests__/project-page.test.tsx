// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// THE PROJECT PAGE in a browser page (jsdom), for the three kinds of app it
// serves (DESIGN-SYSTEM.md, "Project page", 10 Oct 2026). One read of
// /api/project/<id>; the write step and the check are not touched here.

const nav = vi.hoisted(() => ({ path: "/p/x", pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({
    push: (to: string) => { nav.pushed.push(to); nav.path = to; },
    replace: () => {},
    prefetch: () => {},
    back: () => {},
  }),
}));

import { ProductScreen, fromLine } from "@/components/ProductScreen";

const NOW = new Date().toISOString();
const ASK = "Tell us where the sign-up breaks on your phone.";
const picture = { source: "none", url: null, icon: null, credit: "", fallback: { initial: "S", hue: 200 } };

const favour = {
  kind: "favour", id: "draft_1",
  product: { id: "draft_1", name: "STRIVE", line: "Post agent runs as cards", ask: ASK, points: 10, productUrl: "https://striverun.app", host: "striverun.app", reviewTaskId: "t-review", picture, accepted: 2, acceptedIsFloor: false, makerChecked: true, company: "STRIVE" },
  round: { ask: ASK, accepted: 2, acceptedIsFloor: false, target: 5, progress: "2 of 5 reviews", reviews: [{ participant: "jonas", at: NOW, kind: "review" }, { participant: "lina", at: NOW, kind: "review" }] },
};
const vote = { kind: "vote", id: "wave-radio", name: "Wave Radio", line: "Radio for the open web", url: "https://waveradio.example", host: "waveradio.example", picture, votes: 4 };
const launch = { kind: "launch", id: "hn_1", name: "Example launch", line: "A thing from Show HN", url: "https://launch.example", host: "launch.example", picture, source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=1", score: 52 };

let answers: Record<string, { status?: number; body: unknown }>;
let calls: { path: string; method: string }[];

beforeEach(() => {
  nav.path = "/p/x";
  nav.pushed = [];
  calls = [];
  window.scrollTo = () => {};
  answers = {
    "/api/project/draft_1": { body: { project: favour } },
    "/api/project/wave-radio": { body: { project: vote } },
    "/api/project/hn_1": { body: { project: launch } },
    "/api/votes": { body: { from: "x", signedIn: true, rows: [{ id: "wave-radio", votes: 4, mine: false }] } },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    calls.push({ path, method: init?.method ?? "GET" });
    if (path === "/api/votes" && init?.method === "POST") return new Response(JSON.stringify({ votes: 5, stamps: ["vote:wave-radio"] }), { status: 200 });
    const a = answers[path];
    if (!a) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an app posted on FAVOUR", () => {
  it("shows the ask, the round's bar and rows, and the dark Review button", async () => {
    render(<ProductScreen id="draft_1" />);
    expect(await screen.findByText("Review · 10 pts")).toBeTruthy();
    expect(screen.getAllByText(ASK).length).toBeGreaterThan(0);
    expect(screen.getByText("Feedback round")).toBeTruthy();
    expect(screen.getByLabelText("2 of 5 reviews")).toBeTruthy();
    expect(screen.getByText("jonas")).toBeTruthy();
    expect(screen.getByText("lina")).toBeTruthy();
    expect(screen.getByText(/Posted on FAVOUR · striverun.app · by STRIVE/)).toBeTruthy();
    expect(screen.queryByText("Vote")).toBeNull();
  });

  it("draws no bar and says so when no review is in and the campaign holds no target", async () => {
    answers["/api/project/draft_1"] = { body: { project: { ...favour, round: { ...favour.round, accepted: 0, target: null, progress: "0 reviews in", reviews: [] } } } };
    render(<ProductScreen id="draft_1" />);
    expect(await screen.findByText("No review in yet. Be the first.")).toBeTruthy();
    expect(screen.getByText("0 reviews in")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("Review opens the write step, whose button is Send for check", async () => {
    render(<ProductScreen id="draft_1" />);
    fireEvent.click(await screen.findByText("Review · 10 pts"));
    expect(await screen.findByText("Send for check")).toBeTruthy();
    expect(screen.getByLabelText("Your review, or a link to it")).toBeTruthy();
    expect(nav.pushed).toEqual([]);
  });

  it("the Talk pill opens /talk/<id>", async () => {
    render(<ProductScreen id="draft_1" />);
    fireEvent.click(await screen.findByLabelText("Talk about STRIVE"));
    expect(nav.pushed).toEqual(["/talk/draft_1"]);
  });
});

describe("a vote candidate", () => {
  it("shows Vote as the dark button and the count the server gave", async () => {
    render(<ProductScreen id="wave-radio" />);
    expect(await screen.findByText("Vote")).toBeTruthy();
    expect(screen.getByText(/Vote list · waveradio.example · 4 votes/)).toBeTruthy();
    expect(screen.queryByText(/Review ·/)).toBeNull();
    expect(screen.queryByText("Feedback round")).toBeNull();
  });

  it("Vote is the existing POST to /api/votes and shows the server's count back", async () => {
    render(<ProductScreen id="wave-radio" />);
    fireEvent.click(await screen.findByLabelText("Vote for Wave Radio"));
    expect(await screen.findByText("Voted · 5")).toBeTruthy();
    expect(calls.filter((c) => c.path === "/api/votes" && c.method === "POST")).toHaveLength(1);
  });

  it("draws no count when the server gave none", async () => {
    answers["/api/project/wave-radio"] = { body: { project: { ...vote, votes: null } } };
    render(<ProductScreen id="wave-radio" />);
    expect(await screen.findByText("Vote")).toBeTruthy();
    expect(screen.queryByText(/votes?$/)).toBeNull();
    expect(screen.getByText("Vote list · waveradio.example")).toBeTruthy();
  });
});

describe("an outside launch", () => {
  it("shows Open as the dark button and where it is from", async () => {
    render(<ProductScreen id="hn_1" />);
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.getByText("From Hacker News · 52 points · launch.example")).toBeTruthy();
    expect(screen.getByText("Open").closest("a")!.getAttribute("href")).toBe("https://launch.example");
    fireEvent.click(screen.getByLabelText("Talk about Example launch"));
    expect(nav.pushed).toEqual(["/talk/hn_1"]);
  });
});

describe("missing, broken and loading", () => {
  it("a 404 says the app is not on FAVOUR", async () => {
    render(<ProductScreen id="nope" />);
    expect(await screen.findByText("This app is not on FAVOUR")).toBeTruthy();
  });

  it("a failed read offers Try again", async () => {
    answers["/api/project/draft_1"] = { status: 500, body: { error: "down" } };
    render(<ProductScreen id="draft_1" />);
    expect(await screen.findByText("Try again")).toBeTruthy();
    answers["/api/project/draft_1"] = { body: { project: favour } };
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Review · 10 pts")).toBeTruthy();
  });

  it("loads with the fill-up", () => {
    render(<ProductScreen id="draft_1" />);
    expect(screen.getByLabelText("Reading this app")).toBeTruthy();
  });

  it("writes where an app is from", () => {
    expect(fromLine(launch as never)).toBe("From Hacker News · 52 points · launch.example");
    expect(fromLine({ ...vote, votes: 1 } as never)).toBe("Vote list · waveradio.example · 1 vote");
    expect(fromLine({ ...favour, product: { ...favour.product, makerChecked: false } } as never)).toBe("Posted on FAVOUR · striverun.app");
  });
});
