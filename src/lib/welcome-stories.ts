import { WELCOME_ORIGINAL_STEPS, type WelcomeStepView } from "./welcome-shape";

// The existing campaign illustrations, never submitted proof. Match the original
// text rather than a live row's index: closed/missing source rows cannot shift photos.
const ART = [
  ["First drink", "/hero/coffee.jpg"],
  ["Your view", "/hero/cyclist.jpg"],
  ["Last meal", "/hero/restaurant.jpg"],
  ["Only here", "/hero/world-cup.jpg"],
  ["One kindness", "/hero/couple.jpg"],
  ["Real price", "/campaign-coffee.jpg"],
  ["A smile", "/hero/icecream.jpg"],
  ["Where you are", "/hero/desk.jpg"],
  ["Your feedback", "/campaign-friends.jpg"],
  ["Your next favour", "/campaign-friends.jpg"],
] as const;

export function storyArt(description: string): { title: string; image: string } {
  const i = WELCOME_ORIGINAL_STEPS.indexOf(description);
  const entry = i < 0 ? null : ART[i];
  return entry ? { title: entry[0], image: entry[1] } : { title: "Your favour", image: "/campaign-friends.jpg" };
}

export function hasSavedStoryProof(step: WelcomeStepView): boolean {
  return !!step.hasPhoto || !!step.proofNote?.trim();
}

export function storyState(step: WelcomeStepView, signedIn: boolean): string {
  if (!signedIn) return "Ready to start";
  if (step.state === "done") return "Accepted";
  if (step.state === "in_review") return "In human review";
  if (step.state === "sent") return hasSavedStoryProof(step) ? "Saved, not checked" : "Started, proof not sent";
  if (step.reviewNote) return "Returned for another try";
  return "Ready to start";
}
