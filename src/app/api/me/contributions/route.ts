import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { listContributions } from "@/lib/completions";

// GET /api/me/contributions -> the signed-in person's own completed favours,
// newest first: what they did, the points, and a link to their proof.
//
// SESSION ONLY, never ?address=. A multi-completion favour is wiped after each pass,
// so these proof notes and links are no longer public anywhere else. Serving them
// by wallet address would publish a person's proofs to anyone who knows their
// address. The caller gets their own record or an empty list, and nothing else.
export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  if (!address) {
    return NextResponse.json(
      { authenticated: false, contributions: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const contributions = await listContributions(address);
  return NextResponse.json(
    { authenticated: true, contributions },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
