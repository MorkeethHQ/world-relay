import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignStageCards } from "@/components/CampaignFrontDoor";
import { pickCampaignStage } from "@/lib/campaign-stage";
import { CAMPAIGNS } from "@/lib/campaigns";
import type { WelcomeView } from "@/lib/welcome-shape";

const welcome = { campaign: CAMPAIGNS.find((c) => c.id === "first-favour")!, steps: [], done: 0, authenticated: false } as unknown as WelcomeView;
const noop = () => {};
function render(value: WelcomeView | null) {
  return renderToStaticMarkup(<CampaignStageCards stage={pickCampaignStage({ welcome: value, company: null })} welcome={value} welcomeLoading={false} signedIn={false} campaigns={CAMPAIGNS} onOpenCampaign={noop} onOpenWelcome={noop} onOpenCompany={noop} onForCompanies={noop} onOpenDemo={noop} />).replaceAll("<!-- -->", "");
}
describe("campaign home with the production zero-step Welcome response", () => {
  it("keeps the real Welcome hero, reward and image when there are no steps", () => {
    const html = render(welcome);
    expect(html).toContain("Your First Favours");
    expect(html).toContain("welcome-hero");
    expect(html).toContain("Up to 10 points per accepted favour");
    expect(html).toContain("/campaign-friends.jpg");
    expect(html).not.toContain("0 small favours");
  });
  it("shows the campaign but disables its action when the API has no journey", () => {
    const html = render(null);
    expect(html).toContain("Your First Favours");
    expect(html).toContain("Campaign unavailable");
    expect(html).toContain('disabled=""');
  });
  it("shows the planning-only token example without reviving expired or app-review cards", () => {
    const html = render(welcome);
    expect(html).toContain("Shape a FAVOUR token launch.");
    expect(html).toContain("Planning only");
    expect(html).toContain("No token exists here.");
    expect(html).not.toMatch(/RELAY Launch Campaign|OpenClaw|Hermes|Ten YES|Post your app|Campaign photograph:/);
  });
});
