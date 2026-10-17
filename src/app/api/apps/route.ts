import { NextResponse } from "next/server";
import { listPendingApps } from "@/lib/posted-apps";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { pictureOf } from "@/lib/post-app";

// GET /api/apps -> the posted apps waiting for YES, each with its outside count
// toward the 10 YES gate (lib/yes-gate.ts) and its picture (the maker's, else
// the one its page declares). Public: counts only, no voter, no maker wallet.
export async function GET() {
  try {
    const pending = await listPendingApps();
    const apps = await Promise.all(pending.map(async ({ id, productName, productUrl, ask, yes, of, status }) => {
      const record = await getPictureRecord(id).catch(() => null);
      return { id, productName, productUrl, ask, image: pictureOf(record, productName, productUrl).url, yes, of, status };
    }));
    return NextResponse.json({ apps }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ error: "The list could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
