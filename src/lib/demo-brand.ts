// THE DEMO BRAND (2026-10-05). A picture of what a brand campaign on FAVOUR
// could look like. Pure, client-safe, and deliberately NOT a campaign:
//   - it is not in CAMPAIGNS, so getCampaign cannot resolve its id and no task
//     can be linked to it,
//   - it has no task rows, so nothing can be claimed, submitted, scored or paid,
//   - it has no pot, no unlock and no sponsor. Every amount is a PROPOSAL.
// The brand is made up. The screen says so in its first line.
export type DemoItem = {
  key: string;
  size: "micro" | "big";
  title: string;
  ask: string;
  effort: string;
  // A PROPOSED amount in USDC. Display only. Never a balance, never owed.
  proposedUsdc: number;
};

export const DEMO_BRAND = {
  id: "demo-brand-sundial-tea",
  demo: true as const,
  funded: false as const,
  claimable: false as const,
  name: "Sundial Tea Co.",
  label: "Demo brand, fictional",
  disclaimer: "Sundial Tea Co. does not exist. This is a demo of what a brand campaign could look like. Nothing here is funded, sponsored or open to do, and nothing here pays USDC or points.",
  pitch: "A small tea brand wants to know how people really drink tea, from people who are provably real.",
  items: [
    { key: "shelf", size: "micro", title: "Shelf check", ask: "Photo the tea shelf at the shop nearest you, with prices visible.", effort: "2 minutes", proposedUsdc: 0.001 },
    { key: "pick", size: "micro", title: "Pick one", ask: "Two label designs, side by side. Which one would you pick up first, and why in one line?", effort: "30 seconds", proposedUsdc: 0.001 },
    { key: "moment", size: "micro", title: "The moment", ask: "When did you last drink something hot outdoors? One honest sentence.", effort: "30 seconds", proposedUsdc: 0.001 },
    { key: "tasting", size: "big", title: "Host a tasting", ask: "Brew three teas for five neighbours, note what each person said about each cup, and write it up with photos.", effort: "A weekend", proposedUsdc: 25 },
  ] as DemoItem[],
} as const;

// A proposed USDC amount, written in full. 0.001 must read 0.001: two fixed
// decimals would print 0.00, which says "nothing" about an amount that is not
// nothing. Up to 6 decimals (USDC's own precision), trailing zeros dropped.
export function formatProposedUsdc(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "0";
  const s = amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

export function proposedLabel(amount: number): string {
  return `Proposed ${formatProposedUsdc(amount)} USDC, not funded`;
}
