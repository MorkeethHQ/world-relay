import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EMPTY_FINDING, clearFindingDraft, findingDraftKey, loadFindingDraft, projectFromSearch, projectHref, saveFindingDraft, type ProjectFinding } from "@/lib/project-review-campaign";

// SYNTHETIC test data: wallets, campaign ids and finding text below are made up.
const ALICE = "0x000000000000000000000000000000000000a11c";
const BOB = "0x0000000000000000000000000000000000000b0b";
function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, keys: () => [...m.keys()] };
}
const draft: ProjectFinding = { did: "Saved one synthetic item", finding: "Synthetic: the item vanished on refresh", outcome: "broke", preference: "A" };

describe("project review address follows the project", () => {
  it("round-trips a project id through the address, including awkward characters", () => {
    for (const id of ["draft_abc", "draft_a&b=c", "draft_ü/é"]) expect(projectFromSearch(projectHref(id).slice(1))).toBe(id);
    expect(projectFromSearch(projectHref(null).slice(1))).toBeNull();
    expect(projectFromSearch("?campaign=project-reviews&project=")).toBeNull();
  });
});

describe("unsent findings stay with their account and project", () => {
  it("keeps a finding per account and per campaign, never across", () => {
    const s = memoryStore();
    saveFindingDraft(s, ALICE, "draft_one", draft);
    expect(loadFindingDraft(s, ALICE, "draft_one")).toEqual(draft);
    expect(loadFindingDraft(s, ALICE, "draft_two")).toBe(EMPTY_FINDING);
    expect(loadFindingDraft(s, BOB, "draft_one")).toBe(EMPTY_FINDING);
  });
  it("writes nothing to the device while signed out", () => {
    const s = memoryStore();
    saveFindingDraft(s, null, "draft_one", draft);
    expect(s.keys()).toEqual([]);
    expect(findingDraftKey(null, "draft_one")).toBeNull();
    expect(loadFindingDraft(s, null, "draft_one")).toBe(EMPTY_FINDING);
  });
  it("removes the stored draft once emptied or cleared after an accepted review", () => {
    const s = memoryStore();
    saveFindingDraft(s, ALICE, "draft_one", draft);
    saveFindingDraft(s, ALICE, "draft_one", EMPTY_FINDING);
    expect(s.keys()).toEqual([]);
    saveFindingDraft(s, ALICE, "draft_one", draft);
    clearFindingDraft(s, ALICE, "draft_one");
    expect(s.keys()).toEqual([]);
  });
  it("ignores tampered or oversized stored values instead of trusting them", () => {
    const s = memoryStore();
    s.setItem(findingDraftKey(ALICE, "draft_one")!, JSON.stringify({ did: "x".repeat(900), finding: 5, outcome: "paid", preference: "C" }));
    const v = loadFindingDraft(s, ALICE, "draft_one");
    expect(v.did.length).toBe(300);
    expect(v).toMatchObject({ finding: "", outcome: "", preference: "" });
    s.setItem(findingDraftKey(ALICE, "draft_one")!, "{not json");
    expect(loadFindingDraft(s, ALICE, "draft_one")).toBe(EMPTY_FINDING);
  });
});

describe("history wiring (source guard: no DOM runner in this repo)", () => {
  const campaign = readFileSync(resolve(__dirname, "../components/ProjectReviewCampaign.tsx"), "utf8");
  const feed = readFileSync(resolve(__dirname, "../components/Feed.tsx"), "utf8");
  it("pushes an entry per project and re-reads the project on back/forward", () => {
    expect(campaign).toMatch(/function choose\([^)]*\)\{[^}]*history\.pushState/);
    expect(campaign).not.toMatch(/history\.replaceState/);
    expect(campaign).toMatch(/const sync=\(\)=>\{[^}]*setActive\(projectFromSearch\(window\.location\.search\)\)/);
    expect(campaign).toContain("window.addEventListener('popstate',sync)");
    expect(campaign).not.toMatch(/function choose\([^)]*\)\{[^}]*setFinding\(/);
  });
  it("entering project reviews and its proof step are back-able", () => {
    expect(feed).toMatch(/onOpenProjectReviews=\{\(\) => \{[^}]*history\.pushState/);
    expect(feed).toContain('setView("proof"); }} />');
    expect(feed).toContain('window.history.pushState(null,"",window.location.pathname+window.location.search); setProjectProofNote(note);');
  });
});
