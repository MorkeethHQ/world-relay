// WHERE A CAMPAIGN'S PICTURE RECORD IS KEPT. One key per campaign, written once
// by the post-your-app route for a draft the caller owns, and read by anyone:
// a published campaign's picture is public. See post-app.ts for the shape.

import { getRedis } from "@/lib/redis";
import { pictureRecordOrNull, type PictureRecord } from "@/lib/post-app";

export const PICTURE_PREFIX = "campaign:picture:";

export async function savePictureRecord(campaignId: string, record: PictureRecord): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.set(`${PICTURE_PREFIX}${campaignId}`, JSON.stringify(record));
    return true;
  } catch {
    return false; // the caller says so and does not publish
  }
}

export async function getPictureRecord(campaignId: string): Promise<PictureRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  return pictureRecordOrNull(await redis.get(`${PICTURE_PREFIX}${campaignId}`).catch(() => null));
}
