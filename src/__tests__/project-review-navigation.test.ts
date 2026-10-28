import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { EMPTY_FINDING, PROJECT_PROOF_ENTRY, carrySignedOutDrafts, isProjectProofEntry, clearFindingDraft, findingDraftKey, loadFindingDraft, projectFromSearch, projectHref, saveFindingDraft, type ProjectFinding } from "@/lib/project-review-campaign";

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
    expect(campaign).toMatch(/const sync=\(\)=>\{[^}]*setActive\(projectFromSearch\(window\.location\.search\)\)/);
    expect(campaign).toContain("window.addEventListener('popstate',sync)");
    expect(campaign).not.toMatch(/function choose\([^)]*\)\{[^}]*setFinding\(/);
  });
  it("entering project reviews and its proof step are back-able", () => {
    expect(feed).toMatch(/onOpenProjectReviews=\{\(\) => \{[^}]*history\.pushState/);
    expect(feed).toContain('setView("proof"); }} />');
    expect(feed).toContain('window.history.pushState({ ...PROJECT_PROOF_ENTRY },"",window.location.pathname+window.location.search); setProjectProofNote(note);');
  });
  it("in-app proof exit consumes only its own marked entry", () => {
    expect(feed).toContain('if (proofFrom === "project-reviews" && isProjectProofEntry(window.history.state)) window.history.back();');
    expect(feed).toContain('onCreateTask={() => { leaveProjectProofForBoard();');
    expect(feed).toContain('onJudge={() => { leaveProjectProofForBoard();');
  });
  it("tells a signed-in person their unsent finding stays on this device", () => {
    expect(campaign).toContain("saved on this device for your account only");
  });
});

describe("the proof history marker", () => {
  it("recognises only our marked entry, including Next's merged state", () => {
    expect(isProjectProofEntry({ ...PROJECT_PROOF_ENTRY })).toBe(true);
    expect(isProjectProofEntry({ ...PROJECT_PROOF_ENTRY, __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} })).toBe(true);
    for (const s of [null, undefined, {}, { __NA: true }, { favourProjectProof: "true" }, "favourProjectProof"]) expect(isProjectProofEntry(s)).toBe(false);
  });
});

describe("first sign-in carries every signed-out project draft", () => {
  it("moves all signed-out drafts into the account without replacing its own", () => {
    const s = memoryStore();
    const accountOwn: ProjectFinding = { ...draft, finding: "Synthetic: the account's own earlier draft" };
    saveFindingDraft(s, ALICE, "draft_two", accountOwn);
    const signedOutText = { draft_one: draft, draft_two: { ...draft, did: "Synthetic signed-out text for two" }, draft_three: { ...draft, did: "Synthetic signed-out text for three" } };
    expect(carrySignedOutDrafts(s, ALICE, signedOutText).sort()).toEqual(["draft_one", "draft_three"]);
    expect(loadFindingDraft(s, ALICE, "draft_one")).toEqual(draft);
    expect(loadFindingDraft(s, ALICE, "draft_two")).toEqual(accountOwn);
    expect(loadFindingDraft(s, ALICE, "draft_three").did).toBe("Synthetic signed-out text for three");
    expect(loadFindingDraft(s, BOB, "draft_one")).toBe(EMPTY_FINDING);
  });
  it("carries nothing without an account and skips empty drafts", () => {
    const s = memoryStore();
    expect(carrySignedOutDrafts(s, null, { draft_one: draft })).toEqual([]);
    expect(carrySignedOutDrafts(s, ALICE, { draft_one: EMPTY_FINDING })).toEqual([]);
    expect(s.keys()).toEqual([]);
  });
});
