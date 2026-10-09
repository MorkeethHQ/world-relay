import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The first tests that draw a component. Written 9 Oct 2026: five hand-made
// faults in .tsx files passed all 1,444 tests, because no test drew a screen.
//
// These draw to a string on the server. They read what a part shows at rest.
// They cannot tap, fetch or follow a link, so a room that fails to load, a row
// that opens the wrong page and a product screen after its read are NOT covered
// here. Those need a browser test.

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

import { BottomNav } from "@/components/BottomNav";
import { RewardBadge } from "@/components/RewardBadge";

describe("the bottom nav", () => {
  // Fault U3: the Talk tab filtered out.
  it("shows the five tabs by name, in order", () => {
    const html = renderToStaticMarkup(<BottomNav />);
    const at = ["Today", "Favours", "Talk", "History", "Profile"].map((label) => html.indexOf(`>${label}<`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).not.toContain(">Polls<");
  });
});

describe("the reward number on a favour card", () => {
  const TX = `0x${"ab".repeat(32)}`;
  const draw = (task: Parameters<typeof RewardBadge>[0]["task"]) => renderToStaticMarkup(<RewardBadge hero task={task} />);

  // Fault U2: the funded check inverted. Green means escrowed USDC only.
  it("draws USDC with no deposit in gray, never green", () => {
    const html = draw({ rewardType: "usdc", bountyUsdc: 5, escrowTxHash: null, onChainId: null });
    expect(html).toContain("text-gray-400");
    expect(html).not.toContain("text-success-600");
  });

  it("draws USDC with a deposit in green", () => {
    const html = draw({ rewardType: "usdc", bountyUsdc: 5, escrowTxHash: TX, onChainId: 7 });
    expect(html).toContain("text-success-600");
    expect(html).not.toContain("text-gray-400");
  });

  it("draws points in amber with the unit pts, never as dollars", () => {
    const html = draw({ rewardType: "points", bountyUsdc: 10, escrowTxHash: null, onChainId: null });
    expect(html).toContain("text-amber-600");
    expect(html).toContain(">pts<");
    expect(html).not.toContain("$");
    expect(html).not.toContain("USDC");
  });
});
