import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateFavourSpec, isNearDuplicate, FALLBACK_FAVOURS } from "@/lib/board-replenish";
import { gibberishReason } from "@/lib/post-quality";
import { looksLikeSpam, isMissionCandidate } from "@/lib/board-rank";
import { personalDataAsk, safetyClauseProblem } from "@/lib/favour-safety";

// ROWS ADDED ON 5 OCT, READ BY THE AUTHOR ONLY.
// 15 candidate rows were frozen in commit dc47e0d before any check ran. The
// personal data aid and a hostile read by the author ran after that. This file
// holds the surviving ids to the frozen text and to the pack's rules about the
// POSTED text. It does not make a row safe. It is a reviewer's aid.
//
// Not applied here, on purpose and said in the pack file: the reviewed list also
// wants a proofRequired field and a proofCannotShow over 60 characters. The
// frozen rows miss those, and a frozen row is not edited to pass.
const FROZEN = "docs/drafts/favour-pack-candidates-2026-10-05.json";
const FROZEN_SHA256 = "c843c79375a96f7d0de320915bd702af5f8db80c0a654e9715dec657e553316a";
const raw = readFileSync(FROZEN, "utf8");
type Row = { id: string; description: string; safety: string; category: string; funding: string; checkedBy: string; proofKind: string; proofShows: string; proofCannotShow: string; machineAnswer: string };
const candidates: Row[] = JSON.parse(raw).candidates;
const pack = JSON.parse(readFileSync("docs/drafts/favour-pack-2026-10-05.json", "utf8"));
const results = JSON.parse(readFileSync("docs/drafts/favour-pack-candidates-results-2026-10-05.json", "utf8"));
const added = pack._added_5_oct;
const rows: Row[] = (added.ids as string[]).map((id) => candidates.find((c) => c.id === id)!);
const live: string[] = JSON.parse(readFileSync("src/__tests__/fixtures/live-descriptions-2026-10-04.json", "utf8")).descriptions;

describe("rows added 5 Oct, read by one independent reader", () => {
  it("the frozen candidates file is byte for byte the file that was frozen", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(FROZEN_SHA256);
    expect(candidates).toHaveLength(15);
  });

  it("every added id is a frozen candidate, and every candidate has exactly one outcome", () => {
    for (const r of rows) expect(r, "an added id is missing from the frozen file").toBeDefined();
    // After the independent read: 1 kept, 5 dropped by the reader, 2 replaced by
    // proposed new wording (a new row, so the frozen one is out).
    const readerDropped: string[] = added.droppedByIndependentReader.map((d: { id: string }) => d.id);
    expect(readerDropped).toHaveLength(5);
    expect([...added.ids, ...readerDropped, ...added.replacedByProposedWording].sort()).toEqual([...added.authorKept].sort());
    const outcomes = [...added.ids, ...readerDropped, ...added.replacedByProposedWording, ...added.droppedByHostileRead, ...added.heldBackByAuthor, ...added.failedPackTextRule];
    expect(new Set(outcomes).size).toBe(outcomes.length);
    expect([...outcomes].sort()).toEqual(candidates.map((c) => c.id).sort());
    expect(added.written).toBe(15);
  });

  it("the added ids are the rows the results file passed, and no row it failed or held back", () => {
    const passed = (results.results as Array<{ id: string; aid: string; hostileVerdict: string; heldBack?: string }>)
      .filter((r) => r.aid === "pass" && r.hostileVerdict === "pass" && !r.heldBack).map((r) => r.id);
    // A row can pass both reads and still fail a rule about the posted text below.
    // Such a row is listed apart, with its reason, and is not edited to pass.
    expect([...added.authorKept, ...added.failedPackTextRule].sort()).toEqual(passed.sort());
    expect(added.failedPackTextRule).toEqual(["hard-word"]);
    expect(added.failedPackTextRuleWhy).toContain("was not edited and the rule was not loosened");
    const failed = (results.results as Array<{ id: string; hostileVerdict: string }>).filter((r) => r.hostileVerdict === "FAIL").map((r) => r.id);
    expect([...added.droppedByHostileRead].sort()).toEqual(failed.sort());
  });

  it("the added rows are kept out of the list that had independent reads, and say who read them", () => {
    const reviewed: string[] = pack.favours.map((f: { id: string }) => f.id);
    for (const id of added.ids) expect(reviewed, id).not.toContain(id);
    expect(added.ids).toEqual(["kinder-rejection"]);
    expect(added.heading).toBe("Added 5 Oct, read by one independent reader");
    expect(added.readStatus).toContain("One independent reader");
    expect(added.total).toContain("2 reviewed rows plus 1 added and independently read");
    expect(added.total).toContain("against 10 to 15");
  });

  it("the reader's replacement texts are held apart, marked not frozen and not read, and not counted", () => {
    const p = added.proposedNewWordingNotFrozenNotRead;
    expect(p.heading).toBe("Proposed 5 Oct, new wording, not frozen and not read");
    expect(p.status).toContain("not counted as added");
    expect(p.rows.map((r: { replaces: string }) => r.replaces).sort()).toEqual([...added.replacedByProposedWording].sort());
    const frozenTexts = candidates.map((c) => c.description);
    for (const r of p.rows as Array<{ replaces: string; description: string }>) {
      expect(added.ids, r.replaces).not.toContain(r.replaces);
      expect(frozenTexts, `${r.replaces}: a proposed text is a new text`).not.toContain(r.description);
      expect(r.description.length, r.replaces).toBeLessThanOrEqual(160);
    }
  });

  it("the pack says the live text check passes an on-topic attempt, and both rule gaps", () => {
    expect(added.proofShowsCorrection).toContain("on topic");
    expect((pack._known_limits as string[]).join(" ")).toContain("points are paid for engagement, not for quality");
    expect(added.ruleGaps.join(" ")).toContain("proofRequired");
    expect(added.ruleGaps.join(" ")).toContain("AFTER seeing the rows");
    expect(added.ruleGaps.join(" ")).toContain("leaves 0 rows added");
  });

  it("every added row passes the replenisher validator unchanged and reads as an instruction", () => {
    for (const r of rows) {
      const spec = validateFavourSpec(r as never);
      expect(spec, r.id).not.toBeNull();
      expect(spec!.description).toBe(r.description);
      expect(gibberishReason(r.description), r.id).toBeNull();
      expect(looksLikeSpam(r.description), r.id).toBe(false);
    }
  });

  it("no added row repeats the live board, the fallback pool, a reviewed row or another added row", () => {
    const pool = FALLBACK_FAVOURS.map((f) => f.description);
    const reviewed: string[] = pack.favours.map((f: { description: string }) => f.description);
    for (const r of rows) {
      expect(isNearDuplicate(r.description, live), `${r.id} vs live`).toBe(false);
      expect(isNearDuplicate(r.description, pool), `${r.id} vs pool`).toBe(false);
      expect(isNearDuplicate(r.description, reviewed), `${r.id} vs reviewed`).toBe(false);
      expect(isNearDuplicate(r.description, rows.filter((o) => o.id !== r.id).map((o) => o.description)), `${r.id} vs added`).toBe(false);
    }
  });

  it("every added row carries a safety clause in the posted text and the aid finds no personal data ask", () => {
    for (const r of rows) {
      expect(r.description.includes(r.safety), r.id).toBe(true);
      expect(safetyClauseProblem(r.safety), r.id).toBeNull();
      const hit = personalDataAsk(r.description);
      expect(hit, `${r.id}: ${hit?.kind} ("${hit?.match}")`).toBeNull();
    }
  });

  it("no added row names a place or a time, or uses here and now wording", () => {
    const PLACES_OR_TIMES = /\b(town|city|village|street|road|square|park|station|stop|entrance|building|library|post office|pharmacy|restaurant|cafe|menu|poster|board|tap|fountain|recycling point|day and time|the time|today|this week|tonight|right now|near you|nearest)\b/i;
    for (const r of rows) {
      const m = PLACES_OR_TIMES.exec(r.description);
      expect(m?.[0], `${r.id}: "${m?.[0]}"`).toBeUndefined();
      expect(/near you|nearest|closest to you|where you are|right now|around you|outside your|you use/i.test(r.description), r.id).toBe(false);
    }
    expect(rows.filter((r) => isMissionCandidate({ description: r.description } as never))).toHaveLength(0);
  });

  it("every added row is a text row checked by the model, unfunded, and says what a machine could answer", () => {
    for (const r of rows) {
      expect(r.proofKind, r.id).toBe("text the model can check against the posted line");
      expect(r.checkedBy, r.id).toBe("the live model check, not a person");
      expect(r.funding, r.id).toBe("unfunded draft");
      expect(r.proofShows.length, r.id).toBeGreaterThan(30);
      expect(r.proofCannotShow, r.id).toMatch(/sender/);
      expect(r.machineAnswer, r.id).toMatch(/language model|translator/);
      expect(r.machineAnswer, r.id).toMatch(/For the asker/);
    }
  });

  it("the added rows are not mostly one kind of ask", () => {
    expect(new Set(rows.map((r) => r.category)).size).toBeGreaterThanOrEqual(Math.min(2, rows.length));
    expect(rows.filter((r) => r.category === "feedback").length).toBeLessThanOrEqual(Math.floor(rows.length / 3));
  });

  it("the pack file says which of the reviewed list's rules these rows do not meet", () => {
    expect(added.notMetFromTheReviewedList).toContain("proofRequired");
    const short = rows.filter((r) => r.proofCannotShow.length <= 60).map((r) => r.id).sort();
    expect(short).toEqual([]);
    for (const id of short) expect(added.notMetFromTheReviewedList, id).toContain(id);
  });

  it("contains no em dash or en dash", () => {
    expect(raw + JSON.stringify(results) + JSON.stringify(added)).not.toMatch(/[–—]/);
  });
});
