import { getRedis } from "./redis";
import { CAMPAIGNS, getCampaign, type Campaign } from "./campaigns";

const CAMPAIGN_PREFIX = "campaign:";
const CAMPAIGN_IDS = "campaign_ids";

export type RequesterCampaign = Campaign & {
  owner: string;
  createdAt: string;
  rewardKind: "points";
  cadence: {
    completionsPerCycle: number;
    intervalHours: number;
    totalCycles: number;
  };
};

export async function persistRequesterCampaign(campaign: RequesterCampaign): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error("Campaign storage is unavailable");
  await Promise.all([
    redis.set(`${CAMPAIGN_PREFIX}${campaign.id}`, JSON.stringify(campaign), { nx: true }),
    redis.sadd(CAMPAIGN_IDS, campaign.id),
  ]);
}

export async function getRequesterCampaign(id: string): Promise<RequesterCampaign | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${CAMPAIGN_PREFIX}${id}`);
  if (!raw) return null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as RequesterCampaign;
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  return getCampaign(id) ?? getRequesterCampaign(id);
}

export async function listRequesterCampaigns(): Promise<RequesterCampaign[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = await redis.smembers(CAMPAIGN_IDS);
  const campaigns = await Promise.all(ids.map((id) => getRequesterCampaign(String(id))));
  return campaigns
    .filter((campaign): campaign is RequesterCampaign => campaign !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllCampaigns(): Promise<Campaign[]> {
  return [...(await listRequesterCampaigns()), ...CAMPAIGNS];
}

export const REQUESTER_CAMPAIGN_POLICY = {
  rewardKind: "points" as const,
  minPoints: 1,
  maxPoints: 10,
  minCompletionsPerCycle: 2,
  maxCompletionsPerCycle: 25,
  minIntervalHours: 24,
  maxIntervalHours: 24 * 30,
  minCycles: 2,
  maxCycles: 12,
  maxActivePerOwner: 3,
  maxTotalPoints: 600,
};

export function validateRequesterCampaignPolicy(input: {
  rewardPoints: number;
  completionsPerCycle: number;
  intervalHours: number;
  totalCycles: number;
}): string | null {
  const p = REQUESTER_CAMPAIGN_POLICY;
  if (!Number.isInteger(input.rewardPoints) || input.rewardPoints < p.minPoints || input.rewardPoints > p.maxPoints) {
    return `Reward must be ${p.minPoints}-${p.maxPoints} points.`;
  }
  if (!Number.isInteger(input.completionsPerCycle) || input.completionsPerCycle < p.minCompletionsPerCycle || input.completionsPerCycle > p.maxCompletionsPerCycle) {
    return `Each cycle needs ${p.minCompletionsPerCycle}-${p.maxCompletionsPerCycle} completions.`;
  }
  if (!Number.isInteger(input.intervalHours) || input.intervalHours < p.minIntervalHours || input.intervalHours > p.maxIntervalHours) {
    return `Frequency must be ${p.minIntervalHours}-${p.maxIntervalHours} hours.`;
  }
  if (!Number.isInteger(input.totalCycles) || input.totalCycles < p.minCycles || input.totalCycles > p.maxCycles) {
    return `Campaigns must run for ${p.minCycles}-${p.maxCycles} cycles.`;
  }
  if (input.rewardPoints * input.completionsPerCycle * input.totalCycles > p.maxTotalPoints) {
    return `A campaign may commit at most ${p.maxTotalPoints} points.`;
  }
  return null;
}

export async function ownerMayCreateCampaign(owner: string, nowMs = Date.now()): Promise<boolean> {
  const campaigns = await listRequesterCampaigns();
  const active = campaigns.filter((campaign) =>
    campaign.owner.toLowerCase() === owner.toLowerCase() && new Date(campaign.endsAt).getTime() > nowMs
  );
  return active.length < REQUESTER_CAMPAIGN_POLICY.maxActivePerOwner;
}
