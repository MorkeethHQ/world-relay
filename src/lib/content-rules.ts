// CONTENT RULES: pictures and text nobody controls (Oscar, 9 Oct 2026: "We need a
// strong design guideline so all projects and content look good even if the
// images are bad"). Pure, client-safe. The screen that draws a picture or a
// line asks this file what to draw; it never decides on its own.
//
// Pictures: one fallback chain, the same everywhere. The share picture, then the
// icon on the app's own colour ground (only a colour productColour() allows;
// a refused one gives the pale ground from the name's hue), then the first
// letter on that same ground. A picture that fails to load, or is smaller than
// PICTURE_MIN_PX on a side, drops to the next step. "Mostly white" cannot be
// told from what the server holds (no size, no pixels), so the frame itself is
// the answer: a fixed ratio, a soft ground and a hairline inside edge, so a
// white picture still reads as a tile.
//
// Text: a name is one line, a line is two, and the rest is on the detail
// screen. Empty text is not drawn. A bare link shows as its host.

import type { CampaignPicture } from "@/lib/campaign-picture";
import { hueOf } from "@/lib/campaign-picture";
import { productColour } from "@/lib/product-colour";

export const PICTURE_MIN_PX = 48;
export const NAME_MAX = 60;
export const LINE_MAX = 120;

export type PictureStep =
  | { kind: "picture"; url: string }
  | { kind: "icon"; url: string; ground: string }
  | { kind: "initial"; letter: string; ground: string };

/** The soft ground under an icon or a letter: the app's own colour when it is
 *  allowed, else a pale tint from the name. Never a colour that means points or money. */
export function groundOf(name: string, colour?: string | null): string {
  const own = productColour(colour);
  return own ? own.fill : `hsl(${hueOf(name)} 12% 92%)`;
}

export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

/** The chain, in order. The last step always exists, so a tile is never empty. */
export function pictureSteps(input: { url?: string | null; icon?: string | null; colour?: string | null; name: string }): PictureStep[] {
  const ground = groundOf(input.name, input.colour);
  const out: PictureStep[] = [];
  if (input.url) out.push({ kind: "picture", url: input.url });
  if (input.icon && input.icon !== input.url) out.push({ kind: "icon", url: input.icon, ground });
  out.push({ kind: "initial", letter: initialOf(input.name), ground });
  return out;
}

export function stepsOf(picture: CampaignPicture, name: string, colour?: string | null): PictureStep[] {
  return pictureSteps({ url: picture.url, icon: picture.icon, colour, name });
}

/** A picture this small is a favicon or a tracking pixel, not a picture of the app. */
export function pictureTooSmall(width: number, height: number): boolean {
  return !(width >= PICTURE_MIN_PX && height >= PICTURE_MIN_PX);
}

/** Text to draw, or null. Empty, blank and the words "undefined" and "null" are nothing. */
export function textOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t !== "undefined" && t !== "null" ? t : null;
}

/** Cut at a word when it can, with one ellipsis. `max` counts characters. */
export function clamp(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (Array.from(t).length <= max) return t;
  const head = Array.from(t).slice(0, max - 1).join("");
  const atWord = head.lastIndexOf(" ");
  return (atWord > max / 2 ? head.slice(0, atWord) : head).trimEnd() + "…";
}

/** A bare link is shown as its host, so a line never reads "https://...". */
export function hostIfLink(text: string): string {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return text;
  try { return new URL(t).hostname.replace(/^www\./, ""); } catch { return text; }
}

export function nameText(v: unknown): string | null {
  const t = textOrNull(v);
  return t ? clamp(hostIfLink(t), NAME_MAX) : null;
}

export function lineText(v: unknown): string | null {
  const t = textOrNull(v);
  return t ? clamp(hostIfLink(t), LINE_MAX) : null;
}
