import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { getCompanyAppeal } from "@/lib/company-appeal";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const wallet = getAuthedAddress(req, Date.now());
  if (!wallet) return new NextResponse("Sign in", { status: 403 });
  const { id, evidenceId } = await params;
  const review = await getCompanyAppeal(evidenceId);
  if (!review || review.owner !== wallet || review.campaignId !== id || review.outcome === "pending") return new NextResponse("Not found", { status: 404 });
  const index = Number(new URL(req.url).searchParams.get("index") ?? "0");
  const src = Number.isInteger(index) && index >= 0 ? review.images[index] : null;
  const match = src?.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return new NextResponse("No retained inline photo", { status: 404 });
  return new NextResponse(new Uint8Array(Buffer.from(match[2], "base64")), { headers: { "Content-Type": match[1], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
