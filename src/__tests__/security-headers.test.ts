import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

// Page lock (hardening pass, 2026-10-13). Measured on production 2026-10-12:
// GET / returned no X-Frame-Options, no Content-Security-Policy, no
// X-Content-Type-Options and no Referrer-Policy.
//
// FAVOUR runs inside World App. docs.world.org/mini-apps/more/webview-spec
// (fetched 2026-10-12) says the app "is opened within the World App via a
// WebView": Android's native WebView, WKWebView on iOS. A native webview is a
// top-level browsing context, not a frame, so refusing every frame ancestor
// does not affect it. No World page says any tool frames a mini app, and the
// app does not frame itself (grep "<iframe" src: 0 hits).

async function headersFor(path: string): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!();
  const out: Record<string, string> = {};
  for (const r of rules) {
    const matches = r.source === "/:path*" || r.source === path;
    if (!matches) continue;
    for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

describe("every route refuses to be framed and is typed strictly", () => {
  it("sets the frame, sniff and referrer headers on /:path*", async () => {
    const h = await headersFor("/");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("keeps the no-store rule the app shell already had", async () => {
    const h = await headersFor("/");
    expect(h["cache-control"]).toMatch(/no-store/);
  });

  it("the enforced policy carries frame-ancestors only, so it cannot break a script", async () => {
    const h = await headersFor("/");
    const directives = h["content-security-policy"].split(";").map((d) => d.trim()).filter(Boolean);
    expect(directives).toEqual(["frame-ancestors 'none'"]);
  });
});

describe("a full policy is reported, not enforced, until it is read in World App", () => {
  it("sends Content-Security-Policy-Report-Only with the hosts the client talks to", async () => {
    const h = await headersFor("/");
    const ro = h["content-security-policy-report-only"];
    expect(ro).toBeTruthy();
    expect(ro).toMatch(/default-src 'self'/);
    // Usernames are resolved client side (src/hooks/useWorldUser.ts).
    expect(ro).toMatch(/connect-src[^;]*https:\/\/usernames\.worldcoin\.org/);
    // Map tiles (src/components/TaskMap.tsx).
    expect(ro).toMatch(/img-src[^;]*https:\/\/\*\.basemaps\.cartocdn\.com/);
    // Proof photos are data: URLs or blob storage.
    expect(ro).toMatch(/img-src[^;]*data:/);
    expect(ro).toMatch(/frame-ancestors 'none'/);
    expect(ro).toMatch(/object-src 'none'/);
  });
});
