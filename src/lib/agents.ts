import type { AgentInfo, TaskCategory } from "./types";

export const AGENT_REGISTRY: Record<string, AgentInfo> = {
  shelfwatch: {
    id: "shelfwatch",
    name: "ShelfWatch",
    icon: "🏷️",
    color: "#f59e0b",
    verificationPrompt: "Focus on price tags being visible and legible. Check that prices/menus are clearly readable, not blurry. Verify currency and date context. Reject if prices are cut off, too small to read, or if the photo only shows part of a shelf/menu.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask what is actually on the shelves near you. It is not a company, and nobody pays it for your answers.",
  },
  freshmap: {
    id: "freshmap",
    name: "FreshMap",
    icon: "🗺️",
    color: "#3b82f6",
    verificationPrompt: "Look for freshness indicators — is this a current photo? Check for 'à louer' signs, open/closed status, recent renovations. Verify storefront conditions match current reality. Flag if the photo appears outdated or if timestamps contradict the submission time.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask about places near you, the tips no map has. It is not a company, and nobody pays it for your answers.",
  },
  queuepulse: {
    id: "queuepulse",
    name: "QueuePulse",
    icon: "⏱️",
    color: "#8b5cf6",
    verificationPrompt: "Estimate queue length from the photo. Count visible people in line. Assess wait time. Check the photo captures the full queue, not just a portion. Flag if the queue is cropped or if there is no clear line formation visible.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask how long the wait is where you are. It is not a company, and nobody pays it for your answers.",
  },
  propertycheck: {
    id: "propertycheck",
    name: "PropertyCheck",
    icon: "🏠",
    color: "#06b6d4",
    verificationPrompt: "Focus on building exterior, entrance condition, and street context. Compare visible address to task description. Check for accessibility, building state, and neighborhood accuracy. Flag if the address does not match or if key details are missing.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask what the buildings and streets around you are really like. It is not a company, and nobody pays it for your answers.",
  },
  dropscout: {
    id: "dropscout",
    name: "DropScout",
    icon: "🔥",
    color: "#f97316",
    verificationPrompt: "Focus on event/pop-up identification — brand signage, storefront setup, crowd presence. Verify the location matches the described event. Check for QR codes, promotional materials, or brand indicators. Flag if the scene doesn't match an active event or pop-up.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask what is on right now near you, the pop-ups and small events. It is not a company, and nobody pays it for your answers.",
  },
  openclaw: {
    id: "openclaw",
    name: "OpenClaw",
    icon: "🦞",
    color: "#ef4444",
    verificationPrompt: "Verify that the human response addresses the specific limitation the AI agent described. Check for genuine first-hand observation — not something that could be googled. Flag vague or copy-pasted responses.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask the things only a body in a place can answer, like what today smells like. It is not an outside agent, and nobody pays it for your answers.",
  },
  hermes: {
    id: "hermes",
    name: "Hermes",
    icon: "📨",
    color: "#8b5cf6",
    verificationPrompt: "Verify that the human completed the communication task as described. Check for evidence of the interaction — screenshots, confirmation messages, or detailed accounts. Flag if the response is too vague to confirm action was taken.",
    personality: "A FAVOUR agent: a persona FAVOUR uses for quick questions about your day. It is not an outside agent, and nobody pays it for your answers.",
  },
  claudecode: {
    id: "claudecode",
    name: "Claude Code",
    icon: "🤖",
    color: "#1a1a1a",
    verificationPrompt: "Verify that the human tested the specific thing the AI could not. Look for real screenshots, specific observations, or measured results. Flag responses that could be fabricated without actual testing.",
    personality: "A FAVOUR agent: a persona FAVOUR uses to ask how real people actually use things. It is not Anthropic's Claude Code and not an outside agent, and nobody pays it for your answers.",
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
