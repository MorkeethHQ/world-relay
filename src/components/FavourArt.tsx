// FAVOUR ART, the picture a favour gets when it has no picture of its own
// (Oscar, 11 Oct 2026: "favours are so uninsipirational, just looks like
// vercel", "we need placeholder images, graphics that work and scales").
// DESIGN-SYSTEM.md, "Favour art".
//
// A drawing, never a photo and never a product's picture: flat shapes on one
// flat ground, made from the favour's kind and its id, so one favour keeps one
// picture. It scales to any box and crops from the middle. It is decoration
// and says so to a screen reader (aria-hidden). No gradient, no keyframe.

export type ArtKind = "say" | "photo" | "place" | "review" | "share" | "welcome" | "judge";

/** Ground, shape, second shape. Six flat sets; the id picks one. */
export const ART_SETS = [
  { g: "#1f4fff", a: "#ffd23f", b: "#ffffff" },
  { g: "#ffd23f", a: "#1b1b1f", b: "#ffffff" },
  { g: "#0e7c66", a: "#ffb8d1", b: "#fff6e5" },
  { g: "#ffb8d1", a: "#1f4fff", b: "#1b1b1f" },
  { g: "#bfe3ff", a: "#ff5a36", b: "#12284c" },
  { g: "#ff5a36", a: "#fff6e5", b: "#1b1b1f" },
] as const;

/** A favour's kind of picture, from its category. An unknown category is a thing to say. */
export function artKind(category: string | null | undefined): ArtKind {
  switch (category) {
    case "photo": return "photo";
    case "check-in": case "delivery": case "errand": return "place";
    case "review": return "review";
    case "social": return "share";
    default: return "say";
  }
}

/** One number from a seed, the same on the server and in the browser. */
export function artHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function Shapes({ kind, a, b, g, n }: { kind: ArtKind; a: string; b: string; g: string; n: number }) {
  // Two small shifts from the seed, so two favours of one kind do not draw the same picture.
  const dx = (n % 5) * 6 - 12;
  const dy = ((n >> 3) % 5) * 4 - 8;
  switch (kind) {
    case "photo":
      return (
        <>
          <circle cx={226 + dx} cy={62 + dy} r="34" fill={a} />
          <path d={`M0 180 L0 ${128 + dy} L88 ${70 + dy} L176 180 Z`} fill={b} />
          <path d={`M96 180 L${200 + dx} 104 L320 164 L320 180 Z`} fill={a} />
          <path d="M22 44 V22 H44 M276 22 H298 V44" fill="none" stroke={b} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "place":
      return (
        <>
          <path d={`M-10 ${60 + dy} H330 M-10 ${132 + dy} H330 M${84 + dx} -10 V190 M${236 + dx} -10 V190`} stroke={b} strokeWidth="14" opacity="0.55" />
          <path d={`M${160 + dx} 150 C${118 + dx} 106 ${112 + dx} 84 ${112 + dx} 72 a48 48 0 0 1 96 0 C${208 + dx} 84 ${202 + dx} 106 ${160 + dx} 150 Z`} fill={a} />
          <circle cx={160 + dx} cy="72" r="17" fill={g} />
        </>
      );
    case "review":
      return (
        <>
          <rect x={48 + dx} y={34 + dy} width="170" height="124" rx="16" fill={b} />
          <circle cx={68 + dx} cy={54 + dy} r="5" fill={g} /><circle cx={84 + dx} cy={54 + dy} r="5" fill={g} />
          <path d={`M${68 + dx} ${84 + dy} h112 M${68 + dx} ${106 + dy} h84 M${68 + dx} ${128 + dy} h100`} stroke={g} strokeWidth="9" strokeLinecap="round" opacity="0.35" />
          <path d="M244 52 l11.5 23.4 25.8 3.7 -18.7 18.2 4.4 25.7 -23 -12.1 -23 12.1 4.4 -25.7 -18.7 -18.2 25.8 -3.7Z" fill={a} />
        </>
      );
    case "share":
      return (
        <>
          <path d={`M92 ${118 + dy} L${164 + dx} 56 L236 ${124 + dy}`} fill="none" stroke={b} strokeWidth="8" strokeLinecap="round" />
          <circle cx="92" cy={118 + dy} r="30" fill={a} />
          <circle cx={164 + dx} cy="56" r="26" fill={b} />
          <circle cx="236" cy={124 + dy} r="34" fill={a} />
        </>
      );
    case "welcome":
      return (
        <>
          <path d="M160 34 V14 M98 58 L84 44 M222 58 L236 44 M70 118 H48 M250 118 H272" stroke={b} strokeWidth="8" strokeLinecap="round" />
          <path d={`M${92 + dx} 132 a68 68 0 0 1 136 0 Z`} fill={a} />
          <rect x="0" y="132" width="320" height="48" fill={b} />
        </>
      );
    case "judge":
      return (
        <>
          <rect x={52 + dx} y="40" width="100" height="112" rx="14" fill={b} transform={`rotate(-8 ${102 + dx} 96)`} />
          <rect x={170 + dx} y="34" width="100" height="112" rx="14" fill={a} transform={`rotate(7 ${220 + dx} 90)`} />
          <path d={`M${78 + dx} 100 l16 16 30 -36`} fill="none" stroke={g} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M${200 + dx} 70 l40 40 M${240 + dx} 70 l-40 40`} fill="none" stroke={g} strokeWidth="10" strokeLinecap="round" />
        </>
      );
    default:
      return (
        <>
          <path d={`M${40 + dx} ${36 + dy} h150 a18 18 0 0 1 18 18 v52 a18 18 0 0 1 -18 18 h-96 l-30 26 v-26 h-24 a18 18 0 0 1 -18 -18 v-52 a18 18 0 0 1 18 -18 Z`} fill={b} />
          <path d={`M${68 + dx} ${68 + dy} h96 M${68 + dx} ${92 + dy} h62`} stroke={g} strokeWidth="9" strokeLinecap="round" opacity="0.4" />
          <path d={`M178 ${82 + dy} h96 a16 16 0 0 1 16 16 v34 a16 16 0 0 1 -16 16 h-10 v22 l-26 -22 h-60 a16 16 0 0 1 -16 -16 v-34 a16 16 0 0 1 16 -16 Z`} fill={a} />
        </>
      );
  }
}

export function FavourArt({ kind, seed, className }: { kind: ArtKind; seed: string; className?: string }) {
  const n = artHash(`${kind}:${seed}`);
  const set = ART_SETS[n % ART_SETS.length];
  return (
    <svg className={className} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-art={kind}>
      <rect width="320" height="180" fill={set.g} />
      <Shapes kind={kind} a={set.a} b={set.b} g={set.g} n={n >> 8} />
    </svg>
  );
}
