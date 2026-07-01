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
