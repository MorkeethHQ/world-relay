// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// THE THREE DOORS on top of Today, in a browser page (jsdom), tapped (Oscar,
// 10 Oct 2026: "on top a 'post your project' and 'support builders' or do
// favours' 3 actions!"). Two doors push a route; the third scrolls to the
// project cards on the same screen and pushes nothing.

const nav = vi.hoisted(() => ({ path: "/", pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useRouter: () => ({
    push: (to: string) => { nav.pushed.push(to); nav.path = to; },
    replace: () => {},
    prefetch: () => {},
    back: () => {},
  }),
}));

import { DOORS, ThreeDoors, scrollToId } from "@/components/ThreeDoors";

let scrolled: ScrollIntoViewOptions[];

beforeEach(() => {
  nav.path = "/";
  nav.pushed = [];
  scrolled = [];
  Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) { scrolled.push(typeof arg === "object" && arg ? arg : {}); };
});
afterEach(() => {
  cleanup();
});

describe("the three doors", () => {
  it("shows the three labels in order, each as one tap target", () => {
    render(<ThreeDoors />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(DOORS.map((d) => d.label));
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Post your project", "Support builders", "Do favours"]);
    for (const b of buttons) expect(b.className).toMatch(/min-h-\[44px\]/);
  });

  it("Post your project opens /post", () => {
    render(<ThreeDoors />);
    fireEvent.click(screen.getByLabelText("Post your project"));
    expect(nav.pushed).toEqual(["/post"]);
  });

  it("Do favours opens /favours", () => {
    render(<ThreeDoors />);
    fireEvent.click(screen.getByLabelText("Do favours"));
    expect(nav.pushed).toEqual(["/favours"]);
  });

  it("Support builders scrolls to the project cards and opens no page", () => {
    render(
      <>
        <ThreeDoors projectsId="projects" />
        <div id="projects" />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Support builders"));
    expect(nav.pushed).toEqual([]);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].behavior).toBe("smooth");
  });

  it("the scroll is instant under reduced motion, and a missing target scrolls nothing", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<div id="projects" />);
    expect(scrollToId("projects")).toBe(true);
    expect(scrolled[0].behavior).toBe("auto");
    expect(scrollToId("nowhere")).toBe(false);
    expect(scrolled).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
