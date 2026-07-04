// Post-a-favour starter templates, shared by the create wizard (as placeholder
// hints) and the tasks API (to reject verbatim template copy). The board was
// filling with identical template descriptions from different posters, so the
// template text is a hint the user must replace, never the stored description.
export const POST_TEMPLATES = [
  { label: "Dare someone", desc: "I dare you to do something bold in public. Photo the proof.", category: "custom" as const, bounty: "1" },
  { label: "Review a spot", desc: "Go to a place nearby and review it honestly. Photo your experience and rate it.", category: "review" as const, bounty: "1" },
  { label: "Post about this", desc: "Post about something you care about on X or Instagram. Screenshot it.", category: "social" as const, bounty: "2" },
  { label: "Test my product", desc: "Try an app or website and share your first impressions. What works? What breaks?", category: "custom" as const, bounty: "5" },
  { label: "Check IRL", desc: "Go somewhere in person and photograph what you find.", category: "check-in" as const, bounty: "2" },
  { label: "Quick opinion", desc: "Share your honest take on something. Detailed answers earn more.", category: "feedback" as const, bounty: "1" },
];

export const MIN_DESCRIPTION_LENGTH = 12;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const TEMPLATE_SET = new Set(POST_TEMPLATES.map((t) => normalize(t.desc)));

export function isTemplateCopy(description: string): boolean {
  return TEMPLATE_SET.has(normalize(description));
}
