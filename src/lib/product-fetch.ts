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

function privateV4(x: number, y: number, z: number, w: number): boolean {
  return (
    x === 0 || x === 10 || x === 127 ||
    (x === 100 && y >= 64 && y <= 127) || // carrier-grade NAT
    (x === 169 && y === 254) || // link-local, cloud metadata
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 168) ||
    (x === 192 && y === 0) || // protocol assignments and TEST-NET-1
    (x === 198 && (y === 18 || y === 19)) ||
    (x === 198 && y === 51 && z === 100) || (x === 203 && y === 0 && z === 113) || // TEST-NET-2 and 3
    (x === 168 && y === 63 && z === 129 && w === 16) || // a cloud host endpoint
    x >= 224 // multicast and reserved
  );
}

function v4Parts(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number);
}

/** The 16 bytes of an IPv6 address in any written form, or null. */
function v6Bytes(text: string): number[] | null {
  let a = text;
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  const tail: number[] = [];
  const lastColon = a.lastIndexOf(":");
  if (a.includes(".")) { // a dotted IPv4 at the end, as in ::ffff:10.0.0.1
    const v4 = v4Parts(a.slice(lastColon + 1));
    if (!v4) return null;
    tail.push(...v4);
    a = a.slice(0, lastColon + 1) + "0:0"; // two placeholder groups, replaced below
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = all.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

/**
 * True for an address our server must never call on a stranger's behalf. The
 * address is read to its bytes first, so every written form of one address gets
 * one answer ("::ffff:7f00:1" and "::ffff:127.0.0.1" are the same loopback).
 * Anything that cannot be read is refused.
 */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = v4Parts(a);
  if (v4) return privateV4(v4[0], v4[1], v4[2], v4[3]);
  if (!a.includes(":")) return true;
  const b = v6Bytes(a);
  if (!b) return true;
  const zeros = (from: number, to: number) => b.slice(from, to).every((n) => n === 0);
  if (zeros(0, 10) && b[10] === 255 && b[11] === 255) return privateV4(b[12], b[13], b[14], b[15]); // IPv4-mapped
  if (zeros(0, 12)) return true; // unspecified, loopback and the old IPv4-compatible form
  if (zeros(0, 8) && b[8] === 255 && b[9] === 255) return true; // IPv4-translated
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; // NAT64, can wrap a private IPv4
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 6to4, wraps an IPv4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x01 && b[1] === 0 && zeros(2, 8)) return true; // discard-only
  if ((b[0] & 0xfe) === 0xfc) return true; // unique local
  if (b[0] === 0xfe && (b[1] & 0x80) === 0x80) return true; // link-local and the old site-local
  return b[0] === 0xff; // multicast
}

/** The link as we will call it, or null. https, plain host name, default port. */
export function fetchableUrl(raw: unknown): URL | null {
  const clean = productUrlOrNull(raw);
  if (!clean) return null;
  const u = new URL(clean);
  if (u.protocol !== "https:" || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d+(\.\d+)*$/.test(host)) return null; // a bare number or dotted address is not a product site
  return u;
}

// ---------------------------------------------------------------- reading the page

// BOUNDED READING (8 Oct 2026, from a hostile review). The page is a stranger's
// text and this code runs on the server's one thread, where no timer can stop a
// slow pattern. So nothing here scans an unbounded stretch twice: tags are found
// with indexOf and cut at TAG_MAX, every text is cut before it is cleaned, and
// every loop has a count limit. Measured before this: 512 KB of "<meta " took 72 s.
const TAG_MAX = 2048;
const TAGS_MAX = 400;
const TEXT_IN_MAX = 2000;
const LD_MAX = 64 * 1024;
const LD_BLOCKS_MAX = 8;
const LD_NODES_MAX = 400;

function decode(text: string): string {
  // One pass, so an escaped entity ("&amp;lt;") is decoded once and stays text.
  return text.replace(/&(amp|quot|#0*39|apos|lt|gt|nbsp);/g, (_m, name: string) =>
    name === "amp" ? "&" : name === "quot" ? '"' : name === "lt" ? "<" : name === "gt" ? ">" : name === "nbsp" ? " " : "'");
}

/** Text with every tag cut out. One pass, no backtracking. */
function stripTags(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<", i);
    if (open === -1) { out += text.slice(i); break; }
    out += text.slice(i, open) + " ";
    const close = text.indexOf(">", open);
    if (close === -1) break; // a tag that never ends: the rest is dropped
    i = close + 1;
  }
  return out;
}

function tidy(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  // Tags are dropped, then control characters; what is left is plain text for React to escape.
  const plain = decode(stripTags(text.slice(0, TEXT_IN_MAX))).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Every part has a length limit, so a long run of letters cannot be rescanned.
  for (const m of tag.matchAll(/([a-zA-Z:-]{1,40})\s{0,4}=\s{0,4}(?:"([^"]{0,1500})"|'([^']{0,1500})'|([^\s"'>]{1,1500}))/g)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/** Every `<name ...>` opening tag, at most TAGS_MAX of them, each at most TAG_MAX long. */
function openTags(lower: string, html: string, name: string): string[] {
  const found: string[] = [];
  const needle = `<${name}`;
  let i = 0;
  while (found.length < TAGS_MAX) {
    const start = lower.indexOf(needle, i);
    if (start === -1) break;
    const after = lower.charCodeAt(start + needle.length);
    i = start + needle.length;
    // The name must end here: "<meta " or "<meta>" or "<meta/", never "<metadata".
    if (!(after === 32 || after === 9 || after === 10 || after === 13 || after === 47 || after === 62)) continue;
    const window = html.slice(start, start + TAG_MAX);
    const end = window.indexOf(">");
    if (end === -1) continue; // longer than TAG_MAX, or never closed: not a tag we read
    found.push(window.slice(0, end + 1));
    i = start + end + 1;
  }
  return found;
}

/** The text between `<name ...>` and `</name>`, for the first `limit` such blocks. */
function blocks(lower: string, html: string, name: string, wanted: (tag: string) => boolean, limit: number, max: number): string[] {
  const out: string[] = [];
  const needle = `<${name}`;
  const closing = `</${name}`;
  let i = 0;
  let looked = 0;
  while (out.length < limit && looked++ < TAGS_MAX) {
    const start = lower.indexOf(needle, i);
    if (start === -1) break;
    const window = html.slice(start, start + TAG_MAX);
    const end = window.indexOf(">");
    if (end === -1) { i = start + needle.length; continue; }
    const bodyStart = start + end + 1;
    i = bodyStart;
    if (!wanted(window.slice(0, end + 1))) continue;
    const close = lower.indexOf(closing, bodyStart);
    if (close === -1) break; // no closing tag anywhere after this point: stop looking
    if (close - bodyStart <= max) out.push(html.slice(bodyStart, close));
    i = close + closing.length;
  }
  return out;
}

/** An absolute https picture link, or null. Anything else is dropped. */
function picture(raw: string | undefined, base: URL): string | null {
  if (!raw || raw.length > 2000) return null;
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
  const lower = head.toLowerCase();
  const meta: Record<string, string> = {};
  for (const tag of openTags(lower, head, "meta")) {
    const a = attrs(tag);
    const key = (a.property || a.name || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content;
  }
  let icon: string | null = null;
  let iconRank = 0;
  for (const tag of openTags(lower, head, "link")) {
    const a = attrs(tag);
    const rel = (a.rel || "").toLowerCase();
    const rank = rel.includes("apple-touch-icon") ? 2 : rel.split(/\s+/).includes("icon") ? 1 : 0;
    if (rank > iconRank) {
      const link = picture(a.href, base);
      if (link) { icon = link; iconRank = rank; }
    }
  }
  const title = blocks(lower, head, "title", () => true, 1, TEXT_IN_MAX)[0];

  const screenshots: string[] = [];
  const isLd = (tag: string) => (attrs(tag).type || "").toLowerCase() === "application/ld+json";
  for (const text of blocks(lower, head, "script", isLd, LD_BLOCKS_MAX, LD_MAX)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { continue; }
    const stack: unknown[] = [data];
    let seen = 0;
    while (stack.length && seen++ < LD_NODES_MAX && screenshots.length < MAX_SCREENSHOTS) {
      const node = stack.pop();
      if (Array.isArray(node)) { for (const item of node.slice(0, 50)) stack.push(item); continue; }
      if (!node || typeof node !== "object") continue;
      const shot = (node as Record<string, unknown>).screenshot;
      // Read in the page's own order, and stop at the limit before building any link.
      for (const item of (Array.isArray(shot) ? shot : shot ? [shot] : []).slice(0, 20)) {
        if (screenshots.length >= MAX_SCREENSHOTS) break;
        const raw = typeof item === "string" ? item : (item as Record<string, unknown>)?.url ?? (item as Record<string, unknown>)?.contentUrl;
        const link = typeof raw === "string" ? picture(raw, base) : null;
        if (link && !screenshots.includes(link)) screenshots.push(link);
      }
      const graph = (node as Record<string, unknown>)["@graph"];
      if (graph) stack.push(graph);
    }
  }

  const theme = (meta["theme-color"] || "").trim().toLowerCase();
  return {
    url: base.toString(),
    name: tidy(meta["og:site_name"] || meta["application-name"] || meta["og:title"] || meta["twitter:title"] || title, NAME_MAX),
    line: tidy(meta["og:description"] || meta["twitter:description"] || meta["description"], LINE_MAX),
    image: picture(meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"], base),
    icon,
    screenshots,
    colour: /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(theme) ? theme : null,
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
      try {
        // The lookup is under the same time limit as the request.
        addresses = await Promise.race([
          deps.resolve(url.hostname),
          new Promise<never>((_ok, no) => controller.signal.addEventListener("abort", () => no(new Error("timeout")), { once: true })),
        ]);
      } catch {
        if (controller.signal.aborted) return { ok: false, reason: "The site took too long to answer." };
        addresses = [];
      }
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
    controller.abort(); // closes a connection whose answer was not read to the end
  }
}
