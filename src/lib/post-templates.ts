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

// Ideas on the quick points screen. Each asks for a view, not an errand (the
// 2026-09-03 completion data in CLAUDE.md), and each is answerable in under a
// minute from anywhere. Tapping one fills the box as a starting point. The
// verbatim idea is rejected like template copy, so the board never fills with
// the same five asks from different posters.
export const QUICK_IDEAS: { text: string; photo: boolean }[] = [
  { text: "What should I cook tonight with eggs, rice and not much else?", photo: false },
  { text: "Show me the view from where you are right now.", photo: true },
  { text: "Which song would fix a grey Monday?", photo: false },
  { text: "What is the best cheap lunch near you, and what does it cost?", photo: false },
  { text: "Photo the oddest sign you pass today.", photo: true },
];

export const MIN_DESCRIPTION_LENGTH = 12;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const TEMPLATE_SET = new Set([
  ...POST_TEMPLATES.map((t) => normalize(t.desc)),
  ...QUICK_IDEAS.map((i) => normalize(i.text)),
]);

export function isTemplateCopy(description: string): boolean {
  return TEMPLATE_SET.has(normalize(description));
}
