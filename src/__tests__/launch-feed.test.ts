import { describe, expect, it } from "vitest";
import { MAX_LAUNCHES, fetchLaunches, parseLaunches, splitTitle } from "@/lib/launch-feed";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const sec = (msAgo: number) => Math.floor((NOW - msAgo) / 1000);
const hit = (id: string, title: string, url: unknown, points: number, extra: object = {}) => ({
  objectID: id, title, url, points, num_comments: 3, created_at_i: sec(3600_000), ...extra,
});

describe("reading a launch title", () => {
  it("splits a name from its line", () => {
    expect(splitTitle("Show HN: Bigwords.page – Turn any screen into a sign")).toEqual({ name: "Bigwords.page", line: "Turn any screen into a sign" });
    expect(splitTitle("Show HN: Terse, a plugin that halves reply length")).toEqual({ name: "Terse", line: "a plugin that halves reply length" });
    expect(splitTitle("Show HN: Pacer - will it last")).toEqual({ name: "Pacer", line: "will it last" });
  });

  it("keeps a title with no separator as the name, and never returns markup", () => {
    expect(splitTitle("Show HN: I built a thing")).toEqual({ name: "I built a thing", line: null });
    expect(splitTitle("Show HN: <script>x</script>Evil – <b>bold</b> line").name).not.toMatch(/</);
    expect(splitTitle("Show HN: " + "a".repeat(200)).name.length).toBeLessThanOrEqual(40);
  });
});

describe("today's launches", () => {
  it("ranks by the source's points and keeps the source's link", () => {
    const rows = parseLaunches({ hits: [hit("1", "Show HN: Low – a", "https://low.test/", 5), hit("2", "Show HN: High – b", "https://high.test/", 500)] }, NOW);
    expect(rows.map((r) => [r.rank, r.name, r.score])).toEqual([[1, "High", 500], [2, "Low", 5]]);
    expect(rows[0]).toMatchObject({ source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=2", url: "https://high.test/" });
  });

  it("drops a row with no safe product link, a bad id or a private host", () => {
    const rows = parseLaunches({ hits: [
      hit("1", "Show HN: No link", null, 900), hit("2", "Show HN: Plain", "http://plain.test/", 900),
      hit("3", "Show HN: Script", "javascript:alert(1)", 900), hit("4", "Show HN: Inside", "https://localhost/", 900),
      hit("5", "Show HN: Address", "https://10.0.0.1/", 900), hit("x/../y", "Show HN: Bad id", "https://ok.test/", 900),
      hit("6", "Show HN: Good – fine", "https://good.test/", 1),
    ] }, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Good"]);
  });

  it("means the last 24 hours: nothing older, nothing from the future", () => {
    const rows = parseLaunches({ hits: [
      hit("1", "Show HN: Old – x", "https://old.test/", 900, { created_at_i: sec(25 * 3600_000) }),
      hit("2", "Show HN: Future – x", "https://future.test/", 900, { created_at_i: sec(-60_000) }),
      hit("3", "Show HN: Now – x", "https://now.test/", 1),
    ] }, NOW);
    expect(rows.map((r) => r.name)).toEqual(["Now"]);
  });

  it("lists one product once and stops at the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => hit(String(i + 10), `Show HN: P${i} – x`, `https://p${i}.test/`, i));
    const rows = parseLaunches({ hits: [...many, hit("5", "Show HN: P0 again – x", "https://p0.test/", 999)] }, NOW);
    expect(rows).toHaveLength(MAX_LAUNCHES);
    expect(rows.filter((r) => r.url === "https://p0.test/")).toHaveLength(1);
  });

  it("gives an empty list for a broken answer, an error or a dead source", async () => {
    expect(parseLaunches(null, NOW)).toEqual([]);
    expect(parseLaunches({ hits: "no" }, NOW)).toEqual([]);
    expect(await fetchLaunches(NOW, (async () => new Response("no", { status: 500 })) as typeof fetch)).toEqual([]);
    expect(await fetchLaunches(NOW, (async () => { throw new Error("down"); }) as typeof fetch)).toEqual([]);
  });
});
