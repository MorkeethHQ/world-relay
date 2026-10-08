// A PRODUCT'S OWN COLOUR (Oscar, 8 Oct 2026: look C for the voted project, "yes
// that sounds great, lets go" to the rule change).
//
// One screen, the featured product, may be filled with the product's colour. This
// file is the only door for that colour. DESIGN-SYSTEM.md keeps its two meanings:
// green is real funded money and amber is points. So a product colour in either
// range is refused, and the screen falls back to ink. On 3 Sep 2026 a points
// campaign was painted green from its own colour and read as money; this is the
// rule that stops that while still letting a product look like itself.
//
// Pure: no network, nothing stored. Only FeaturedProduct calls it.

/** Hues from orange through amber, yellow, lime, green and teal to cyan. */
export const RESERVED_HUE_FROM = 15;
export const RESERVED_HUE_TO = 195;
/** Below this saturation a colour is a gray, and a gray carries neither meaning. */
export const GRAY_BELOW = 0.15;

export type ProductColour = {
  fill: string; // "#rrggbb", lower case
  onFill: "white" | "ink"; // the text colour that stays readable on the fill
};

function rgbOf(raw: unknown): [number, number, number] | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null; // names, rgb(), gradients and anything else: refused
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Hue in degrees and saturation from 0 to 1 (HSL). */
export function hueAndSaturation(r: number, g: number, b: number): { hue: number; saturation: number } {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0 };
  const light = (max + min) / 2;
  const saturation = d / (1 - Math.abs(2 * light - 1));
  const raw = max === x ? ((y - z) / d) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return { hue: (raw * 60 + 360) % 360, saturation };
}

/** True when a colour would read as money (green) or as points (amber). */
export function readsAsMoneyOrPoints(r: number, g: number, b: number): boolean {
  const { hue, saturation } = hueAndSaturation(r, g, b);
  return saturation >= GRAY_BELOW && hue >= RESERVED_HUE_FROM && hue <= RESERVED_HUE_TO;
}

/** The colour a featured product may fill its screen with, or null for ink. */
export function productColour(raw: unknown): ProductColour | null {
  const rgb = rgbOf(raw);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  if (readsAsMoneyOrPoints(r, g, b)) return null;
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const fill = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  // White text needs a contrast of 4.5 to 1 on the fill; a lighter fill takes ink.
  return { fill, onFill: 1.05 / (luminance + 0.05) >= 4.5 ? "white" : "ink" };
}
