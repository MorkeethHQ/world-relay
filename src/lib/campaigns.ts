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
    // Oscar 2026-08-08: the comeback. The board went quiet because the pot was
    // empty ($2.06 on-chain), not because the rails broke — campaign-unlock.ts
    // has never been custody-gated. Refunded to $42.06 (tx 0x10e044e5…fba19e),
    // $40 of it committed here. Task 4 is the point of the campaign: it buys a
    // roadmap from the people who actually use this. It pays POINTS, not cash —
    // verification is a 3-model check that a PHOTO matches the task, and a text
    // feature request has no photo to check. Paying cash for unverifiable text
    // is how you fund spam (Oscar's ruling, option A).
    id: "comeback-2026",
    name: "Welcome Back",
    brand: "FAVOUR",
    tagline: "The board is live again. Four small favours, real USDC.",
    description:
      "FAVOUR went quiet for a while. It's back, and the pot is funded. Four small favours — nothing that takes more than five minutes, nothing you need to leave your day for. Every clean, AI-verified proof earns points. ONE clean photo favour as an Orb-verified human unlocks $2 USDC straight to your wallet. The pot covers 20 humans and when it's gone it's gone. Tell us what to build next while you're here — that one's points, and we actually read them.",
    heroGradient: "from-slate-950 via-teal-900 to-emerald-800",
    accentColor: "#0d9488",
    icon: "\u{1F44B}",
    totalBudget: 40,
    rewardPerTask: 10,
    rewardKind: "points",
    taskCount: 4,
    categories: ["check-in", "feedback", "photo", "review"],
    taskDescriptions: [
      "Photograph wherever you are right now — street, desk, window, anything real",
      "Photograph one small good thing you did today",
      "Rate one local place honestly — the real verdict, not the polite one",
      "Tell us the one thing FAVOUR should build next (points only, and we read every one)",
    ],
    location: "Worldwide",
    endsAt: "2026-09-30T23:59:59Z",
    featured: true,
    unlock: {
      pot: 40,
      unlockThreshold: 1,
      unlockAmount: 2,
      requiresOrb: true,
      maxCountedPerUser: 1,
    },
  },
  {
    id: "legendary-favours",
    name: "Legendary Favours",
    brand: "FAVOUR",
    tagline: "Five favours. Real USDC. Proof or nothing.",
    description:
      "Five standout favours, each paying real USDC the moment the AI verifies your proof. No points here — this is money, settled on-chain to your wallet. Do one, photograph it honestly, get paid. First come, first paid: each favour pays once.",
    heroGradient: "from-gray-950 via-emerald-900 to-green-800",
    heroImage: "/hero/world-cup.jpg",
    accentColor: "#16a34a",
    icon: "\u{1F3C6}",
    totalBudget: 10,
    rewardPerTask: 2,
    rewardKind: "usdc",
    taskCount: 5,
    categories: ["photo", "review", "custom"],
    taskDescriptions: [
      "Water a public plant or street tree that needs it",
      "Photograph the best hidden view in your city",
      "Find where locals watch football, rate the atmosphere",
      "Pick up 5 pieces of litter on one street",
      "Leave a handwritten kind note for a stranger to find",
    ],
    location: "Worldwide",
    endsAt: "2026-07-20T23:59:59Z",
    featured: true,
  },
  {
    id: "first-favour",
    name: "Your First Favours",
    brand: "FAVOUR",
    tagline: "New here? Learn the ropes and climb the board.",
    description:
      "Welcome to FAVOUR. Get started with a series of small, real-world favours — a photo of your street, a quick honest review, a small kind act. Every one earns points, builds your reputation, and teaches you how FAVOUR works. Complete the whole journey to top the welcome leaderboard. No experience needed, no rush — this one runs all season.",
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
    tagline: "Post about FAVOUR in your own words. One clean post unlocks real USDC.",
    description:
      "The first FAVOUR campaign with a cash unlock. Post about FAVOUR on X in your own words — what you did, what you earned, what surprised you. Every clean, AI-verified post earns 10 points. ONE clean post as an Orb-verified human unlocks $2 USDC straight to your wallet. First come, first unlocked — the pot covers 5 humans and when it's gone it's gone.",
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
    // Oscar Jul 5 (ultimate review decision 2): one clean Orb post unlocks $2 —
    // non-zero marginal reward per post, same $10 budget, 5 unlocks total.
    unlock: {
      pot: 10,
      unlockThreshold: 1,
      unlockAmount: 2,
      requiresOrb: true,
      maxCountedPerUser: 1,
    },
  },
  {
    id: "relay-launch",
    // The NAME stays: this campaign ran as the RELAY launch and that is history.
    // The BRAND is a current claim — CampaignPage.tsx:358 renders it live as
    // "Post a favour for {brand}" — so it follows the Jul 2 rename. The id is
    // frozen: 7 prod tasks carry campaignId "relay-launch".
    name: "RELAY Launch Campaign",
    brand: "FAVOUR",
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
    brand: "FAVOUR",
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
