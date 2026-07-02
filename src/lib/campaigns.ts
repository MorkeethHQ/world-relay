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
};

export const CAMPAIGNS: Campaign[] = [
  {
    id: "relay-launch",
    name: "RELAY Launch Campaign",
    brand: "RELAY",
    tagline: "Help us build the world's first AI-verified task network",
    description:
      "Complete real-world tasks across Paris and beyond. Every task is verified by 3 AI models and paid in USDC instantly. Early contributors build reputation that unlocks higher-value tasks later.",
    heroGradient: "from-gray-900 via-gray-800 to-gray-700",
    heroImage: "/hero/friends.jpg",
    accentColor: "#191C20",
    icon: "\u{1F680}",
    totalBudget: 50,
    rewardPerTask: 1,
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
    featured: true,
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
