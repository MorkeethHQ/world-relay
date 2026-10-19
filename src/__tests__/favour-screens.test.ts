import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { threadSpeaker } from "@/lib/thread";

// THE FAVOUR SCREENS (14 Oct 2026, Oscar: "continue building so it gets in good
// shape"). Found by scripts/test-product-phone-walk.mjs. The browser walk is
// the real check; these pin the source so a cleanup cannot drop them again.

const src = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
const POSTER = "0x7e57da7a000000000000000000000000000000a1";
const DOER = "0x7e57da7a000000000000000000000000000000b2";

describe("1. the in-app favour screen shows the thread", () => {
  it("names each line by role, never by wallet", () => {
    const roles = { poster: POSTER, claimant: DOER, viewer: DOER };
    expect(threadSpeaker(DOER, roles)).toBe("You");
    expect(threadSpeaker(POSTER, roles)).toBe("Poster");
    expect(threadSpeaker(DOER, { ...roles, viewer: POSTER })).toBe("Doer");
    expect(threadSpeaker(POSTER.toUpperCase().replace("0X", "0x"), roles)).toBe("Poster");
    expect(threadSpeaker("relay-bot", roles)).toBe("FAVOUR");
    expect(threadSpeaker("0x" + "9".repeat(40), roles)).toBe("Someone");
  });
  it("TaskDetail draws the messages for a party, also after completion", () => {
    const feed = src("src/components/Feed.tsx");
    const detail = feed.slice(feed.indexOf("function TaskDetail("));
    expect(detail).toMatch(/aria-label="Messages"/);
    expect(detail).toMatch(/\{isParticipant && messages\.length > 0 && \(/);
    expect(detail).toMatch(/messages\.map\(\(m\) =>/);
    expect(detail).toContain("threadSpeaker(m.sender,");
  });
});

describe("2. a Profile favour row opens the favour page", () => {
  it("each History row links to its project (19 Oct 2026: rows are contributions, not tasks)", () => {
    const page = src("src/components/fv/HistoryScreen.tsx");
    expect(page).toMatch(/href=\{`\/project\/\$\{encodeURIComponent\(c\.campaignId\)\}`\}/);
  });
});

describe("4. the favour page carries no stale copy", () => {
  // The UMA escalation button stays: it is real code behind umaEnabled.
  it("no access code badge, no tier badge, no 'AI + UMA + Chainlink' line", () => {
    const page = src("src/app/task/[id]/page.tsx");
    for (const stale of ["Access Code Required", "RequiredTierBadge", "AI + UMA + Chainlink", "Dispute resolution powered by", "Chainlink"]) expect(page, stale).not.toContain(stale);
  });
});

// Found while fixing 1: the favour page sent every message as
// "task.claimant || task.poster", so the poster wrote under the doer's wallet.
describe("the favour page sends a message as the signed-in person", () => {
  it("sender is the viewer, never the task's claimant or poster", () => {
    const page = src("src/app/task/[id]/page.tsx");
    const send = page.slice(page.indexOf("const sendMessage = useCallback("), page.indexOf("const sendMessage = useCallback(") + 900);
    expect(send).toContain("const sender = userId;");
    expect(send).not.toMatch(/sender = task\.(claimant|poster)/);
  });
  it("the thread is told who is looking, not the task's doer", () => {
    expect(src("src/app/task/[id]/page.tsx")).not.toContain("userId={task.claimant || task.poster}");
  });
});
