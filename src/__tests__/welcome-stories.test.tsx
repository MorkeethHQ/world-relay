import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WelcomeStories } from "@/components/WelcomeStories";
import { storyArt } from "@/lib/welcome-stories";
import { CAMPAIGNS } from "@/lib/campaigns";
import { WELCOME_ORIGINAL_STEPS, WELCOME_PROVENANCE, type WelcomeStepView, type WelcomeView } from "@/lib/welcome-shape";

const noop = () => {};
function markup(steps: WelcomeStepView[], signedIn=true) {
  const welcome: WelcomeView = {campaign:CAMPAIGNS.find(c=>c.id==="first-favour")!,provenance:WELCOME_PROVENANCE,authenticated:signedIn,steps,done:steps.filter(s=>s.state==="done").length};
  return renderToStaticMarkup(<WelcomeStories welcome={welcome} signedIn={signedIn} busyId={null} error={null} onStart={noop} onBack={noop} onDiscover={noop} />).replaceAll("<!-- -->","").replaceAll("&#x27;", "'");
}
function step(state:WelcomeStepView["state"], extra:Partial<WelcomeStepView>={}):WelcomeStepView{return {sourceTaskId:"drink",description:WELCOME_ORIGINAL_STEPS[0],category:"photo",points:5,state,...extra};}

describe("selected Stories campaign UI",()=>{
  it("matches pictures by original task, not the position of a live source row",()=>{
    expect(storyArt(WELCOME_ORIGINAL_STEPS[4])).toEqual({title:"One kindness",image:"/hero/couple.jpg"});
    const html=markup([step("todo",{sourceTaskId:"kindness",description:WELCOME_ORIGINAL_STEPS[4]})]);
    expect(html).toContain("/hero/couple.jpg");expect(html).toContain(WELCOME_ORIGINAL_STEPS[4]);
  });
  it("shows all original words only for the active favour and offers direct next choices",()=>{
    const html=markup([step("todo"),step("todo",{sourceTaskId:"view",description:WELCOME_ORIGINAL_STEPS[1]})]);
    expect(html).toContain(WELCOME_ORIGINAL_STEPS[0]);expect(html).not.toContain(WELCOME_ORIGINAL_STEPS[1]);
    expect(html).toContain("Open favour 2: Your view");expect(html).toContain("Campaign illustration, not submitted proof.");
  });
  it("never promotes saved or in-review proof to acceptance or points",()=>{
    for(const state of ["sent","in_review"] as const){const html=markup([step(state,{proofNote:"A saved TEST DATA note"})]);expect(html).toContain("0 accepted");expect(html).toContain("No points");expect(html).not.toContain("Accepted · 5 points");}
  });
  it("does not label a started claim as a saved submission before proof exists",()=>{
    const html=markup([step("sent")]);expect(html).toContain("Started, proof not sent");expect(html).toContain("Continue this favour");expect(html).not.toContain("Your proof is saved");expect(html).not.toContain("awaiting a result");
  });
  it("returns rejected proof with the actual reason and another try",()=>{
    const html=markup([step("todo",{reviewNote:{outcome:"upheld",at:"2026-10-28",reasons:["City not included"]}})]);
    expect(html).toContain("Returned for another try");expect(html).toContain("City not included");expect(html).toContain("No points were added");
  });
  it("shows actual accepted points without an action to earn the same favour again",()=>{
    const html=markup([step("done")]);expect(html).toContain("Accepted · 5 points");expect(html).toContain("1 accepted");expect(html).not.toContain("do this favour");
  });
  it("does not expose a signed-out visitor to another person's accepted state",()=>{
    const html=markup([step("done")],false);expect(html).toContain("sign in to start");expect(html).not.toContain("Accepted · 5 points");expect(html).toContain("0 accepted");
  });
  it("has an honest empty campaign state",()=>{expect(markup([])).toContain("No favours are available to start right now");});
});
