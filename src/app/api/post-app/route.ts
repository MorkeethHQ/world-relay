import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateDraftInput, saveDraft, listDrafts } from "@/lib/campaign-drafts";
import { getRedis } from "@/lib/redis";
import { fetchProduct } from "@/lib/product-fetch";
import { postBody, postReason, pictureRecord, pictureOf } from "@/lib/post-app";
import { savePictureRecord } from "@/lib/campaign-pictures";
import { markPending } from "@/lib/posted-apps";
import { YES_GATE } from "@/lib/yes-gate";

// POST /api/post-app { productUrl, productName, ask, makerImage? } -> the maker's
// app is saved as a campaign draft and is PENDING (lib/posted-apps.ts). It is
// published only when 10 distinct outside wallets say YES (lib/yes-gate.ts).
//
// Session only, World wallet only. The owner comes from the session. The page is
// read AGAIN here, by the server, so the picture, icon and colour on record are
// what the product's own page declares and not what a caller typed. Only the
// maker's own picture link comes from the body, and it is recorded as the
// maker's. No picture, no post. Nothing here funds anything: the body carries no
// pool, and publishing later goes through publishDraft, which cannot.

export const POST_DAY_PREFIX = "app:post-day:";

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
  if (reason) {
    // Say why there is no picture when the page could not be read this time.
    const why = read.ok ? reason : `FAVOUR could not read your page just now (${read.reason}) Add a link to a picture, or try again.`;
    return NextResponse.json({ error: why, code: "picture_required" }, { status: 400 });
  }

  // A RETRY RESUMES. A draft this wallet already saved for the same link, and
  // never published, is used again, so a failed post never piles drafts up.
  const mine = await listDrafts(owner);
  const waiting = mine.find((d) => d.status === "draft" && d.productUrl === checked.draft.productUrl);

  // One post a day per wallet. Checked BEFORE a new draft is saved. The draft
  // that already holds today's slot may finish.
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Apps cannot be posted right now. Try again later." }, { status: 503 });
  const dayKey = `${POST_DAY_PREFIX}${owner.toLowerCase()}:${new Date(now).toISOString().slice(0, 10)}`;
  const oneADay = NextResponse.json({ error: "You can post one app a day. Come back tomorrow.", code: "one_a_day" }, { status: 429 });
  const holder = await redis.get(dayKey).catch(() => null);
  if (holder && holder !== waiting?.id) return oneADay;

  let draftId = waiting?.id;
  if (!draftId) {
    const saved = await saveDraft(owner, checked.draft, now, () => crypto.randomUUID());
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    draftId = saved.draft.id;
  }
  if (!holder && (await redis.set(dayKey, draftId, { nx: true, ex: 2 * 86400 })) !== "OK") return oneADay;
  if (!(await savePictureRecord(draftId, record))) {
    return NextResponse.json({ error: "Your app is saved, but its picture could not be saved. Tap Post again." }, { status: 503 });
  }
  if (!(await markPending(draftId))) {
    return NextResponse.json({ error: "Your app is saved, but it could not be listed. Tap Post again." }, { status: 503 });
  }
  return NextResponse.json({ app: { id: draftId, status: "pending", yes: 0, of: YES_GATE } }, { status: 201 });
}
