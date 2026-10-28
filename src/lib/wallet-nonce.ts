// Ask the server for a browser-bound, single-use challenge before opening World App sign-in.
export async function walletNonce(): Promise<string> {
  const res = await fetch("/api/nonce", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || typeof data.nonce !== "string") throw new Error(data.error || "Sign-in could not start. Please try again.");
  return data.nonce;
}
