// BADGES AND LEVELS (Oscar, 11 Oct 2026: "maybe you can get a badge in the room
// as well 'reviewer' 'feedbacker' level up"; "once you feedback 10 projects you
// get 1 usdc or something"). Pure. The counts come from the person's own
// contributions (/api/me/contributions), never from a claim.
export type Badge = { name: string; level: number; next: number | null; line: string };

export const REVIEWER_STEPS = [1, 5, 10, 25];

export function reviewerBadge(reviews: number): Badge {
  const level = REVIEWER_STEPS.filter((s) => reviews >= s).length;
  const next = REVIEWER_STEPS.find((s) => reviews < s) ?? null;
  return {
    name: "Reviewer",
    level,
    next,
    line: level === 0 ? "Review one project to earn it." : next ? `${next - reviews} more to level ${level + 1}.` : "Top level.",
  };
}

export function feedbackerBadge(withFix: number): Badge {
  const steps = [1, 3, 10];
  const level = steps.filter((s) => withFix >= s).length;
  const next = steps.find((s) => withFix < s) ?? null;
  return { name: "Feedbacker", level, next, line: level === 0 ? "Name one thing to fix to earn it." : next ? `${next - withFix} more to level ${level + 1}.` : "Top level." };
}

export function builderBadge(posted: boolean): Badge {
  return { name: "Builder", level: posted ? 1 : 0, next: posted ? null : 1, line: posted ? "You posted an app." : "Post your app to earn it." };
}
