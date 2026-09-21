import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateDraftInput, saveDraft, listDrafts } from "@/lib/campaign-drafts";

// Company campaign DRAFTS (FAVOUR-COMPANY-JOURNEY-2026-09-21). See
// lib/campaign-drafts.ts for what a draft is and what it can never do.
//
// Session only. The owner is the session's wallet and is never read from the body,
// and a draft is readable only by its owner: it is a company's unpublished
// proposal, so there is nothing public to list.

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { ok } = await rateLimit(`draft:${ip}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const owner = getAuthedAddress(req, Date.now());
  if (!owner) {
    return NextResponse.json({ error: "Sign in to save a campaign draft.", code: "reauth_required" }, { status: 403 });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to launch a campaign.", code: "wallet_required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const checked = validateDraftInput(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const saved = await saveDraft(owner, checked.draft, Date.now(), () => crypto.randomUUID());
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
  return NextResponse.json({ draft: saved.draft }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const owner = getAuthedAddress(req, Date.now());
  if (!owner) {
    return NextResponse.json({ authenticated: false, drafts: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json(
    { authenticated: true, drafts: await listDrafts(owner) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
