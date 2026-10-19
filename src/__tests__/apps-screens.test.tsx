import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AppsToCheckView, type ListedApp } from "@/components/AppsToCheck";
import { PostAppForm, EMPTY_POST, type PostState } from "@/components/PostApp";

// THE TWO POSTED-APP SCREENS, rendered on the server with no browser. The phone
// test in PR 58 is the real check; these pin what each state draws.

const noop = () => {};
const APP: ListedApp = {
  id: "draft_1", productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app/",
  ask: "Turn one coding session into a run and tell me the first step that was unclear.",
  image: "https://striverun.app/api/og", yes: 3, of: 10, status: "pending",
};
const list = (apps: ListedApp[], extra: Partial<Parameters<typeof AppsToCheckView>[0]> = {}) =>
  renderToStaticMarkup(<AppsToCheckView apps={apps} notes={{}} busy={null} error={null} onYes={noop} {...extra} />);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("/apps: the apps waiting for YES", () => {
  it("draws one card per app with its name, host, ask and count", () => {
    const html = list([APP, { ...APP, id: "draft_2", productName: "Wave Radio", yes: 0 }]);
    expect(count(html, /data-app=/g)).toBe(2);
    expect(html).toContain("STRIVE");
    expect(html).toContain("agentic-strava.vercel.app");
    expect(html).toContain(APP.ask);
    expect(html).toContain("3 of 10 YES");
    expect(html).toContain("0 of 10 YES");
  });

  it("fills exactly as many pips as there are YES votes", () => {
    const html = list([APP]);
    expect(count(html, /data-pip="on"/g)).toBe(3);
    expect(count(html, /data-pip="off"/g)).toBe(7);
  });

  it("each card has one YES button, named for its app, and a link that opens the app", () => {
    const html = list([APP]);
    expect(count(html, /aria-label="Say YES to STRIVE"/g)).toBe(1);
    expect(html).toMatch(/href="https:\/\/agentic-strava\.vercel\.app\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  it("the YES button is disabled while that card's vote is in flight", () => {
    expect(list([APP], { busy: "draft_1" })).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Say YES to STRIVE"/);
    expect(list([APP])).not.toMatch(/disabled=""/);
  });

  it("shows the vote's note under that card only", () => {
    const html = list([APP, { ...APP, id: "draft_2", productName: "Wave Radio" }], { notes: { draft_1: "You cannot vote for your own app." } });
    expect(count(html, /You cannot vote for your own app\./g)).toBe(1);
    expect(html.indexOf("You cannot vote")).toBeLessThan(html.indexOf("Wave Radio"));
  });

  it("a published app shows as live and has no YES button", () => {
    const html = list([{ ...APP, yes: 10, status: "published" }]);
    expect(html).toContain("Live on FAVOUR");
    expect(html).not.toContain("Say YES to");
  });

  it("an empty list says so and points to posting", () => {
    const html = list([]);
    expect(html).toContain("No apps are waiting");
    expect(html).toContain('href="/post"');
  });

  it("a failed read says so and draws no card", () => {
    const html = list([], { error: "The list could not be read. Try again." });
    expect(html).toContain("The list could not be read. Try again.");
    expect(html).not.toContain("No apps are waiting");
  });
});

const form = (s: Partial<PostState>) => renderToStaticMarkup(<PostAppForm state={{ ...EMPTY_POST, ...s }} onChange={noop} onRead={noop} onPost={noop} />);
const ASK = Array(20).fill("word").join(" ");

describe("/post: post your app", () => {
  it("starts with only the link and a button that reads the page", () => {
    const html = form({});
    expect(html).toContain('type="url"');
    expect(html).toContain("Read my page");
    expect(html).not.toContain("Post for 10 YES");
  });

  it("after the read: the name, the picture the page declares, and the ask with a word count", () => {
    const html = form({ step: "details", url: "https://agentic-strava.vercel.app", name: "STRIVE", line: "Strava is for people who ran.", pageImage: "https://striverun.app/api/og", ask: "try it" });
    expect(html).toContain('value="STRIVE"');
    expect(html).toContain('src="https://striverun.app/api/og"');
    expect(html).toContain("2 of 20 words");
    expect(html).toContain("Post for 10 YES");
  });

  it("the post button is disabled and says why until the form is complete", () => {
    const short = form({ step: "details", url: "https://agentic-strava.vercel.app", name: "STRIVE", pageImage: "https://striverun.app/api/og", ask: "try it" });
    expect(short).toMatch(/<button[^>]*disabled=""[^>]*>Post for 10 YES/);
    expect(short).toContain("in at least 20 words");
    const ready = form({ step: "details", url: "https://agentic-strava.vercel.app", name: "STRIVE", pageImage: "https://striverun.app/api/og", ask: ASK });
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Post for 10 YES/);
  });

  it("asks for a picture link only when the page declared none", () => {
    expect(form({ step: "details", url: "https://a.test", name: "A", pageImage: null, ask: ASK })).toContain("Link to a picture");
    expect(form({ step: "details", url: "https://a.test", name: "A", pageImage: "https://a.test/og.png", ask: ASK })).not.toContain("Link to a picture");
  });

  it("shows the server's error verbatim", () => {
    expect(form({ step: "details", error: "You can post one app a day. Come back tomorrow." })).toContain("You can post one app a day. Come back tomorrow.");
  });

  it("after posting: the app is waiting, 0 of 10, with the way to the list", () => {
    const html = form({ step: "done", name: "STRIVE", posted: { id: "draft_1", yes: 0, of: 10 } });
    expect(html).toContain("STRIVE is waiting for 10 YES");
    expect(html).toContain("0 of 10 YES");
    expect(html).toContain('href="/apps"');
    expect(html).not.toContain("Post for 10 YES");
  });
});

describe("the doors", () => {
  const src = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
  it("the home board links to the apps list, and the pages mount the screens", () => {
    expect(src("src/components/Feed.tsx")).toMatch(/<AppsToCheckDoor\s*\/>/);
    expect(src("src/app/apps/page.tsx")).toContain('export { default } from "../page"');
    expect(src("src/app/page.tsx")).toMatch(/list \? <ProjectsHome auth=\{auth\} \/> : <Deck auth=\{auth\} \/>/);
    expect(src("src/app/post/page.tsx")).toContain("<PostApp />");
  });
});
