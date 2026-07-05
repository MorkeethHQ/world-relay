import type { TaskCategory } from "./types";

export type Campaign = {
  id: string;
  name: string;
  brand: string;
  tagline: string;
  description: string;
  heroGradient: string;
  heroImage?: string;
  accentColor: string;
  icon: string;
  totalBudget: number;
  rewardPerTask: number;
  // How per-task reward is denominated for display. Points campaigns must not
  // render "$" (points and USDC are never conflated). Defaults to usdc when absent.
  rewardKind?: "points" | "usdc";
  taskCount: number;
  categories: TaskCategory[];
  taskDescriptions: string[];
  location: string;
  endsAt: string;
  featured: boolean;
  // Campaign-unlock mechanic (see BOARD-RULES.md sibling doc + campaign-unlock.ts).
  // Present only on campaigns with a real funded pot. All four fields required
  // together: pot is a HARD cap in USDC; a user unlocks unlockAmount once, after
  // unlockThreshold clean completions; requiresOrb gates the cash (no Orb, no cash).
  unlock?: {
    pot: number;
    unlockThreshold: number;
    unlockAmount: number;
    requiresOrb: true;
    maxCountedPerUser: number;
  };
};

export const CAMPAIGNS: Campaign[] = [
  {
    id: "first-favour",
    name: "Your First Favours",
    brand: "FAVOUR",
    tagline: "New here? Learn the ropes and climb the board.",
    description:
      "Welcome to FAVOUR. Get started with a series of small, real-world favours — a photo of your street, a quick honest review, a small kind act. Every one earns points, builds your reputation, and teaches you how FAVOUR works. Complete the whole journey to top the welcome leaderboard and earn first access when paid USDC bounties open up. No experience needed, no rush — this one runs all season.",
    heroGradient: "from-amber-900 via-orange-800 to-rose-800",
    heroImage: "/hero/coffee.jpg",
    accentColor: "#c2410c",
    icon: "\u{1F44B}",
    totalBudget: 0,
    rewardPerTask: 10,
    rewardKind: "points",
    taskCount: 10,
    categories: ["photo", "review", "check-in", "custom", "feedback", "social"],
    taskDescriptions: [
      "Photo your first drink of the day and tell us your city",
      "Show us the view from where you're standing right now",
      "Review the last meal you ate, photo + rating",
      "Photo something that could only be your city",
      "Do one small favour for someone, no reward, tell us how it felt",
      "Photo the price of a coffee or water where you are",
      "One photo of what made you smile today",
      "Show us where you're reading this from",
    ],
    location: "Worldwide",
    endsAt: "2026-12-31T23:59:59Z",
    featured: true,
  },
  {
    id: "say-it-out-loud",
    name: "Say It Out Loud",
    brand: "FAVOUR",
    tagline: "Post about FAVOUR in your own words. Clean posts unlock real USDC.",
    description:
      "The first FAVOUR campaign with a cash unlock. Post about FAVOUR on X in your own words — what you did, what you earned, what surprised you. Every clean, AI-verified post earns 10 points. Complete 3 clean posts as an Orb-verified human and $2 USDC unlocks straight to your wallet. First come, first unlocked — the pot is capped and when it's gone it's gone.",
    heroGradient: "from-sky-950 via-blue-900 to-indigo-900",
    heroImage: "/hero/friends.jpg",
    accentColor: "#1d4ed8",
    icon: "\u{1F4E3}",
    totalBudget: 10,
    rewardPerTask: 10,
    rewardKind: "points",
    taskCount: 3,
    categories: ["social"],
    taskDescriptions: [
      "Post about FAVOUR on X in your own words: what you did or earned",
      "Post the most surprising thing about FAVOUR so far",
      "Post what you'd tell a friend who's never used FAVOUR",
    ],
    location: "Worldwide",
    endsAt: "2026-08-31T23:59:59Z",
    featured: false,
    unlock: {
      pot: 10,
      unlockThreshold: 3,
      unlockAmount: 2,
      requiresOrb: true,
      maxCountedPerUser: 3,
    },
  },
  {
    id: "relay-launch",
    name: "RELAY Launch Campaign",
    brand: "RELAY",
    tagline: "Help us build the world's first AI-verified task network",
    description:
      "Complete real-world tasks across Paris and beyond. Every task is verified by 3 AI models and paid in USDC. Early contributors build reputation that unlocks higher-value tasks later.",
    heroGradient: "from-gray-900 via-gray-800 to-gray-700",
    heroImage: "/hero/friends.jpg",
    accentColor: "#191C20",
    icon: "\u{1F680}",
    totalBudget: 50,
    rewardPerTask: 1,
    rewardKind: "usdc",
    taskCount: 20,
    categories: ["photo", "review", "check-in", "social", "errand"],
    taskDescriptions: [
      "Film a 30-second video review",
      "Take a photo at this location",
      "Write an honest review",
      "Post about your experience on X",
      "Check if this place is open",
      "Scout the vibe at a local spot",
    ],
    location: "Paris, France",
    endsAt: "2026-07-31T23:59:59Z",
    featured: false,
  },
  {
    id: "world-cup-2026",
    name: "World Cup 2026",
    brand: "RELAY",
    tagline: "Bring the tournament to life, favour by favour",
    description:
      "It's World Cup season. Show your matchday: watch parties, fan spots, score predictions, and hot takes. Most favours earn points, with a few USDC prize favours in the mix. Verified humans only, so the leaderboard is real.",
    heroGradient: "from-emerald-900 via-green-800 to-teal-700",
    heroImage: "/hero/world-cup.jpg",
    accentColor: "#065f46",
    icon: "\u{26BD}",
    totalBudget: 25,
    rewardPerTask: 1,
    rewardKind: "usdc",
    taskCount: 12,
    categories: ["photo", "social", "review", "feedback"],
    taskDescriptions: [
      "Photo your watch party setup",
      "Predict tonight's score",
      "Best fan spot to watch near you",
      "Your hot take on today's match",
      "Show your team colours",
    ],
    location: "Worldwide",
    endsAt: "2026-07-19T23:59:59Z",
    featured: false,
  },
  {
    id: "ground-truth-2026",
    name: "FAVOUR Ground Truth",
    brand: "FAVOUR",
    tagline: "AI can't see the real world. You can.",
    description:
      "The big one. AI agents are flying blind on the physical world — real prices, real queues, real hours, real conditions no API has. Capture verified ground truth across your city and rack up points. Every task is checked by 3 AI models; AI-generated or fake proof earns nothing. Grind clean tasks, climb the board, and Orb-verified humans unlock a share of the pot. This is how AI finally gets eyes on the ground.",
    heroGradient: "from-indigo-950 via-blue-900 to-slate-800",
    heroImage: "/hero/cyclist.jpg",
    accentColor: "#1e3a8a",
    icon: "\u{1F30D}",
    totalBudget: 500,
    rewardPerTask: 1,
    rewardKind: "points",
    taskCount: 30,
    categories: ["photo", "check-in", "review", "errand", "social", "feedback"],
    taskDescriptions: [
      "Photo a cafe's menu board with today's prices visible",
      "Check if this shop is open right now and photo the hours sign",
      "How long is the queue here? Photo it with a rough wait time",
      "Photo the price of milk/eggs/bread on the shelf at a local store",
      "Scout the vibe at a local spot and write an honest 2-line review",
      "Photo public transport departure board with live times",
      "Is this ATM working? Photo the screen",
      "Photo street parking availability on this block right now",
      "Photo a restaurant's posted opening hours",
      "Show the current weather/conditions at a named landmark",
    ],
    location: "Worldwide",
    endsAt: "2026-08-31T23:59:59Z",
    featured: false,
  },
  {
    id: "ask-for-it",
    name: "Ask For It",
    brand: "FAVOUR",
    tagline: "Everyone offers help. Nobody asks. Post the favour you actually need.",
    description:
      "FAVOUR works both ways. This month is the asking side: post a favour you genuinely need done, fund it with a dollar if it matters, and watch a verified human handle it. Most favours here earn points, with a couple of USDC favours in the mix. The best asks become the templates everyone else uses.",
    heroGradient: "from-stone-900 via-stone-800 to-amber-900",
    heroImage: "/hero/couple.jpg",
    accentColor: "#b45309",
    icon: "\u{1F64B}",
    totalBudget: 10,
    rewardPerTask: 1,
    rewardKind: "points",
    taskCount: 6,
    categories: ["social", "custom", "feedback"],
    taskDescriptions: [
      "Post your own favour on the board, something you actually need",
      "Ask someone near you for a small favour in person, report back",
      "Describe a favour you'd pay $5 to get done this week",
      "What would you ask a verified human that you'd never ask a stranger?",
    ],
    location: "Worldwide",
    endsAt: "2026-07-31T23:59:59Z",
    featured: false,
  },
];

export function getCampaign(id: string): Campaign | null {
  return CAMPAIGNS.find((c) => c.id === id) || null;
}

export function getFeaturedCampaign(): Campaign | null {
  return CAMPAIGNS.find((c) => c.featured) || null;
}

export function getCampaigns(): Campaign[] {
  return CAMPAIGNS;
}
