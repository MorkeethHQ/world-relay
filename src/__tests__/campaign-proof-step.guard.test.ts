import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PIECE_ASK, PIECE_PROOF_HINT, PIECE_KINDS } from "@/lib/campaign-draft-shape";

// The proof step for a company campaign piece (2026-09-21, walking "Filipino Lokal"
// on production at 390 px). It showed the whole brief as one heading with the
// instruction last, asked to "Type your answer" for a piece whose proof is a link,
// and said nothing about review or reward.
const feed = readFileSync(join(__dirname, "../components/Feed.tsx"), "utf8");

describe("a campaign piece's proof step says what to do, what to send, and what happens next", () => {
  it("shows the piece's own instruction on its own line", () => {
    expect(feed).toMatch(/\{PIECE_ASK\[pieceKind\]\}/);
  });
  it("asks for the right proof: a link, not 'your answer'", () => {
    expect(feed).toMatch(/placeholder=\{pieceKind \? PIECE_PROOF_HINT\[pieceKind\] : "Type your answer"\}/);
    for (const k of PIECE_KINDS) expect(PIECE_PROOF_HINT[k]).toMatch(/link/i);
  });
  it("explains review, reward and where it shows, and that it pays points only", () => {
    expect(feed).toMatch(/What happens next/);
    expect(feed).toMatch(/shown in History under \{pieceCampaign\.company\}/);
    expect(feed).toMatch(/This pays points only\. The \{pieceCampaign\.proposedPoolUsdc\} USDC pool is proposed, not funded\./);
  });
  it("titles the step 'Your piece', not 'Answer', for a campaign piece", () => {
    expect(feed).toMatch(/title=\{pieceKind \? "Your piece" : quick \?/);
  });
  it("keeps the brief readable: clamped, with a way to read it all", () => {
    expect(feed).toMatch(/briefOpen \? "" : "line-clamp-3"/);
    expect(feed).toMatch(/Read the brief/);
  });
  it("the ask the server writes into the task and the ask the screen shows are the same words", () => {
    const drafts = readFileSync(join(__dirname, "../lib/campaign-drafts.ts"), "utf8");
    expect(drafts).toMatch(/const KIND_ASK = PIECE_ASK;/);
    for (const k of PIECE_KINDS) expect(PIECE_ASK[k].length).toBeGreaterThan(20);
  });
});
