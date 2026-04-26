import type { AgentInfo, TaskCategory } from "./types";

export const AGENT_REGISTRY: Record<string, AgentInfo> = {
  shelfwatch: {
    id: "shelfwatch",
    name: "ShelfWatch",
    icon: "🏷️",
    color: "#f59e0b",
    verificationPrompt: "Focus on price tags being visible and legible. Check that prices/menus are clearly readable, not blurry. Verify currency and date context. Reject if prices are cut off, too small to read, or if the photo only shows part of a shelf/menu.",
    personality: "Retail intelligence at scale. Brands pay for real shelf data — prices, stock levels, display conditions. Thousands of checks per city, per month.",
  },
  freshmap: {
    id: "freshmap",
    name: "FreshMap",
    icon: "🗺️",
    color: "#3b82f6",
    verificationPrompt: "Look for freshness indicators — is this a current photo? Check for 'à louer' signs, open/closed status, recent renovations. Verify storefront conditions match current reality. Flag if the photo appears outdated or if timestamps contradict the submission time.",
    personality: "Local business intelligence. Is this place still open? Is the menu accurate? FreshMap keeps local data fresh with real human visits. Google Maps ground truth.",
  },
  queuepulse: {
    id: "queuepulse",
    name: "QueuePulse",
    icon: "⏱️",
    color: "#8b5cf6",
    verificationPrompt: "Estimate queue length from the photo. Count visible people in line. Assess wait time. Check the photo captures the full queue, not just a portion. Flag if the queue is cropped or if there is no clear line formation visible.",
    personality: "Real-time wait time intelligence. Logistics and booking platforms need live ground truth. QueuePulse tracks actual wait times — data no API provides.",
  },
  propertycheck: {
    id: "propertycheck",
    name: "PropertyCheck",
    icon: "🏠",
    color: "#06b6d4",
    verificationPrompt: "Focus on building exterior, entrance condition, and street context. Compare visible address to task description. Check for accessibility, building state, and neighborhood accuracy. Flag if the address does not match or if key details are missing.",
    personality: "Listing verification at scale. Rental platforms need verified listings. PropertyCheck sends humans to confirm the building, the view, the neighborhood — what photos don't show.",
  },
  dropscout: {
    id: "dropscout",
    name: "DropScout",
    icon: "🔥",
    color: "#f97316",
    verificationPrompt: "Focus on event/pop-up identification — brand signage, storefront setup, crowd presence. Verify the location matches the described event. Check for QR codes, promotional materials, or brand indicators. Flag if the scene doesn't match an active event or pop-up.",
    personality: "Ground intel for brands and platforms. Limited drops, pop-ups, local events — DropScout gets eyes on the scene before anyone else.",
  },
};


export function getAgent(agentId: string): AgentInfo | null {
  return AGENT_REGISTRY[agentId.toLowerCase()] || null;
}

export const TASK_TEMPLATES = [
  {
    label: "Shelf price check",
    icon: "🏷️",
    category: "photo" as TaskCategory,
    description: "Photo the shelf price and stock level for ",
    bounty: 3.00,
  },
  {
    label: "Stock check",
    icon: "📦",
    category: "check-in" as TaskCategory,
    description: "Check if this item is in stock at ",
    bounty: 4.00,
  },
  {
    label: "Wait time check",
    icon: "⏱️",
    category: "photo" as TaskCategory,
    description: "Photo the current queue and estimate wait time at ",
    bounty: 3.00,
  },
  {
    label: "Verify a listing",
    icon: "🏠",
    category: "photo" as TaskCategory,
    description: "Walk past and photograph the building entrance at ",
    bounty: 5.00,
  },
  {
    label: "Local review",
    icon: "🗺️",
    category: "check-in" as TaskCategory,
    description: "Visit and post an honest review of ",
    bounty: 5.00,
  },
  {
    label: "Scout a pop-up",
    icon: "🔥",
    category: "photo" as TaskCategory,
    description: "Check out and photograph the pop-up at ",
    bounty: 4.00,
  },
  {
    label: "Menu / price board",
    icon: "📋",
    category: "photo" as TaskCategory,
    description: "Photograph the full menu or price board at ",
    bounty: 3.00,
  },
  {
    label: "View verification",
    icon: "🪟",
    category: "photo" as TaskCategory,
    description: "Verify the actual view from this address: ",
    bounty: 7.00,
  },
];
