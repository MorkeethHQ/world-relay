import { put } from "@vercel/blob";

export async function uploadProofImage(
  base64Data: string,
  taskId: string,
  index: number
): Promise<string> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return `data:image/jpeg;base64,${base64Data}`;
  }

  const clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(clean, "base64");

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
}
