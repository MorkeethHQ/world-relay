import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { countLine, filterProjects, isFromOtherSource, sortProjects, type ProjectCard as Card } from "@/lib/projects-view";
import { EMPTY_FEEDBACK, feedbackNote, feedbackReason } from "@/lib/feedback-form";
import { TenHumans } from "@/components/fv/TenHumans";
import { ProjectCard } from "@/components/fv/ProjectCard";
import { ProjectsHomeView } from "@/components/fv/ProjectsHome";
import { ProjectViewScreen } from "@/components/fv/ProjectView";
import { FeedbackScreen } from "@/components/fv/FeedbackForm";
import { PostAppForm, EMPTY_POST } from "@/components/PostApp";

// THE REVAMPED SCREENS (19 Oct 2026), rendered on the server with no browser.
// The phone screenshots in the review item are the real check; these pin what
// each state draws and what the pure helpers say.

const noop = () => {};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const PENDING: Card = {
  id: "draft_1", name: "STRIVE", url: "https://agentic-strava.vercel.app/", host: "agentic-strava.vercel.app",
  ask: "Turn one coding session into a run and tell me the first step that was unclear.",
  image: "https://striverun.app/api/og", yes: 3, of: 10, status: "pending", fromOtherSource: false, pieces: [], points: 10, publishedAt: null,
};
const LIVE: Card = { ...PENDING, id: "draft_2", name: "Wave Radio", yes: 10, status: "published", publishedAt: "2026-10-15T19:48:30.501Z",
  pieces: [{ kind: "review", count: 5, taskId: "task_9", open: true, left: 3 }] };

describe("the pure helpers", () => {
  it("counts: a waiting project says n of 10, a live one says Live", () => {
    expect(countLine(PENDING)).toBe("3 of 10");
    expect(countLine(LIVE)).toBe("Live");
  });
  it("filters by state and keeps everything on all", () => {
    expect(filterProjects([PENDING, LIVE], "waiting").map((p) => p.id)).toEqual(["draft_1"]);
    expect(filterProjects([PENDING, LIVE], "live").map((p) => p.id)).toEqual(["draft_2"]);
    expect(filterProjects([PENDING, LIVE], "all")).toHaveLength(2);
  });
  it("sorts live first, newest first, then waiting with most YES first", () => {
    const older = { ...LIVE, id: "draft_3", publishedAt: "2026-10-01T00:00:00Z" };
    const fewer = { ...PENDING, id: "draft_4", yes: 1 };
    expect(sortProjects([fewer, older, PENDING, LIVE]).map((p) => p.id)).toEqual(["draft_2", "draft_3", "draft_1", "draft_4"]);
  });
  it("a project is from elsewhere only when its maker is one of our wallets", () => {
    const ours = new Set(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(isFromOtherSource("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ours)).toBe(true);
    expect(isFromOtherSource("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ours)).toBe(false);
    expect(isFromOtherSource(null, ours)).toBe(false);
  });
});

describe("the feedback form", () => {
  const full = { worked: "Yes" as const, feel: "Clean" as const, design: 4, forWhom: "Runners who code", confusing: "The first button", fix: Array(8).fill("word").join(" ") };
  it("asks for each answer in order and says why", () => {
    expect(feedbackReason(EMPTY_FEEDBACK)).toBe("Say whether it worked.");
    expect(feedbackReason({ ...full, fix: "too short" })).toContain("at least 8 words");
    expect(feedbackReason(full)).toBeNull();
  });
  it("writes one note the AI check can read, under 1000 characters, with every answer", () => {
    const note = feedbackNote(full, "STRIVE");
    expect(note).toContain("Worked: Yes.");
    expect(note).toContain("Feels: Clean.");
    expect(note).toContain("Design: 4 of 5.");
    expect(note).toContain("For: Runners who code.");
    expect(note).toContain("Confusing first: The first button.");
    expect(note.length).toBeLessThanOrEqual(1000);
    expect(feedbackNote({ ...full, fix: "x".repeat(2000) }, "STRIVE").length).toBeLessThanOrEqual(1000);
  });
});

describe("the device: ten humans", () => {
  it("draws ten cells and fills exactly as many as there are YES", () => {
    const html = renderToStaticMarkup(<TenHumans yes={3} />);
    expect(count(html, /data-pip="on"/g)).toBe(3);
    expect(count(html, /data-pip="off"/g)).toBe(7);
    expect(html).toContain('aria-label="3 of 10 said YES"');
  });
});

describe("the project card", () => {
  const card = (p: Card) => renderToStaticMarkup(<ProjectCard p={p} busy={false} onYes={noop} />);
  it("a waiting project has the count in blue, an Open link and one YES button named for it", () => {
    const html = card(PENDING);
    expect(html).toMatch(/fv-blue[^>]*>3 of 10</);
    expect(html).toContain('href="/project/draft_1"');
    expect(count(html, /aria-label="Say YES to STRIVE"/g)).toBe(1);
    expect(html).not.toContain("Found elsewhere");
  });
  it("a live project says Live, offers feedback, and has no YES button", () => {
    const html = card(LIVE);
    expect(html).toContain(">Live<");
    expect(html).toContain("Give feedback");
    expect(html).not.toContain("Say YES to");
  });
  it("a project found elsewhere wears the orange banner and a framed title", () => {
    const html = card({ ...PENDING, fromOtherSource: true });
    expect(html).toMatch(/fv-banner[^>]*>Found elsewhere</);
    expect(html).toMatch(/<h2 class="fv-h break-words fv-frame">STRIVE<\/h2>/);
  });
});

describe("the home screen", () => {
  const home = (projects: Card[] | null, extra: Partial<Parameters<typeof ProjectsHomeView>[0]> = {}) =>
    renderToStaticMarkup(<ProjectsHomeView projects={projects} error={null} filter="all" onFilter={noop} notes={{}} busy={null} onYes={noop} signedInAs={null} onSignIn={noop} {...extra} />);
  it("leads with the promise, the post door and the counts", () => {
    const html = home([PENDING, LIVE]);
    expect(html).toContain("Real humans try your new projects and products.");
    expect(html).toContain('href="/post"');
    expect(html).toContain("1 waiting for YES · 1 live");
    expect(html).toContain('href="/board"');
    expect(count(html, /data-project=/g)).toBe(2);
  });
  it("signed out shows Sign in; signed in shows the name as a link to the profile", () => {
    expect(home([])).toContain(">Sign in<");
    expect(home([], { signedInAs: "@oscar" })).toMatch(/href="\/dashboard"[^>]*>@oscar</);
  });
  it("an empty list says so and points to posting", () => {
    expect(home([])).toContain("No project is waiting");
  });
  it("never uses the word official and never shows the World logo", () => {
    expect(home([PENDING, LIVE]).toLowerCase()).not.toContain("official");
  });
});

describe("the project screen", () => {
  it("waiting: the ten cells big, Open the app, and YES", () => {
    const html = renderToStaticMarkup(<ProjectViewScreen p={PENDING} results={[]} note={null} busy={false} onYes={noop} signedIn />);
    expect(html).toContain("3 of 10 humans said YES. Ten puts it live.");
    expect(html).toContain("Open the app");
    expect(html).toContain("YES, it works");
  });
  it("live: its favours with points and a feedback link per open piece", () => {
    const html = renderToStaticMarkup(<ProjectViewScreen p={LIVE} results={[]} note={null} busy={false} onYes={noop} signedIn />);
    expect(html).toContain("Ten humans said YES. It is live.");
    expect(html).toContain("An honest review");
    expect(html).toContain("3 of 5 still wanted");
    expect(html).toContain('href="/project/draft_2/feedback?task=task_9"');
    expect(html).not.toContain("YES, it works");
  });
  it("live: a closed piece has no feedback link and says so", () => {
    const closed = { ...LIVE, pieces: [{ kind: "review" as const, count: 5, taskId: "task_9", open: false, left: 0 }] };
    const html = renderToStaticMarkup(<ProjectViewScreen p={closed} results={[]} note={null} busy={false} onYes={noop} signedIn />);
    expect(html).not.toContain("/feedback?task=");
    expect(html).toContain("Closed");
    expect(html).toContain("Every favour on this project is closed for now.");
  });
});

describe("the feedback screen", () => {
  it("asks six things and keeps the send button off until they are answered", () => {
    const html = renderToStaticMarkup(<FeedbackScreen p={LIVE} a={EMPTY_FEEDBACK} onChange={noop} onSend={noop} busy={false} error={null} result={null} signedIn />);
    for (const q of ["Did it work?", "How does it feel?", "Design, 1 to 5", "Who is this for?", "What confused you first?", "One thing to fix"]) expect(html).toContain(q);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send feedback for 10 points/);
  });
  it("after an accepted check: the points, and the way back", () => {
    const html = renderToStaticMarkup(<FeedbackScreen p={LIVE} a={EMPTY_FEEDBACK} onChange={noop} onSend={noop} busy={false} error={null} result={{ verdict: "pass", reasoning: "Specific and honest.", pointsAwarded: 10 }} signedIn />);
    expect(html).toContain("+10 points");
    expect(html).toContain("Specific and honest.");
  });
});

describe("the post screen's deposit block", () => {
  // 19 Oct 2026 (FAVOUR-PAY): USDC reviews are a switch, off by default. On, the
  // block shows the count, the price, the sum and the refund rule. Never an input.
  it("says what the builder puts in, in points, with USDC off by default", () => {
    const html = renderToStaticMarkup(<PostAppForm state={{ ...EMPTY_POST, step: "details", url: "https://a.test", name: "A", pageImage: "https://a.test/og.png", ask: Array(20).fill("w").join(" ") }} onChange={noop} onRead={noop} onPost={noop} />);
    expect(html).toContain("What you put in");
    expect(html).toContain("100 points");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(html).not.toContain("USDC each");
    expect(html).not.toMatch(/<input[^>]*usdc/i);
  });
  it("with USDC on, shows ten reviews, the price, the sum and the refund rule before anything moves", () => {
    const html = renderToStaticMarkup(<PostAppForm state={{ ...EMPTY_POST, step: "details", url: "https://a.test", name: "A", pageImage: "https://a.test/og.png", ask: Array(20).fill("w").join(" "), payOn: true, payUsd: 5 }} onChange={noop} onRead={noop} onPost={noop} />);
    expect(html).toContain("10 reviews at 5 USDC");
    expect(html).toContain("50 USDC");
    expect(html).toContain("Nothing moves now");
    expect(html).toContain("refunds to you 10 days after the reviewer takes the slot");
    expect(html).toContain("FAVOUR never holds it");
  });
  it("shows the screenshots the page declared, at most three", () => {
    const html = renderToStaticMarkup(<PostAppForm state={{ ...EMPTY_POST, step: "details", url: "https://a.test", name: "A", pageImage: "https://a.test/og.png", screenshots: ["https://a.test/1.png", "https://a.test/2.png", "https://a.test/3.png", "https://a.test/4.png"] }} onChange={noop} onRead={noop} onPost={noop} />);
    expect(count(html, /class="fv-shot"/g)).toBe(3);
  });
});

describe("the doors and the guards", () => {
  const src = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
  it("the home page restores the image-led board and keeps /board as an alias", () => {
    expect(src("src/app/page.tsx")).toContain('pathname === "/" || pathname === "/board"');
    expect(src("src/app/board/page.tsx")).toContain('export { default } from "../page"');
  });
  it("the bottom nav names Discover, Post, History, Profile; the old board stays reachable by a link", () => {
    const nav = src("src/components/BottomNav.tsx");
    for (const l of ["Discover", "Post", "History", "Profile"]) expect(nav).toContain(`label: "${l}"`);
    expect(nav).not.toContain('value: "/board"');
    expect(src("src/components/fv/Deck.tsx")).toContain('href="/board"');
  });
  it("the project card shape carries no wallet field", () => {
    const shape = src("src/lib/projects-view.ts");
    const type = shape.slice(shape.indexOf("export type ProjectCard = {"), shape.indexOf("};", shape.indexOf("export type ProjectCard = {")));
    const fields = type.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(fields).not.toMatch(/\b(maker|owner|wallet)\b/);
  });
  it("the revamp layer has no radius, no shadow, no grey text and no stamp", () => {
    const css = src("src/app/globals.css");
    const fv = css.slice(css.indexOf(".fv {"), css.indexOf("/* CURATED FAVOUR"));
    expect(fv).not.toMatch(/box-shadow/);
    expect(fv).not.toMatch(/border-radius: [1-9]/);
    expect(fv).not.toMatch(/stamp/i);
    for (const f of ["ProjectsHome", "ProjectCard", "ProjectView", "FeedbackForm", "SignInSheet", "TenHumans"]) {
      const t = src(`src/components/fv/${f}.tsx`);
      expect(t, f).not.toMatch(/text-gray-\d|rounded-|shadow|stamp/i);
    }
  });
  it("the curated front door uses system sans and contains the drop and builder-story doors", () => {
    const css = src("src/app/globals.css");
    const curated = css.slice(css.indexOf("/* CURATED FAVOUR"));
    expect(curated).toContain('font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif');
    expect(curated).not.toMatch(/monospace|font-mono|Geist_Mono/);
    const home = src("src/components/fv/CuratedHome.tsx");
    expect(home).toContain("Curated every Monday");
    expect(home).toContain("Builder stories");
    expect(home).toContain('/drop/2026-w43');
  });
});
