import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// OSCAR, 19 Oct 2026 18:45: "lets not say vibe coded, lets say 'your new projects
// and products'". No user-facing text in the app may say "vibe". Code comments
// may keep the word as history; this reads every line that is not a comment.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!p.includes("__tests__")) walk(p, out); }
    else if (/\.(tsx?|md|json)$/.test(f)) out.push(p);
  }
  return out;
}

describe("the app never says vibe", () => {
  it("no non-comment line in src/app, src/components or public says vibe", () => {
    const root = process.cwd();
    const hits: string[] = [];
    for (const dir of ["src/app", "src/components", "public"]) {
      for (const file of walk(join(root, dir))) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
          if (/vibe/i.test(t)) hits.push(`${file.slice(root.length + 1)}:${i + 1}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
