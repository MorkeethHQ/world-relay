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
  it("holds 10 to 15 favours with unique ids", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
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
    for (const id of ["street-conditions", "signal-check", "atm-working", "notice-board", "visitor-trick", "public-toilet"]) expect(rows.some((r) => r.id === id), id).toBe(false);
  });

  // Second cold walk: four drafts could not be proven with their stated proof.
  // Every row now says what kind of proof it takes and how a reviewer checks it.
  // A photo row must ask for a photo in the posted text. A text row is allowed
  // only when the answer can be checked against something the reviewer has.
  it("every row has a proof a reviewer could actually check", () => {
    type Proof = { proofKind?: string; reviewerCheck?: string };
    for (const r of rows as Array<Row & Proof>) {
      expect(["photo", "text checked against a known source"], r.id).toContain(r.proofKind);
      expect((r.reviewerCheck ?? "").length, r.id).toBeGreaterThan(30);
      if (r.proofKind === "photo") expect(/\bphoto\b/i.test(r.description.replace(r.safety, "")), `${r.id}: a photo row must ask for a photo`).toBe(true);
    }
    expect((rows as Array<Row & Proof>).filter((r) => r.proofKind !== "photo").length).toBeLessThanOrEqual(2);
  });

  it("no row asks for a street, a stop the person uses, or a walking distance from them", () => {
    for (const r of rows) {
      expect(/name the (street|road|stop|square|park)|you use|walk of you|minutes? (of|from) you|nearest you/i.test(r.description), r.id).toBe(false);
    }
  });

  it("is diverse: at least 5 categories, and feedback is not the majority", () => {
    const cats = rows.map((r) => r.category);
    expect(new Set(cats).size).toBeGreaterThanOrEqual(5);
    expect(cats.filter((c) => c === "feedback").length).toBeLessThanOrEqual(Math.floor(rows.length / 3));
  });

  it("gives the daily mission something to pick (the live board had no candidate on 4 Oct)", () => {
    expect(rows.filter((r) => isMissionCandidate({ description: r.description } as never)).length).toBeGreaterThanOrEqual(3);
  });

  it("contains no em dash or en dash (house writing rule)", () => {
    expect(JSON.stringify(pack)).not.toMatch(/[–—]/);
  });
});
