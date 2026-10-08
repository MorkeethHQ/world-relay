import { describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES, MAX_REDIRECTS, MAX_SCREENSHOTS,
  fetchProduct, fetchableUrl, isPrivateAddress, parseProductPage, type FetchDeps,
} from "@/lib/product-fetch";

const PAGE = `<!doctype html><html><head>
<title>Acme &amp; Co | Home</title>
<meta property="og:site_name" content="Acme">
<meta property="og:description" content="Track your   runs &amp; share them.">
<meta property="og:image" content="/share.png">
<meta name="theme-color" content="#5E6AD2">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="https://cdn.acme.test/touch.png">
<script type="application/ld+json">{"@type":"SoftwareApplication","screenshot":["https://cdn.acme.test/1.png",{"url":"/2.png"},"http://cdn.acme.test/plain.png","javascript:alert(1)","https://cdn.acme.test/3.png","https://cdn.acme.test/4.png"]}</script>
</head><body></body></html>`;

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}
function deps(over: Partial<FetchDeps> & { pages?: Record<string, Response> } = {}): FetchDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    resolve: over.resolve ?? (async () => ["93.184.216.34"]),
    request: over.request ?? (async (url) => { asked.push(url); return over.pages?.[url] ?? html(PAGE); }),
  };
}

describe("reading a product page", () => {
  const p = parseProductPage(PAGE, "https://acme.test/app");

  it("takes the name, the line and the pictures the page declares", () => {
    expect(p.name).toBe("Acme");
    expect(p.line).toBe("Track your runs & share them.");
    expect(p.image).toBe("https://acme.test/share.png");
    expect(p.icon).toBe("https://cdn.acme.test/touch.png"); // the touch icon beats the favicon
    expect(p.colour).toBe("#5e6ad2");
    expect(parseProductPage(`<meta name="theme-color" content="red; background:url(x)">`, "https://acme.test/").colour).toBeNull();
  });

  it("keeps only https screenshots, and at most the limit", () => {
    expect(p.screenshots).toEqual(["https://cdn.acme.test/1.png", "https://acme.test/2.png", "https://cdn.acme.test/3.png"]);
    expect(p.screenshots.length).toBe(MAX_SCREENSHOTS);
  });

  it("invents nothing when the page declares nothing", () => {
    expect(parseProductPage("<html><body>hello</body></html>", "https://acme.test/")).toEqual({
      url: "https://acme.test/", name: null, line: null, image: null, icon: null, screenshots: [], colour: null,
    });
  });

  it("returns plain text: tags and script never survive in a name or a line", () => {
    const bad = parseProductPage(
      `<title><script>alert(1)</script>Evil</title><meta name="description" content="&lt;img src=x onerror=alert(1)&gt; hi">`,
      "https://acme.test/",
    );
    expect(bad.name).not.toMatch(/<script/i);
    expect(bad.line).toBe("<img src=x onerror=alert(1)> hi"); // text for React to escape, never markup we render
    expect(parseProductPage(`<meta property="og:image" content="javascript:alert(1)">`, "https://acme.test/").image).toBeNull();
    expect(parseProductPage(`<meta property="og:image" content="data:image/png;base64,AAAA">`, "https://acme.test/").image).toBeNull();
  });

  it("cuts a long name and survives broken structured data", () => {
    const long = parseProductPage(`<title>${"a".repeat(500)}</title><script type="application/ld+json">{not json</script>`, "https://acme.test/");
    expect(long.name!.length).toBeLessThanOrEqual(60);
    expect(long.screenshots).toEqual([]);
  });
});

describe("which addresses and links are refused", () => {
  it("refuses every private, loopback, link-local and metadata address", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "not-an-address"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    // The same private addresses in other written forms, and ranges that wrap or reach inside.
    for (const a of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "0:0:0:0:0:0:0:1", "0::1", "::127.0.0.1", "::7f00:1",
      "::ffff:0:127.0.0.1", "2002:7f00:1::", "fec0::1", "100::1", "168.63.129.16", "2001:db8::1", "2001:0:1::1", "fe80::1%eth0",
      "[::1]", "1::2::3", ":::", "12345::1", "::g", "1.2.3", "198.51.100.7", "203.0.113.7"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "2606:4700:4700:0:0:0:0:1111", "2a00:1450:4001:81b::200e", "::ffff:808:808"]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it("accepts only a public-looking https link on the default port", () => {
    expect(fetchableUrl("acme.test/app")?.toString()).toBe("https://acme.test/app");
    for (const bad of ["http://acme.test", "https://acme.test:8443/", "https://localhost/", "https://10.0.0.1/",
      "https://2130706433/", "https://user:pw@acme.test/", "https://printer.local/", "https://db.internal/", "https://foo.localhost/", "https://acme.test./", "ftp://acme.test", "", 7]) {
      expect(fetchableUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("the fenced fetch", () => {
  it("returns a proposal for a normal page", async () => {
    const d = deps();
    const r = await fetchProduct("https://acme.test/app", d);
    expect(r.ok && r.proposal.name).toBe("Acme");
    expect(d.asked).toEqual(["https://acme.test/app"]);
  });

  it("ties the request to the address that passed the check, on every hop", async () => {
    const pinned: string[] = [];
    let lookups = 0;
    const d = deps({
      // A rebinding host: public on the check, private on any later lookup.
      resolve: async (host) => (host === "acme.test" ? [lookups++ === 0 ? "93.184.216.34" : "10.0.0.9"] : ["8.8.8.8"]),
      request: async (url, _signal, address) => {
        pinned.push(address);
        return url === "https://acme.test/" ? new Response(null, { status: 302, headers: { location: "https://next.test/" } }) : html(PAGE);
      },
    });
    const r = await fetchProduct("https://acme.test/", d);
    expect(r.ok).toBe(true);
    expect(pinned).toEqual(["93.184.216.34", "8.8.8.8"]); // the request never gets to look the host up again
    expect(lookups).toBe(1);
  });

  it("pins to an IPv4 address when the host has both kinds", async () => {
    const pinned: string[] = [];
    await fetchProduct("https://acme.test/", deps({
      resolve: async () => ["2606:4700::1111", "93.184.216.34"],
      request: async (_u, _s, address) => { pinned.push(address); return html(PAGE); },
    }));
    expect(pinned).toEqual(["93.184.216.34"]);
  });

  it("makes no request when the host resolves to a private address", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.5"]) {
      const d = deps({ resolve: async () => ["93.184.216.34", address] }); // one bad address among good ones is enough
      const r = await fetchProduct("https://acme.test/", d);
      expect(r.ok).toBe(false);
      expect(d.asked).toEqual([]);
    }
  });

  it("checks the address again on every redirect, and stops at a private one", async () => {
    const d = deps({
      resolve: async (host) => (host === "inside.test" ? ["10.0.0.9"] : ["93.184.216.34"]),
      pages: { "https://acme.test/": new Response(null, { status: 302, headers: { location: "https://inside.test/secret" } }) },
    });
    const r = await fetchProduct("https://acme.test/", d);
    expect(r.ok).toBe(false);
    expect(d.asked).toEqual(["https://acme.test/"]); // the private hop was never requested
  });

  it("does not follow a redirect to http, to a port or to an address", async () => {
    for (const location of ["http://acme.test/", "https://acme.test:8080/", "https://127.0.0.1/", "file:///etc/passwd"]) {
      const d = deps({ pages: { "https://acme.test/": new Response(null, { status: 301, headers: { location } }) } });
      const r = await fetchProduct("https://acme.test/", d);
      expect(r.ok, location).toBe(false);
      expect(d.asked.length).toBe(1);
    }
  });

  it("gives up after the redirect limit", async () => {
    let n = 0;
    const d = deps({ request: async () => new Response(null, { status: 302, headers: { location: `https://acme.test/${++n}` } }) });
    const r = await fetchProduct("https://acme.test/", d);
    expect(r.ok).toBe(false);
    expect(n).toBe(MAX_REDIRECTS + 1);
  });

  it("reads only the top of a large page, and still finds what the page declares", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const first = new TextEncoder().encode(PAGE);
    const endless = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(pulled++ === 0 ? first : chunk); if (pulled > 1000) c.close(); },
    });
    const r = await fetchProduct("https://acme.test/", deps({
      request: async () => new Response(endless, { headers: { "content-type": "text/html" } }),
    }));
    expect(r.ok && r.proposal.name).toBe("Acme");
    expect(pulled * chunk.byteLength).toBeLessThan(MAX_BYTES * 2); // it stopped reading, it did not drain the page
  });

  it("refuses a link that is not HTML, or an error", async () => {
    const pdf = await fetchProduct("https://acme.test/", deps({ request: async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }) }));
    const gone = await fetchProduct("https://acme.test/", deps({ request: async () => html("no", { status: 404 }) }));
    expect([pdf.ok, gone.ok]).toEqual([false, false]);
  });

  it("puts the lookup under the time limit too", async () => {
    vi.useFakeTimers();
    const slow = fetchProduct("https://acme.test/", deps({ resolve: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await slow).toEqual({ ok: false, reason: "The site took too long to answer." });
    vi.useRealTimers();
  });

  it("never throws: a dead host and a failing request both come back as a reason", async () => {
    const dead = await fetchProduct("https://acme.test/", deps({ resolve: async () => { throw new Error("ENOTFOUND"); } }));
    const down = await fetchProduct("https://acme.test/", deps({ request: async () => { throw new Error("reset"); } }));
    const junk = await fetchProduct("javascript:alert(1)", deps());
    expect(dead).toEqual({ ok: false, reason: "The site could not be found." });
    expect(down.ok).toBe(false);
    expect(junk.ok).toBe(false);
  });
});

// A hostile page must not hold the server's one thread. Each case is a page built
// to make a careless pattern slow (measured before the fix: 48,000 bytes of "<" in
// one meta tag took 3.4 seconds, and the cost grew four times per doubling).
describe("a hostile page is read in bounded time", () => {
  const size = MAX_BYTES;
  const cases: Record<string, string> = {
    "one meta full of <": `<meta name="description" content="${"<".repeat(size)}">`,
    "one tag with no end": `<meta ${"a".repeat(size)}`,
    "many meta starts": "<meta ".repeat(Math.floor(size / 6)),
    "many meta starts, one end": "<meta ".repeat(Math.floor(size / 6)) + ">",
    "many script starts": "<script type ".repeat(Math.floor(size / 13)),
    "many open scripts": `<script type="application/ld+json">`.repeat(Math.floor(size / 35)),
    "a title that never ends": `<title>${"<".repeat(size)}`,
    "many attributes": `<meta ${"a=b ".repeat(Math.floor(size / 4))}>`,
    "a huge list of screenshots": `<script type="application/ld+json">{"screenshot":[${Array(60000).fill('"https://a.test/1.png"').join(",")}]}</script>`,
    "a deep structure": `<script type="application/ld+json">${"[".repeat(5000)}${"]".repeat(5000)}</script>`,
  };
  for (const [name, page] of Object.entries(cases)) {
    it(name, () => {
      const t = performance.now();
      const p = parseProductPage(page.slice(0, size), "https://acme.test/");
      expect(performance.now() - t, name).toBeLessThan(400);
      expect(p.screenshots.length).toBeLessThanOrEqual(MAX_SCREENSHOTS);
    });
  }

  it("still reads a normal page the same way after the bounds", () => {
    const p = parseProductPage(PAGE, "https://acme.test/app");
    expect(p).toMatchObject({ name: "Acme", line: "Track your runs & share them.", image: "https://acme.test/share.png", icon: "https://cdn.acme.test/touch.png", colour: "#5e6ad2" });
    expect(p.screenshots).toHaveLength(MAX_SCREENSHOTS);
  });

  it("decodes an entity once: an escaped tag stays text and does not become a tag", () => {
    expect(parseProductPage(`<meta name="description" content="&amp;lt;b&amp;gt; twice">`, "https://acme.test/").line).toBe("&lt;b&gt; twice");
  });
});
