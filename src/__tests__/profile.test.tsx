// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// THE PROFILE in a browser page (jsdom), with its reads answered by one table
// and its rows tapped (Oscar, 10 Oct 2026: "profile not done"). The local app
// has no database, so the real page shows the signed-out state; the filled
// state is proven here.

const nav = vi.hoisted(() => ({ path: "/dashboard", pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({
    push: (to: string) => { nav.pushed.push(to); nav.path = to; },
    replace: () => {},
    prefetch: () => {},
    back: () => {},
  }),
}));

import { Profile, faceCells, levelLine, postedLine } from "@/components/Profile";

const ME = "0x1111111111111111111111111111111111111111";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const APP = "Wave Radio";

const draft = (over: Record<string, unknown>) => ({
  id: "draft_1", owner: ME, status: "published", company: "Wave", brief: "Play one show and say what you would change.", pieces: [{ kind: "review", count: 5 }],
  rewardPerPiecePoints: 10, proposedPoolUsdc: 0, reviewRule: "", reviewWithinHours: 48, productName: APP, productUrl: "https://waveradio.example/app",
  publishedAt: ago(30), createdAt: ago(31), pieceTaskIds: { review: "t-review" }, ...over,
});

let answers: Record<string, { status?: number; body: unknown }>;

beforeEach(() => {
  nav.path = "/dashboard";
  nav.pushed = [];
  localStorage.clear();
  answers = {
    "/api/me/contributions": { body: { authenticated: true, contributions: [
      { taskId: "c1", description: "Reviewed STRIVE", points: 10, streakBonus: 0, proofImageUrl: null, proofNote: null, campaignId: "draft_9", campaignLabel: "STRIVE", at: ago(5) },
      { taskId: "c2", description: "A favour", points: 3, streakBonus: 0, proofImageUrl: null, proofNote: null, campaignId: null, at: ago(50) },
    ] } },
    "/api/campaigns/drafts": { body: { authenticated: true, drafts: [draft({}), draft({ id: "draft_2", status: "draft", productName: "Unpublished" })] } },
    "/api/hunt": { body: { signedIn: true, stamps: ["vote:strive"], streak: 1 } },
    "/api/tasks": { body: { tasks: [] } },
    "/api/me/company-responses": { body: { authenticated: true, campaigns: [{ id: "draft_1", company: "Wave", role: "company", pieces: 2, waiting: 1 }] } },
    "/api/referral/stats": { body: { invited: 2, activated: 1, cap: 10, capReached: false } },
    "/api/v1/query": { body: [{ address: ME, username: "jonas", profile_picture_url: null }] },
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const a = answers[path];
    if (!a) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the profile, filled", () => {
  it("shows the username, the counts and a seeded app row, never the address", async () => {
    localStorage.setItem("relay_user_id", ME);
    localStorage.setItem("relay_verification_level", "orb");
    render(<Profile />);
    expect(await screen.findByText(APP)).toBeTruthy();
    expect(await screen.findByText("@jonas")).toBeTruthy();
    expect(screen.getByText("Orb verified")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0x1111");
    expect(document.body.textContent).not.toContain("0x1111...1111");
    // the banner: the server's own counts, a zero drawn as a zero
    expect(screen.getByText("pts").previousSibling!.textContent).toBe("13");
    expect(screen.getByText("reviews accepted").previousSibling!.textContent).toBe("1");
    expect(screen.getByText("products reviewed").previousSibling!.textContent).toBe("1");
    expect(screen.getByText("apps launched").previousSibling!.textContent).toBe("1");
    // an unpublished draft is not an app row
    expect(screen.queryByText("Unpublished")).toBeNull();
  });

  it("an app row opens /p/<id>", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    fireEvent.click(await screen.findByLabelText(`${APP}: your app`));
    expect(nav.pushed).toEqual(["/p/draft_1"]);
  });

  it("draws the bars from real fractions: today's hunt and the invite", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    expect(await screen.findByLabelText("1 of 3 checked today")).toBeTruthy();
    expect(await screen.findByLabelText("1 of 10 rewarded")).toBeTruthy();
    expect(screen.getByText(/2 invited · 1 active/)).toBeTruthy();
  });

  it("lists a company response as a row to its contributions page", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    fireEvent.click(await screen.findByLabelText("Wave: company responses"));
    expect(nav.pushed).toEqual(["/companies/draft_1/contributions"]);
  });

  it("shows no level name, no rank and no streak", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    await screen.findByText(APP);
    expect(document.body.textContent).not.toMatch(/\bLevel\b|\bRank\b|in a row|streak/i);
  });
});

describe("the profile, the evening pass of 10 Oct 2026", () => {
  it("an app row draws the app's own icon when the feed gives one", async () => {
    localStorage.setItem("relay_user_id", ME);
    answers["/api/feed"] = { body: { cards: [{ id: "draft_1", picture: { url: null, icon: "https://waveradio.example/icon.png" } }] } };
    render(<Profile />);
    const row = await screen.findByLabelText(`${APP}: your app`);
    await waitFor(() => expect(row.querySelector("img")?.getAttribute("src")).toBe("https://waveradio.example/icon.png"));
  });

  it("with no accepted review it gives one line and the way to Today; with one it does not", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    await screen.findByText(APP);
    expect(screen.queryByLabelText("Review a project")).toBeNull();
    cleanup();
    answers["/api/me/contributions"] = { body: { authenticated: true, contributions: [] } };
    render(<Profile />);
    fireEvent.click(await screen.findByLabelText("Review a project"));
    expect(nav.pushed).toEqual(["/"]);
  });

  it("a person's mark is steady, mirrored, and differs between wallets", () => {
    const a = faceCells(ME);
    expect(a).toHaveLength(25);
    expect(faceCells(ME)).toEqual(a);
    for (let y = 0; y < 5; y++) { expect(a[y * 5]).toBe(a[y * 5 + 4]); expect(a[y * 5 + 1]).toBe(a[y * 5 + 3]); }
    expect(faceCells("0x2222222222222222222222222222222222222222")).not.toEqual(a);
  });
});

describe("the profile, empty, signed out and broken", () => {
  it("with no app posted it says so and the one dark button opens /post", async () => {
    localStorage.setItem("relay_user_id", ME);
    answers["/api/campaigns/drafts"] = { body: { authenticated: true, drafts: [] } };
    render(<Profile />);
    expect(await screen.findByText("You have posted no app yet")).toBeTruthy();
    expect(screen.getByText("apps launched").previousSibling!.textContent).toBe("0");
    fireEvent.click(screen.getByText("Post your project"));
    expect(nav.pushed).toEqual(["/post"]);
  });

  it("signed out: no number, one line, and the way to Today", async () => {
    answers["/api/me/contributions"] = { body: { authenticated: false, contributions: [] } };
    render(<Profile />);
    expect(await screen.findByText("Not signed in")).toBeTruthy();
    expect(await screen.findByText(/sign in to see your reviews/)).toBeTruthy();
    expect(screen.queryByText("pts")).toBeNull();
    expect(screen.queryByText("Your apps")).toBeNull();
    fireEvent.click(screen.getByText("Today's hunt"));
    expect(nav.pushed).toEqual(["/"]);
  });

  it("the error state offers Try again, and the retry reads the profile", async () => {
    localStorage.setItem("relay_user_id", ME);
    answers["/api/me/contributions"] = { status: 500, body: { error: "down" } };
    render(<Profile />);
    expect(await screen.findByText("Your profile could not be read.")).toBeTruthy();
    answers["/api/me/contributions"] = { body: { authenticated: true, contributions: [] } };
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText(APP)).toBeTruthy();
    expect(screen.queryByText("Your profile could not be read.")).toBeNull();
  });

  it("the loading state is the fill-up, present before the data arrives", async () => {
    localStorage.setItem("relay_user_id", ME);
    render(<Profile />);
    expect(screen.getByLabelText("Reading your profile")).toBeTruthy();
    expect(screen.getByText("Reading your profile…")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Reading your profile")).toBeNull());
  });
});

describe("the small rules", () => {
  it("writes the level as words and never a colour", () => {
    expect(levelLine("orb")).toBe("Orb verified");
    expect(levelLine("device")).toBe("Device verified");
    expect(levelLine("wallet")).toBe("Wallet sign-in");
    expect(levelLine(null)).toBe("Signed in");
  });

  it("writes the host and when the app was posted", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(postedLine("waveradio.example", "2026-10-10T01:00:00Z", now)).toBe("Posted today · waveradio.example");
    expect(postedLine("waveradio.example", "2026-10-07T01:00:00Z", now)).toBe("Posted 3 days ago · waveradio.example");
    expect(postedLine("waveradio.example", null, now)).toBe("waveradio.example");
  });
});
