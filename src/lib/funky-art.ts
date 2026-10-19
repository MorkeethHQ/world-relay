// FUNKY PLACEHOLDER ART (Oscar, 11 Oct 2026: "I like the place holder more FUN and
// funky images though", "we need placeholder images, graphics that work and
// scales"). A card with no real picture gets one of these: bold flat shapes on a
// hue that is steady for the name, drawn as an SVG data URI so it scales to any
// size and ships no file. Variant A rules: black 2 px strokes, square corners,
// one hue per card, no gradient, no stock picture.
import { hueOf } from "@/lib/campaign-picture";

const SHAPES = [
  // Each is a small composition in a 400 x 210 box. Pick by name.
  (h: number) => `<rect x="40" y="30" width="150" height="150" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><circle cx="290" cy="105" r="70" fill="#fff" stroke="#000" stroke-width="4"/>`,
  (h: number) => `<polygon points="60,180 200,30 340,180" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><rect x="250" y="40" width="110" height="60" fill="#fff" stroke="#000" stroke-width="4"/>`,
  (h: number) => `<circle cx="120" cy="105" r="75" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><rect x="220" y="40" width="130" height="130" fill="#000"/><rect x="250" y="70" width="70" height="70" fill="#fff"/>`,
  (h: number) => `<rect x="30" y="60" width="340" height="90" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><circle cx="110" cy="105" r="30" fill="#000"/><circle cx="200" cy="105" r="30" fill="#fff" stroke="#000" stroke-width="4"/><circle cx="290" cy="105" r="30" fill="#000"/>`,
  (h: number) => `<polygon points="200,20 380,105 200,190 20,105" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><rect x="160" y="65" width="80" height="80" fill="#fff" stroke="#000" stroke-width="4"/>`,
  (h: number) => `<rect x="30" y="30" width="110" height="150" fill="#000"/><rect x="150" y="30" width="110" height="150" fill="hsl(${h} 90% 55%)" stroke="#000" stroke-width="4"/><rect x="270" y="30" width="110" height="150" fill="#fff" stroke="#000" stroke-width="4"/>`,
];

// Five loud hues. None is the brand blue, the banner orange, or any violet.
const HUES = [52, 150, 352, 318, 182];

export function funkyArt(name: string): string {
  const seed = hueOf(name || "?");
  const h = HUES[seed % HUES.length];
  const pick = SHAPES[seed % SHAPES.length];
  const initial = (Array.from((name || "?").trim())[0] ?? "?").toUpperCase().replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 210" width="400" height="210"><rect width="400" height="210" fill="#fff"/>${pick(h)}<rect x="10" y="164" width="44" height="38" fill="#fff" stroke="#000" stroke-width="4"/><text x="32" y="193" text-anchor="middle" font-family="Aeonik,-apple-system,Helvetica,Arial,sans-serif" font-size="26" font-weight="700" fill="#000">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
