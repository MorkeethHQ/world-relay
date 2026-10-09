// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Screens drawn in a browser page (jsdom), with their effects run and their
// buttons tapped. Added 9 Oct 2026 on Oscar's "3 yes fix it,": three hand-made
// faults in screens passed every test, because no test ran a screen.
//
// The server is replaced by one table of answers below. The components, their
// reads and their links are real. Each case was seen to fail with its fault in.

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

import { BottomNav } from "@/components/BottomNav";
import { TalkRooms } from "@/components/TalkRooms";
import { TalkRoom } from "@/components/TalkRoom";
import { ProductScreen } from "@/components/ProductScreen";

const NOW = new Date().toISOString();
const SEEDED = "The code field hides under the keyboard on a Pixel 8.";

const answers: Record<string, unknown> = {
  "/api/talk": {
    rooms: [
      { id: "strive", name: "STRIVE", kind: "vote", picture: { url: null, icon: null }, colour: null, count: 1, people: 1, faces: [], last: { name: "jonas", text: SEEDED, at: NOW }, asks: 0 },
      { id: "wave-radio", name: "Wave Radio", kind: "vote", picture: { url: null, icon: null }, colour: null, count: 0, people: 0, faces: [], last: null, asks: 0 },
    ],
  },
  "/api/talk/strive": {
    room: { id: "strive", name: "STRIVE", kind: "vote", picture: { url: null, icon: null }, colour: null },
    messages: [{ id: "m1", author: { kind: "person", name: "jonas", picture: null }, text: SEEDED, ask: false, at: NOW, taken: null }],
    pinned: null,
    count: 1,
    signedIn: false,
    you: null,
  },
  "/api/product/c1": {
    product: {
      id: "c1", name: "STRIVE", line: "Post agent runs as cards", ask: "Tell us where the sign-up breaks.", points: 10,
      productUrl: "https://example.com", host: "example.com", reviewTaskId: "t-review",
      picture: { url: null, icon: null, colour: null }, accepted: 0, acceptedIsFloor: false, makerChecked: false, company: "STRIVE",
    },
  },
};

beforeEach(() => {
  nav.path = "/";
  nav.pushed = [];
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const body = answers[path];
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("from the nav to a message in a room", () => {
  it("the Talk tab opens /talk", () => {
    render(<BottomNav />);
    fireEvent.click(screen.getByText("Talk"));
    expect(nav.pushed).toEqual(["/talk"]);
  });

  // Fault U6: the row opened /p/<id>.
  it("a room row opens /talk/<id>", async () => {
    render(<TalkRooms />);
    fireEvent.click(await screen.findByLabelText("STRIVE room"));
    expect(nav.pushed).toEqual(["/talk/strive"]);
  });

  it("the second room row opens its own room", async () => {
    render(<TalkRooms />);
    fireEvent.click(await screen.findByLabelText("Wave Radio room"));
    expect(nav.pushed).toEqual(["/talk/wave-radio"]);
  });

  // Fault U1: the room read the wrong key and always drew the error.
  it("the room shows the message that was written in it", async () => {
    render(<TalkRoom id="strive" />);
    expect(await screen.findByText(SEEDED)).toBeTruthy();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });

  it("the room says so when its answer is not a room", async () => {
    answers["/api/talk/broken"] = { room: { id: "broken" } };
    render(<TalkRoom id="broken" />);
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
    delete answers["/api/talk/broken"];
  });
});

describe("a product that takes a review", () => {
  // Fault U4: the branch inverted, so every such product said it takes none.
  it("offers Write your review", async () => {
    render(<ProductScreen id="c1" />);
    expect(await screen.findByText("Write your review")).toBeTruthy();
    expect(screen.queryByText(/takes no review now/i)).toBeNull();
  });

  it("says it takes no review when it has no review favour", async () => {
    const base = (answers["/api/product/c1"] as { product: Record<string, unknown> }).product;
    answers["/api/product/c2"] = { product: { ...base, id: "c2", reviewTaskId: null } };
    render(<ProductScreen id="c2" />);
    expect(await screen.findByText(/takes no review now/i)).toBeTruthy();
    expect(screen.queryByText("Write your review")).toBeNull();
    delete answers["/api/product/c2"];
  });
});
