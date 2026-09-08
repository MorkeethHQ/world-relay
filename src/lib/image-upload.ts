import { put } from "@vercel/blob";

export async function uploadProofImage(
  base64Data: string,
  taskId: string,
  index: number
): Promise<string> {
  if (base64Data.startsWith("http://") || base64Data.startsWith("https://")) {
    return base64Data;
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return `data:image/jpeg;base64,${base64Data}`;
  }

  const clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(clean, "base64");

  try {
    const { url } = await put(
      `proofs/${taskId}/${index}.jpg`,
      buffer,
      {
        access: "public",
        contentType: "image/jpeg",
        token: blobToken,
      }
    );
    return url;
  } catch (err) {
    // A blob-storage failure (expired token, quota, network) must never crash
    // the proof submission: the AI verifies the raw base64 regardless of where
    // the image is persisted. Fall back to an inline data URL so the flow
    // continues and the proof still renders.
    console.error(`[ImageUpload] Blob upload failed for task ${taskId}, falling back to data URL:`, err);
    return `data:image/jpeg;base64,${clean}`;
  }
}

/** Requester media is uploaded under its own namespace, never presented as proof. */
export async function uploadCampaignImage(base64Data: string, campaignId: string): Promise<string> {
  const match = base64Data.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!match) throw new Error("Campaign media must be a JPEG, PNG or WebP upload");
  const contentType = `image/${match[1]}`;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 1_000_000) throw new Error("Campaign media must be 1 MB or smaller");

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return base64Data;
  const { url } = await put(`campaigns/${campaignId}/requester-media.${match[1]}`, buffer, {
    access: "public",
    contentType,
    token: blobToken,
  });
  return url;
}
