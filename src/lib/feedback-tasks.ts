import type { TaskCategory } from "./types";

export type FeedbackTemplate = {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  icon: string;
  pointsReward: number;
  requiresPhoto: boolean;
};

const FEEDBACK_TEMPLATES: FeedbackTemplate[] = [
  {
    id: "fb-try-and-tell",
    title: "Try RELAY, tell us one thing",
    description: "Open the app, tap around for 2 minutes, and tell us one thing that confused you or one thing you loved. Honest feedback only.",
    category: "feedback",
    icon: "💬",
    pointsReward: 15,
    requiresPhoto: false,
  },
  {
    id: "fb-favour-idea",
    title: "What favour would you pay $5 for?",
    description: "Imagine you're an AI agent stuck on something physical. What would you pay a stranger $5 to do right now? Be specific — the best ideas become real tasks.",
    category: "feedback",
    icon: "💡",
    pointsReward: 20,
    requiresPhoto: false,
  },
  {
    id: "fb-human-only",
    title: "Snap something only a human can verify",
    description: "Find something near you right now that no AI could verify from behind a screen — a queue length, a shop's real opening hours, whether a street is actually walkable. Photo it.",
    category: "feedback",
    icon: "📸",
    pointsReward: 25,
    requiresPhoto: true,
  },
  {
    id: "fb-dead-end",
    title: "When did an AI let you down?",
    description: "Tell us about a time an AI agent gave you wrong info about the real world — a closed restaurant, wrong directions, outdated hours. That's the problem RELAY solves.",
    category: "feedback",
    icon: "🚧",
    pointsReward: 15,
    requiresPhoto: false,
  },
  {
    id: "fb-spot-check",
    title: "Spot-check something near you",
    description: "Pick any business within walking distance. Is it open right now? Does the Google Maps listing match reality? Photo the storefront and tell us what's different.",
    category: "feedback",
    icon: "🔍",
    pointsReward: 25,
    requiresPhoto: true,
  },
  {
    id: "fb-rate-the-vibe",
    title: "Rate the vibe: 1-10",
    description: "Give RELAY FAVOURS a vibe rating from 1-10 and tell us why. What would make this a 10? We're building this in public and your take matters.",
    category: "feedback",
    icon: "⭐",
    pointsReward: 15,
    requiresPhoto: false,
  },
];

export function getActiveFeedbackTasks(count = 3): FeedbackTemplate[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const shuffled = [...FEEDBACK_TEMPLATES].sort(
    (a, b) => hashCode(a.id + dayOfYear) - hashCode(b.id + dayOfYear)
  );
  return shuffled.slice(0, count);
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function getFeedbackTemplate(id: string): FeedbackTemplate | null {
  return FEEDBACK_TEMPLATES.find((t) => t.id === id) ?? null;
}
