import { describe, it, expect, vi } from "vitest";

// THE BEACON MUST RECORD BEFORE IT ANSWERS (2026-09-22). /api/track used to fire
// trackEvent and answer at once. On Vercel the function may be frozen once it has
// answered, so an unawaited write is not guaranteed to finish. (No loss was
// observed: an apparent one was the retention report's 10-minute cache.) This test
// holds each write open and checks the route has not answered while it is pending.

let release: (() => void) | null = null;
const writes: string[] = [];
vi.mock("@/lib/track", () => ({
  trackEvent: (event: string) => new Promise<void>((res) => { release = () => { writes.push(event); res(); }; }),
  trackReach: (cid: string) => new Promise<void>((res) => { release = () => { writes.push(`reach:${cid}`); res(); }; }),
}));

import { POST } from "@/app/api/track/route";

const post = (body: any) =>
  new Request("http://localhost/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as any;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("/api/track answers only after the write", () => {
  it("a funnel event", async () => {
    let answered = false;
    const p = POST(post({ event: "mission_tapped" })).then((r: Response) => { answered = true; return r; });
    await tick();
    expect(answered).toBe(false);
    release!();
    const res = await p;
    expect(res.status).toBe(200);
    expect(writes).toContain("mission_tapped");
  });
  it("a page view and its reach", async () => {
    let answered = false;
    const p = POST(post({ page: "/", cid: "c1" })).then(() => { answered = true; });
    await tick();
    expect(answered).toBe(false);
    release!(); await tick();
    expect(answered).toBe(false);
    release!();
    await p;
    expect(writes).toEqual(expect.arrayContaining(["reach:c1", "page_view"]));
  });
});
