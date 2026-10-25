import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignStageCards } from "@/components/CampaignFrontDoor";
import { pickCampaignStage } from "@/lib/campaign-stage";
import { CAMPAIGNS } from "@/lib/campaigns";
import type { WelcomeView } from "@/lib/welcome-shape";

const welcome = { campaign: CAMPAIGNS.find((c) => c.id === "first-favour")!, steps: [], done: 0, authenticated: false } as unknown as WelcomeView;
const noop = () => {};
function render(value: WelcomeView | null) {
  return renderToStaticMarkup(<CampaignStageCards stage={pickCampaignStage({ welcome: value, company: null })} welcome={value} signedIn={false} campaigns={CAMPAIGNS} onOpenCampaign={noop} onOpenWelcome={noop} onOpenCompany={noop} onForCompanies={noop} onOpenDemo={noop} />).replaceAll("<!-- -->", "");
}
describe("campaign home with the production zero-step Welcome response", () => {
  it("keeps the real Welcome hero, reward and image when there are no steps", () => {
    const html = render(welcome);
    expect(html).toContain("Your First Favours");
    expect(html).toContain("welcome-hero");
    expect(html).toContain("Up to 10 points per accepted favour");
    expect(html).toContain("/campaign-coffee.jpg");
    expect(html).not.toContain("0 small favours");
  });
  it("also uses the registry hero before the API arrives", () => {
    expect(render(null)).toContain("Your First Favours");
  });
  it("shows the original launch campaign honestly as history, without an app review or raw task feed", () => {
    const html = render(welcome);
    expect(html).toContain("RELAY Launch Campaign");
    expect(html).toContain("Past campaign");
    expect(html).toContain("Rewards are historical");
    expect(html).not.toMatch(/OpenClaw|Hermes|Ten YES|Post your app|Campaign photograph:/);
  });
});
