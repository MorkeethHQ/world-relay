// R19, THE CAMPAIGN STAGE LEADS THE BOARD (2026-10-05). See BOARD-RULES.md.
// Pure, client-safe. Three rungs, always in this order:
//   1. Welcome      the original first-favour journey, done per person
//   2. Company      a real published campaign that may lead (R16 unchanged)
//   3. Demo brand   a labelled, fictional preview. Never something to join.
// `current` is the one rung the screen offers as the next thing to do.
import type { PublicCompanyCampaign } from "./campaign-draft-shape";
import { nextWelcomeStep, welcomeFinished, type WelcomeStepView, type WelcomeView } from "./welcome-shape";
import { DEMO_BRAND } from "./demo-brand";

export type CampaignStage = {
  current: "welcome" | "company" | "demo";
  welcome: null | {
    total: number;
    done: number;
    waiting: number; // sent or in review: started, not finished, not blocking
    next: WelcomeStepView | null;
    finished: boolean;
  };
  company: null | { campaign: PublicCompanyCampaign; openPieces: number; totalOpen: number };
  demo: typeof DEMO_BRAND;
};

export function pickCampaignStage(input: {
  welcome: WelcomeView | null;
  // The result of pickCampaignToDo: only a checked company with a real brief
  // and an open piece (R16). Null when none may lead.
  company: { campaign: PublicCompanyCampaign; openPieces: number; totalOpen: number } | null;
}): CampaignStage {
  const w = input.welcome && input.welcome.steps.length > 0 ? input.welcome : null;
  const welcome = w
    ? {
        total: w.steps.length,
        done: w.steps.filter((s) => s.state === "done").length,
        waiting: w.steps.filter((s) => s.state === "sent" || s.state === "in_review").length,
        next: nextWelcomeStep(w.steps),
        finished: welcomeFinished(w.steps),
      }
    : null;
  const current: CampaignStage["current"] =
    welcome && welcome.next ? "welcome" : input.company ? "company" : welcome && !welcome.finished ? "welcome" : "demo";
  return { current, welcome, company: input.company, demo: DEMO_BRAND };
}
