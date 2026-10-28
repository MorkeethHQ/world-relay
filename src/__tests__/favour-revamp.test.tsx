import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { countLine, filterProjects, isFromOtherSource, sortProjects, type ProjectCard as Card } from "@/lib/projects-view";
import { EMPTY_FEEDBACK, feedbackNote, feedbackReason } from "@/lib/feedback-form";
import { TenHumans } from "@/components/fv/TenHumans";
import { ProjectCard } from "@/components/fv/ProjectCard";

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
