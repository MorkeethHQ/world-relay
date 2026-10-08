import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateDraftInput, saveDraft, publishDraft } from "@/lib/campaign-drafts";
import { createTask } from "@/lib/store";
import { fetchProduct } from "@/lib/product-fetch";
import { postBody, postReason, pictureRecord, pictureOf } from "@/lib/post-app";
import { savePictureRecord } from "@/lib/campaign-pictures";

// POST /api/post-app { productUrl, productName, ask, makerImage? } -> the maker's
// app is on FAVOUR as a POINTS campaign that asks for reviews. One request, so a
// campaign is never saved without its picture record.
//
// Session only, World wallet only. The owner comes from the session. The page is
// read AGAIN here, by the server, so the picture, icon and colour on record are
// what the product's own page declares and not what a caller typed. Only the
// maker's own picture link comes from the body, and it is recorded as the
// maker's. No picture, no launch. Nothing here funds anything: publishDraft
// cannot, and the body carries no pool.
export async function POST(req: NextRequest) {
  const owner = getAuthedAddress(req, Date.now());
  if (!owner) return NextResponse.json({ error: "Sign in to post your app.", code: "reauth_required" }, { status: 403 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return NextResponse.json({ error: "Open FAVOUR in World App to post your app.", code: "wallet_required" }, { status: 403 });
  }
  const byWallet = await rateLimit(`post-app:${owner}`, 5, 60_000);
  const byIp = await rateLimit(`post-app-ip:${getClientIp(req)}`, 10, 60_000);
  if (!byWallet.ok || !byIp.ok) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const raw = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const input = { productUrl: raw.productUrl, productName: raw.productName, ask: raw.ask, makerImage: raw.makerImage };
  const body = postBody(input);
  const checked = validateDraftInput(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const now = Date.now();
  const read = await fetchProduct(checked.draft.productUrl);
  const record = pictureRecord(read.ok ? read.proposal : null, input.makerImage, now);
  const reason = postReason(input, pictureOf(record, checked.draft.productName!, checked.draft.productUrl!));
  if (reason) return NextResponse.json({ error: reason, code: "picture_required" }, { status: 400 });

  const saved = await saveDraft(owner, checked.draft, now, () => crypto.randomUUID());
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
  if (!(await savePictureRecord(saved.draft.id, record))) {
    return NextResponse.json({ error: "Your app was saved as a draft, but its picture could not be saved. Try again.", draftId: saved.draft.id }, { status: 503 });
  }
  const out = await publishDraft(owner, saved.draft.id, Date.now(), (t) => createTask(t));
  // Saved but not published (for example one publish a day): say so, with the id.
  if (!out.ok) return NextResponse.json({ error: out.error, draftId: saved.draft.id }, { status: out.status });
  return NextResponse.json({ campaign: out.campaign }, { status: 201 });
}
