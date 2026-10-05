import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateFavourSpec, isNearDuplicate, FALLBACK_FAVOURS } from "@/lib/board-replenish";
import { gibberishReason } from "@/lib/post-quality";
import { looksLikeSpam, isMissionCandidate } from "@/lib/board-rank";
import { personalDataAsk, safetyClauseProblem } from "@/lib/favour-safety";

// THE DRAFT FAVOUR PACK (2026-10-05). A reviewed data file, NOT posted. This test
// is what "reviewed" means: every row is loadable by the replenisher's own
// validator, reads as a real instruction, is not a money pitch, and does not
// repeat anything that was on the live board in the 14 days before 4 Oct or in
// the fallback pool.
const pack = JSON.parse(readFileSync("docs/drafts/favour-pack-2026-10-05.json", "utf8"));
const live: string[] = JSON.parse(readFileSync("src/__tests__/fixtures/live-descriptions-2026-10-04.json", "utf8")).descriptions;
type Row = { id: string; description: string; safety: string; category: string; points: number; deadlineHours: number; maxCompletions: number; proofRequired: string; whoWouldWantIt: string; funding: string };
const rows: Row[] = pack.favours;

describe("draft favour pack 2026-10-05", () => {
  // The brief asked for 10 to 15. Three cold reads cut the pack to the rows that
  // survive being read as a member of the public. Fewer good rows beat more risky
  // ones, so the count is whatever survives, and the file says how many were asked for.
  it("holds only the rows that survived review, with unique ids, and says how many were asked for", () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(pack._count_note).toContain("asked for 10 to 15");
    expect(pack._count_note).toContain(`${rows.length} remain`);
  });

  // Third cold read (2026-10-05): every photo row asked for the town beside a photo
  // of a real spot, some with the day and time, under one wallet. Several answers
  // from one wallet gave a home town and a set of places.
  it("no row asks for a town, a spot, or a time", () => {
    const PLACES_OR_TIMES = /\b(town|city|village|street|road|square|park|station|stop|entrance|building|library|post office|pharmacy|restaurant|cafe|menu|poster|board|tap|fountain|recycling point|day and time|the time|today|this week|tonight|right now|near you|nearest)\b/i;
    for (const r of rows) {
      const m = PLACES_OR_TIMES.exec(r.description);
      expect(m?.[0], `${r.id}: "${m?.[0]}"`).toBeUndefined();
    }
  });

  it("no row that was dropped for placing a person or showing a third party is back", () => {
    for (const id of ["pharmacy-hours", "water-refill", "departure-board", "step-free-entrance", "free-event-poster", "history-tab-confusion", "cheap-hot-meal", "recycling-point"]) {
      expect(rows.some((r) => r.id === id), id).toBe(false);
    }
  });

  // The live check is a model. No human reviews a proof. Each row says what that
  // check can see in the proof and what it cannot, in so many words.
  it("every row says what its proof can show and what it cannot, and names the live model as the checker", () => {
    type Limits = { checkedBy?: string; proofShows?: string; proofCannotShow?: string; reviewerCheck?: string };
    for (const r of rows as Array<Row & Limits>) {
      expect(r.checkedBy, r.id).toBe("the live model check, not a person");
      expect((r.proofShows ?? "").length, r.id).toBeGreaterThan(30);
      expect((r.proofCannotShow ?? "").length, r.id).toBeGreaterThan(60);
      expect(r.proofCannotShow, r.id).toMatch(/sender|their own|who took/i);
      expect(r.reviewerCheck, `${r.id}: the old field assumed a human reviewer`).toBeUndefined();
    }
  });

  it("the pack states its known limits at the top", () => {
    const limits: string[] = pack._known_limits;
    expect(Array.isArray(limits)).toBe(true);
    expect(limits.length).toBeGreaterThanOrEqual(5);
    const all = limits.join(" ");
    expect(all).toMatch(/Nothing shows that a photo is the sender's own/);
    expect(all).toMatch(/one wallet/);
    expect(all).toMatch(/model/);
    expect(all).toMatch(/not been read by anyone but the drafter|read by no one but/);
  });

  it("every row passes the replenisher validator unchanged", () => {
    for (const r of rows) {
      const spec = validateFavourSpec(r);
      expect(spec, r.id).not.toBeNull();
      expect(spec!.description).toBe(r.description);
    }
  });

  it("every row reads as an instruction and none is a money pitch", () => {
    for (const r of rows) {
      expect(gibberishReason(r.description), r.id).toBeNull();
      expect(looksLikeSpam(r.description), r.id).toBe(false);
    }
  });

  it("no row repeats the live board of the last 14 days, the fallback pool, or another row", () => {
    const pool = FALLBACK_FAVOURS.map((f) => f.description);
    expect(live.length).toBeGreaterThan(40);
    for (const r of rows) {
      expect(isNearDuplicate(r.description, live), `${r.id} vs live`).toBe(false);
      expect(isNearDuplicate(r.description, pool), `${r.id} vs pool`).toBe(false);
      expect(isNearDuplicate(r.description, rows.filter((o) => o.id !== r.id).map((o) => o.description)), `${r.id} vs pack`).toBe(false);
    }
  });

  it("every row states its proof, a plausible requester and its funding honestly", () => {
    for (const r of rows) {
      expect(r.proofRequired.length, r.id).toBeGreaterThan(20);
      expect(r.whoWouldWantIt.length, r.id).toBeGreaterThan(20);
      expect(r.funding, r.id).toBe("unfunded draft");
    }
    expect(pack._status).toContain("Not posted");
  });

  // Cold walk, 5 Oct: only `description` is posted. A safeguard written in the
  // review notes never reaches the person. So every row carries its safety wording
  // inside the posted text, and declares it in `safety` so this test can find it.
  it("every row carries its safety wording inside the text that is posted", () => {
    for (const r of rows) {
      expect(typeof r.safety, r.id).toBe("string");
      expect(r.description.includes(r.safety), `${r.id}: the safety clause must be part of the posted description`).toBe(true);
      expect(safetyClauseProblem(r.safety), r.id).toBeNull();
    }
  });

  it("no row asks for identity documents, contact details, a home or precise location, other people's faces, financial screens or account and network identifiers", () => {
    for (const r of rows) {
      const hit = personalDataAsk(r.description);
      expect(hit, `${r.id}: ${hit?.kind} ("${hit?.match}")`).toBeNull();
    }
  });

  // The second walker's harness, kept: row 1's ask replaced by each of his asks,
  // the row's valid safety clause left in place. All of these stayed green on the
  // first version of the check.
  it("an unsafe ask does not pass because a valid safety clause follows it", () => {
    const walker: Array<{ text: string }> = JSON.parse(readFileSync("src/__tests__/fixtures/personal-data-asks.json", "utf8")).walker;
    for (const w of walker) {
      const description = `${w.text} ${rows[0].safety}`;
      expect(personalDataAsk(description), w.text).not.toBeNull();
    }
  });

  it("this test is a reviewer's aid: the pack file says a person must read every row", () => {
    expect(pack._review_note).toContain("A person must read every row before it is posted");
  });

  it("the rows the cold walks called unsafe or unprovable are gone", () => {
    for (const id of ["street-conditions", "signal-check", "atm-working", "notice-board", "visitor-trick", "public-toilet", "free-this-week"]) expect(rows.some((r) => r.id === id), id).toBe(false);
  });

  it("a photo row asks for a photo, and a text row is one the model can check against the posted text itself", () => {
    type Kind = { proofKind?: string };
    for (const r of rows as Array<Row & Kind>) {
      expect(["photo", "text the model can check against the posted line"], r.id).toContain(r.proofKind);
      if (r.proofKind === "photo") expect(/\bphoto\b/i.test(r.description.replace(r.safety, "")), `${r.id}: a photo row must ask for a photo`).toBe(true);
    }
  });

  it("no row asks for a street, a stop the person uses, or a walking distance from them", () => {
    for (const r of rows) {
      expect(/name the (street|road|stop|square|park)|you use|walk of you|minutes? (of|from) you|nearest you/i.test(r.description), r.id).toBe(false);
    }
  });

  it("is not all one kind of ask", () => {
    expect(new Set(rows.map((r) => r.category)).size).toBeGreaterThanOrEqual(Math.min(2, rows.length));
    expect(rows.filter((r) => r.category === "feedback").length).toBeLessThanOrEqual(Math.floor(rows.length / 3));
  });

  // The first version of this test wanted at least 3 rows the daily mission could
  // pick. The mission picks "here and now" asks: near you, where you are, right
  // now (R13, isMissionCandidate). Those are the same words that place a person.
  // After two cold walks the pack asks for the town and nothing nearer, so it
  // feeds the mission nothing, on purpose. That tension is a product decision and
  // is written in the return file; it is not settled here.
  it("no row uses the here and now wording that places a person", () => {
    for (const r of rows) {
      expect(/near you|nearest|closest to you|where you are|right now|around you|outside your/i.test(r.description), r.id).toBe(false);
    }
    expect(rows.filter((r) => isMissionCandidate({ description: r.description } as never))).toHaveLength(0);
  });

  it("contains no em dash or en dash (house writing rule)", () => {
    expect(JSON.stringify(pack)).not.toMatch(/[–—]/);
  });
});
