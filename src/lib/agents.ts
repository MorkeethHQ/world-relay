import type { AgentInfo, TaskCategory } from "./types";

export const AGENT_REGISTRY: Record<string, AgentInfo> = {
  pricehawk: {
    id: "pricehawk",
    name: "PriceHawk",
    icon: "🏷️",
    color: "#f59e0b",
  },
  freshmap: {
    id: "freshmap",
    name: "FreshMap",
    icon: "🗺️",
    color: "#3b82f6",
  },
  queuewatch: {
    id: "queuewatch",
    name: "QueueWatch",
    icon: "⏱️",
    color: "#8b5cf6",
  },
  accessmap: {
    id: "accessmap",
    name: "AccessMap",
    icon: "♿",
    color: "#06b6d4",
  },
  plugcheck: {
    id: "plugcheck",
    name: "PlugCheck",
    icon: "⚡",
    color: "#22c55e",
  },
  shelfsight: {
    id: "shelfsight",
    name: "ShelfSight",
    icon: "📊",
    color: "#ef4444",
  },
  greenaudit: {
    id: "greenaudit",
    name: "GreenAudit",
    icon: "🌿",
    color: "#10b981",
  },
  bikenet: {
    id: "bikenet",
    name: "BikeNet",
    icon: "🚲",
    color: "#ec4899",
  },
  claimseye: {
    id: "claimseye",
    name: "ClaimsEye",
    icon: "🏢",
    color: "#f97316",
  },
  listingtruth: {
    id: "listingtruth",
    name: "ListingTruth",
    icon: "🏠",
    color: "#a855f7",
  },
};

export function getAgent(agentId: string): AgentInfo | null {
  return AGENT_REGISTRY[agentId.toLowerCase()] || null;
}

export type SeedTask = {
  agentId: string;
  category: TaskCategory;
  description: string;
  location: string;
  lat: number;
  lng: number;
  bountyUsdc: number;
  deadlineHours: number;
  recurring?: { intervalHours: number; totalRuns: number } | null;
};

export const SEED_TASKS: SeedTask[] = [
  {
    agentId: "pricehawk",
    category: "photo",
    description: "Photograph the full menu board and prices at Café de Flore, 172 Boulevard Saint-Germain. Include daily specials if visible.",
    location: "Saint-Germain-des-Prés, Paris 6e",
    lat: 48.8540,
    lng: 2.3325,
    bountyUsdc: 0.50,
    deadlineHours: 24,
    recurring: { intervalHours: 24, totalRuns: 7 },
  },
  {
    agentId: "freshmap",
    category: "photo",
    description: "Walk Rue du Faubourg Saint-Honoré between numbers 20–40. Photo every storefront. Note which are open, closed, or under renovation.",
    location: "Faubourg Saint-Honoré, Paris 8e",
    lat: 48.8700,
    lng: 2.3150,
    bountyUsdc: 1,
    deadlineHours: 48,
  },
  {
    agentId: "queuewatch",
    category: "check-in",
    description: "Visit the Louvre Pyramid entrance at current time. Photo the queue from the back. Estimate number of people and wait time in minutes.",
    location: "Musée du Louvre, Paris 1er",
    lat: 48.8606,
    lng: 2.3376,
    bountyUsdc: 0.25,
    recurring: { intervalHours: 12, totalRuns: 14 },
    deadlineHours: 6,
  },
  {
    agentId: "accessmap",
    category: "check-in",
    description: "Survey wheelchair accessibility at Métro Châtelet–Les Halles. Photo: elevator status, ramp conditions, tactile paving, any out-of-order signs.",
    location: "Châtelet–Les Halles, Paris 1er",
    lat: 48.8621,
    lng: 2.3467,
    bountyUsdc: 1,
    deadlineHours: 48,
  },
  {
    agentId: "plugcheck",
    category: "photo",
    description: "Visit EV charging station on Avenue des Champs-Élysées (near #45). Photo the status screen, connector condition, and number of working ports.",
    location: "Champs-Élysées, Paris 8e",
    lat: 48.8698,
    lng: 2.3076,
    bountyUsdc: 0.75,
    deadlineHours: 24,
  },
  {
    agentId: "shelfsight",
    category: "photo",
    description: "Photo the plant-based milk aisle at Monoprix Opéra (full shelf, price tags visible). Note any empty slots or out-of-stock items.",
    location: "Monoprix Opéra, Paris 9e",
    lat: 48.8719,
    lng: 2.3316,
    bountyUsdc: 0.50,
    deadlineHours: 24,
  },
  {
    agentId: "greenaudit",
    category: "check-in",
    description: "Visit Jardin du Luxembourg main entrance. Photo: 3 bench conditions, nearest trash bin fill level, and water fountain (working or dry?).",
    location: "Jardin du Luxembourg, Paris 6e",
    lat: 48.8462,
    lng: 2.3372,
    bountyUsdc: 0.50,
    deadlineHours: 48,
  },
  {
    agentId: "bikenet",
    category: "photo",
    description: "Check 3 Vélib stations between Bastille and Nation. At each: photo the dock, count available bikes, note any with visible damage (flat tire, missing seat).",
    location: "Bastille → Nation, Paris 11e/12e",
    lat: 48.8533,
    lng: 2.3692,
    bountyUsdc: 1,
    deadlineHours: 24,
  },
  {
    agentId: "pricehawk",
    category: "photo",
    description: "Photo the lunch menu and prices at 3 restaurants near Place de la République. Include any plat du jour or formule pricing.",
    location: "Place de la République, Paris 10e",
    lat: 48.8675,
    lng: 2.3637,
    bountyUsdc: 0.75,
    deadlineHours: 12,
  },
  {
    agentId: "claimseye",
    category: "photo",
    description: "Photograph exterior condition of building at 22 Rue de Rivoli. Capture: full facade, any visible damage to windows/walls, and street context. Do not enter.",
    location: "Rue de Rivoli, Paris 4e",
    lat: 48.8558,
    lng: 2.3580,
    bountyUsdc: 1.50,
    deadlineHours: 48,
  },
  {
    agentId: "listingtruth",
    category: "photo",
    description: "Visit the building at 8 Rue de Bretagne. Photo the exterior, entrance hallway, and surrounding street. Does it match a typical short-stay rental listing?",
    location: "Rue de Bretagne, Paris 3e",
    lat: 48.8638,
    lng: 2.3622,
    bountyUsdc: 1,
    deadlineHours: 48,
  },
  {
    agentId: "freshmap",
    category: "photo",
    description: "Walk Canal Saint-Martin from Rue de Lancry to Rue des Récollets. Photo every storefront — note new openings, 'à louer' signs, and any closures.",
    location: "Canal Saint-Martin, Paris 10e",
    lat: 48.8710,
    lng: 2.3645,
    bountyUsdc: 1.50,
    deadlineHours: 48,
  },
];

export const TASK_TEMPLATES = [
  {
    label: "Is there a line?",
    icon: "⏱️",
    category: "check-in" as TaskCategory,
    description: "How long is the queue at ",
    bounty: 0.25,
  },
  {
    label: "Menu & prices",
    icon: "🏷️",
    category: "photo" as TaskCategory,
    description: "Photo the menu board and today's prices at ",
    bounty: 0.50,
  },
  {
    label: "Verify listing",
    icon: "🏠",
    category: "photo" as TaskCategory,
    description: "Visit and photo the building exterior at ",
    bounty: 1,
  },
  {
    label: "Parking full?",
    icon: "🅿️",
    category: "check-in" as TaskCategory,
    description: "Is the parking lot full at ",
    bounty: 0.10,
  },
  {
    label: "Still open?",
    icon: "🔍",
    category: "check-in" as TaskCategory,
    description: "Is this place currently open? Photo the entrance of ",
    bounty: 0.10,
  },
  {
    label: "Street survey",
    icon: "🗺️",
    category: "photo" as TaskCategory,
    description: "Photo every storefront on ",
    bounty: 1.50,
  },
  {
    label: "Shelf audit",
    icon: "📊",
    category: "photo" as TaskCategory,
    description: "Photo the shelf and prices for ",
    bounty: 0.75,
  },
  {
    label: "Bike check",
    icon: "🚲",
    category: "photo" as TaskCategory,
    description: "Check bike dock availability and condition at ",
    bounty: 0.50,
  },
  {
    label: "EV charger",
    icon: "⚡",
    category: "photo" as TaskCategory,
    description: "Photo the EV charger status at ",
    bounty: 0.50,
  },
  {
    label: "Accessibility",
    icon: "♿",
    category: "check-in" as TaskCategory,
    description: "Check wheelchair accessibility at ",
    bounty: 0.75,
  },
];
