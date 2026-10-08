// AUTOMATIC FETCHING (Oscar, 8 Oct 2026: "automcatic fetching etc, and agent
// friendliness ... Nice pictures, UX, UI from apps etc.").
//
// Give a product link, get what a campaign needs to look like its product: the
// name, one line, the share picture, the icon, the theme colour and any screenshots
// the page itself declares. The result is a PROPOSAL. Nothing here saves anything, and a campaign
// is never filled in for a company without the company seeing and confirming it
// (campaign-draft-shape.ts: "Never filled in for a company").
//
// Not wired to any route or component yet. This file has no caller.
//
// The page is somebody else's server, reached from ours, so the fetch is fenced:
//   - https only, the same host shape productUrlOrNull accepts, default port only
//   - the host must resolve to public addresses only (no loopback, private,
//     link-local, metadata or unique-local range), checked again on every redirect
//   - at most MAX_REDIRECTS hops, a time limit, HTML only, and only the first
//     MAX_BYTES of the page are ever read
//   - picture links are returned, never fetched here, and only when they are https
// PINNED ADDRESS (8 Oct 2026): the address that passed the check is the address
// the request connects to. The connection is given that address directly and does
// no second lookup, so a host that answers the check with a public address and a
// later lookup with a private one (DNS rebinding) reaches nothing private. TLS
// still checks the certificate against the host name.

import { productUrlOrNull } from "@/lib/campaign-draft-shape";

export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 512 * 1024;
export const TIMEOUT_MS = 5000;
export const MAX_SCREENSHOTS = 3;
const NAME_MAX = 60;
const LINE_MAX = 160;

export type ProductProposal = {
  url: string; // the page that was read, after redirects
  name: string | null;
  line: string | null; // one sentence about the product, in the product's own words
  image: string | null; // the share picture
  icon: string | null;
  screenshots: string[]; // only what the page declares; never guessed
  colour: string | null; // the page's own theme colour as "#rrggbb"; product-colour.ts decides if it may be used
};

export type FetchResult =
  | { ok: true; proposal: ProductProposal }
  | { ok: false; reason: string };

// ---------------------------------------------------------------- addresses

/** True for an address our server must never call on a stranger's behalf. */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : a;
  const parts = v4.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    const [x, y] = parts.map(Number);
    return (
      x === 0 || x === 10 || x === 127 ||
      (x === 100 && y >= 64 && y <= 127) || // carrier-grade NAT
      (x === 169 && y === 254) || // link-local, cloud metadata
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0) ||
      (x === 198 && (y === 18 || y === 19)) ||
      x >= 224 // multicast and reserved
    );
  }
  if (!a.includes(":")) return true; // not an address we understand: refuse
  return (
    a === "::" || a === "::1" ||
    a.startsWith("fc") || a.startsWith("fd") || // unique local
    a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") || // link-local
    a.startsWith("ff") || // multicast
    a.startsWith("64:ff9b:") // NAT64, which can wrap a private IPv4
  );
}

/** The link as we will call it, or null. https, plain host name, default port. */
export function fetchableUrl(raw: unknown): URL | null {
  const clean = productUrlOrNull(raw);
  if (!clean) return null;
  const u = new URL(clean);
  if (u.protocol !== "https:" || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+(\.\d+)*$/.test(host)) return null; // a bare number or dotted address is not a product site
  return u;
}

// ---------------------------------------------------------------- reading the page

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function tidy(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  // Tags are dropped, then control characters; what is left is plain text for React to escape.
  const plain = decode(text.replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/** An absolute https picture link, or null. Anything else is dropped. */
function picture(raw: string | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decode(raw.trim()), base);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Read a product page. Pure: no network. Takes only what the page declares about
 * itself (share tags, title, icons, and screenshots in its structured data).
 */
export function parseProductPage(html: string, pageUrl: string): ProductProposal {
  const base = new URL(pageUrl);
  const head = html.slice(0, MAX_BYTES);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content;
  }
  let icon: string | null = null;
  let iconRank = 0;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || "").toLowerCase();
    const rank = rel.includes("apple-touch-icon") ? 2 : rel.split(/\s+/).includes("icon") ? 1 : 0;
    if (rank > iconRank) {
      const link = picture(a.href, base);
      if (link) { icon = link; iconRank = rank; }
    }
  }
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const screenshots: string[] = [];
  for (const m of head.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const stack: unknown[] = [data];
    let seen = 0;
    while (stack.length && seen++ < 200) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== "object") continue;
      const shot = (node as Record<string, unknown>).screenshot;
      for (const item of Array.isArray(shot) ? shot : shot ? [shot] : []) {
        const raw = typeof item === "string" ? item : (item as Record<string, unknown>)?.url ?? (item as Record<string, unknown>)?.contentUrl;
        const link = typeof raw === "string" ? picture(raw, base) : null;
        if (link && !screenshots.includes(link) && screenshots.length < MAX_SCREENSHOTS) screenshots.push(link);
      }
      const graph = (node as Record<string, unknown>)["@graph"];
      if (graph) stack.push(graph);
    }
  }

  return {
    url: base.toString(),
    name: tidy(meta["og:site_name"] || meta["application-name"] || meta["og:title"] || meta["twitter:title"] || title, NAME_MAX),
    line: tidy(meta["og:description"] || meta["twitter:description"] || meta["description"], LINE_MAX),
    image: picture(meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"], base),
    icon,
    screenshots,
    colour: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((meta["theme-color"] || "").trim()) ? meta["theme-color"].trim().toLowerCase() : null,
  };
}

// ---------------------------------------------------------------- the fenced fetch

export type FetchDeps = {
  /** All addresses a host name resolves to. */
  resolve: (host: string) => Promise<string[]>;
  /** One request that does NOT follow redirects and connects to `address` only. */
  request: (url: string, signal: AbortSignal, address: string) => Promise<Response>;
};

async function defaultResolve(host: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true })).map((r) => r.address);
}

/** One GET over https to the pinned address. No redirect is followed. */
export async function pinnedRequest(url: string, signal: AbortSignal, address: string): Promise<Response> {
  const https = await import("node:https");
  const { isIP } = await import("node:net");
  const zlib = await import("node:zlib");
  const { Readable } = await import("node:stream");
  const family = isIP(address);
  if (!family) throw new Error("not an address");
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        signal,
        headers: { accept: "text/html", "accept-encoding": "gzip, br", "user-agent": "FavourProductFetch/1" },
        // The connection asks for the address of the host; it always gets the checked one.
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all) (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
          else (callback as (e: null, a: string, f: number) => void)(null, address, family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers.set(k, v);
        if (status < 200 || status > 599 || (status >= 300 && status < 400) || status === 204) {
          res.resume();
          resolve(new Response(null, { status: status < 200 || status > 599 ? 502 : status, headers }));
          return;
        }
        const encoding = (res.headers["content-encoding"] || "").toLowerCase();
        const body =
          encoding === "gzip" ? res.pipe(zlib.createGunzip()) :
          encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) :
          encoding === "" || encoding === "identity" ? res : null;
        if (!body) { res.destroy(); reject(new Error("unknown encoding")); return; }
        body.on("error", () => res.destroy());
        resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const defaultDeps: FetchDeps = { resolve: defaultResolve, request: pinnedRequest };

/** The first MAX_BYTES of the page. What a page says about itself is at the top,
 *  so a large page is cut there and read, never loaded whole. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const all = new Uint8Array(MAX_BYTES);
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, MAX_BYTES - size);
    all.set(value.subarray(0, take), size);
    size += take;
  }
  if (size === MAX_BYTES) await reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(all.subarray(0, size));
}

/** Fetch a product page behind the fence and read it. Never throws. */
export async function fetchProduct(raw: unknown, deps: FetchDeps = defaultDeps): Promise<FetchResult> {
  let url = fetchableUrl(raw);
  if (!url) return { ok: false, reason: "That is not a public https link." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let addresses: string[];
      try { addresses = await deps.resolve(url.hostname); } catch { addresses = []; }
      if (addresses.length === 0) return { ok: false, reason: "The site could not be found." };
      if (addresses.some(isPrivateAddress)) return { ok: false, reason: "That link does not point to a public site." };

      // Every address passed the check; the request is tied to the first one.
      const res = await deps.request(url.toString(), controller.signal, addresses[0]);
      if (res.status >= 300 && res.status < 400) {
        const next = fetchableUrl(new URL(res.headers.get("location") || "", url).toString());
        if (!next) return { ok: false, reason: "The site sent us somewhere we do not follow." };
        url = next;
        continue;
      }
      if (!res.ok) return { ok: false, reason: `The site answered with an error (${res.status}).` };
      if (!/^text\/html\b/i.test(res.headers.get("content-type") || "")) {
        return { ok: false, reason: "The link is not a web page." };
      }
      const html = await readCapped(res);
      return { ok: true, proposal: parseProductPage(html, url.toString()) };
    }
    return { ok: false, reason: "The site redirects too many times." };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "The site took too long to answer." : "The site could not be read." };
  } finally {
    clearTimeout(timer);
  }
}
