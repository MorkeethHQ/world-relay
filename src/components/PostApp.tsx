"use client";

import { useState } from "react";
import Link from "next/link";
import { MIN_BRIEF_WORDS } from "@/lib/campaign-draft-shape";
import { campaignPicture } from "@/lib/campaign-picture";
import { ASK_MAX, POST_POINTS, POST_REVIEWS, postReason } from "@/lib/post-app";
import { PAY_DEFAULT_USD, PAY_PRICES, PAY_SLOTS, PAY_SLOT_HOURS } from "@/lib/pay-plan";
import { ESCROW_V2_CONFIRM_GRACE_S } from "@/lib/escrow-v2";
import { askLine, progressLabel } from "@/lib/apps-view";
import { TenHumans } from "@/components/fv/TenHumans";
import { funkyArt } from "@/lib/funky-art";

// /post: A MAKER POSTS THEIR APP (pivot "Product Hunt for World", 17 Oct 2026).
// Step 1: paste the link; the server reads the page (api/post-app/read).
// Step 2: confirm the name, write the ask, add a picture link only if the page
// has none. Post. The app is then PENDING until ten outside wallets say YES
// (api/post-app, lib/posted-apps.ts). The rules shown here are the server's
// rules (postReason); the server checks them again.

export type PostState = {
  step: "link" | "details" | "done";
  url: string; name: string; line: string | null; pageImage: string | null;
  // The screenshots the page itself declares (product-fetch.ts). Shown, never guessed.
  screenshots: string[];
  makerImage: string; ask: string;
  // PAID REVIEWS (19 Oct 2026): off by default. On = a commitment of PAY_SLOTS
  // reviews at payUsd each; nothing moves at post (lib/pay-plan.ts says why).
  payOn: boolean; payUsd: number;
  busy: boolean; error: string | null;
  posted: { id: string; yes: number; of: number } | null;
};

export const EMPTY_POST: PostState = {
  step: "link", url: "", name: "", line: null, pageImage: null, screenshots: [], makerImage: "", ask: "",
  payOn: false, payUsd: PAY_DEFAULT_USD,
  busy: false, error: null, posted: null,
};

// 19 Oct 2026 revamp: the FV layer (globals.css .fv), 2 px rules, square corners.
const field = "fv-field";
const primary = "fv-btn fv-btn-ink";

export function PostAppForm({ state: s, onChange, onRead, onPost }: {
  state: PostState;
  onChange: (patch: Partial<PostState>) => void;
  onRead: () => void;
  onPost: () => void;
}) {
  const picture = campaignPicture({ productName: s.name, productUrl: s.url, makerImage: s.makerImage, shareImage: s.pageImage });
  const reason = s.step === "details" ? postReason({ productUrl: s.url, productName: s.name, ask: s.ask, makerImage: s.makerImage }, picture) : null;
  const payTotal = PAY_SLOTS * s.payUsd;
  const refundDays = Math.round((PAY_SLOT_HOURS * 3600 + ESCROW_V2_CONFIRM_GRACE_S) / 86400);

  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <div className="sticky top-0 z-10 fv-rule-b bg-white px-6 py-3 flex items-center gap-3">
        <Link href="/" aria-label="Back" className="min-h-[44px] min-w-[44px] -ml-3 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 className="fv-h">Post your app</h1>
      </div>

      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        {s.step === "done" && s.posted ? (
          <div className="fv-box p-5 flex flex-col gap-4">
            <p className="fv-label">Posted</p>
            <p className="fv-title">{s.name} is waiting for 10 YES</p>
            <TenHumans yes={s.posted.yes} of={s.posted.of} big />
            <p className="fv-body fv-num">{progressLabel(s.posted.yes, s.posted.of)}</p>
            <p className="fv-body">Ask people to open FAVOUR and try it. Your own YES does not count. When the row is solid, your favours open and feedback starts.</p>
            <Link href={`/project/${encodeURIComponent(s.posted.id)}`} className="fv-btn fv-btn-ink">See your project</Link>
            <Link href="/apps" className="fv-btn">See apps to check</Link>
          </div>
        ) : (
          <>
            {s.step === "link" && (
              <p className="fv-title">Get real humans to try what you vibe coded.</p>
            )}
            <label className="flex flex-col gap-2">
              <span className="fv-h">Link to your app</span>
              <input type="url" inputMode="url" placeholder="https://" value={s.url} className={field}
                onChange={(e) => onChange({ url: e.target.value, step: "link" })} />
            </label>

            {s.step === "link" && (
              <>
                <button type="button" className={primary} disabled={s.busy || !s.url.trim()} onClick={onRead}>{s.busy ? "Reading…" : "Read my page"}</button>
                <p className="fv-body text-[12px]">FAVOUR reads the name, the share picture and the screenshots your page declares. You confirm them next.</p>
                <section aria-label="What you get" className="fv-box flex flex-col">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={funkyArt(s.url.trim() || "Your app")} alt="" className="fv-pic" />
                  <div className="p-4 flex flex-col gap-2">
                    <p className="fv-h">Your app, as a card in the deck</p>
                    <TenHumans yes={3} of={10} />
                    <p className="fv-body text-[12px] fv-num">Ten verified humans say YES and it is live. Then every honest review earns them {POST_POINTS} points, or USDC you put in escrow. FAVOUR never holds the money.</p>
                  </div>
                </section>
              </>
            )}

            {s.step === "details" && (
              <>
                {picture.url && (
                  <figure className="fv-box">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={picture.url} alt="" className="fv-pic" />
                    <figcaption className="px-4 py-2 fv-body text-[12px]">{picture.credit}</figcaption>
                  </figure>
                )}
                {s.screenshots.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="fv-label">Screenshots from your page</span>
                    <div className="grid grid-cols-3 gap-2">
                      {s.screenshots.slice(0, 3).map((u) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={u} src={u} alt="" className="fv-shot" />
                      ))}
                    </div>
                  </div>
                )}
                <label className="flex flex-col gap-2">
                  <span className="fv-h">Name</span>
                  <input type="text" value={s.name} className={field} onChange={(e) => onChange({ name: e.target.value })} />
                  {s.line && <span className="fv-body text-[12px]">{s.line}</span>}
                </label>
                <label className="flex flex-col gap-2">
                  <span className="fv-h">What should people try, and tell you?</span>
                  <textarea rows={4} maxLength={ASK_MAX} value={s.ask} className={field}
                    placeholder="Open the app, do one real thing, and tell me the first step that was unclear."
                    onChange={(e) => onChange({ ask: e.target.value })} />
                  <span className="fv-body text-[12px] fv-num">{askLine(s.ask, MIN_BRIEF_WORDS)}</span>
                </label>
                {!s.pageImage && (
                  <label className="flex flex-col gap-2">
                    <span className="fv-h">Link to a picture</span>
                    <input type="url" inputMode="url" placeholder="https://" value={s.makerImage} className={field} onChange={(e) => onChange({ makerImage: e.target.value })} />
                    <span className="fv-body text-[12px]">Your page has no share picture. Every app needs one.</span>
                  </label>
                )}

                {/* THE DEPOSIT (Oscar, 13 Oct 2026: "deposit for favours and feedback or
                    just points"; 19 Oct: "post app for review needs cash ofc, we should
                    escrow it"). Points: ten reviews at ten points, paid by FAVOUR, free.
                    USDC: a commitment of ten paid reviews at the price picked. Nothing
                    moves at post. The builder funds each taken slot from their own wallet
                    into the escrow contract, and sees the sum, the count and the refund
                    date again before confirming in World App (fv/PaySlots.tsx). */}
                <section aria-label="What you put in" className="fv-box p-4 flex flex-col gap-3">
                  <p className="fv-label">What you put in</p>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="fv-body">{POST_REVIEWS} honest reviews</p>
                    <p className={`fv-h fv-num ${s.payOn ? "" : "fv-blue"}`}>{POST_REVIEWS * POST_POINTS} points</p>
                  </div>
                  <p className="fv-body text-[12px]">{POST_POINTS} points per accepted review, paid by FAVOUR. Free.</p>
                  <div className="flex items-center justify-between gap-3 fv-rule-t pt-3">
                    <p className="fv-body">Add {PAY_SLOTS} paid reviews in USDC</p>
                    <button type="button" role="switch" aria-checked={s.payOn} className="fv-chip" data-on={s.payOn} onClick={() => onChange({ payOn: !s.payOn })}>{s.payOn ? "On" : "Off"}</button>
                  </div>
                  {s.payOn && (
                    <>
                      <div className="flex gap-2" role="radiogroup" aria-label="USDC per review">
                        {PAY_PRICES.map((usd) => (
                          <button key={usd} type="button" role="radio" aria-checked={s.payUsd === usd} data-on={s.payUsd === usd} className="fv-chip flex-1 fv-num" onClick={() => onChange({ payUsd: usd })}>{usd} USDC</button>
                        ))}
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="fv-body fv-num">{PAY_SLOTS} reviews at {s.payUsd} USDC</p>
                        <p className="fv-h fv-num fv-blue">{payTotal} USDC</p>
                      </div>
                      <p className="fv-body text-[12px]">Nothing moves now. When a reviewer takes a slot, you fund that slot from your wallet into an escrow bound to them. You release it after you read the review. A review you do not approve refunds to you {refundDays} days after the reviewer takes the slot. You see the exact date before you confirm. FAVOUR never holds it.</p>
                    </>
                  )}
                </section>

                {reason && <p className="fv-body">{reason}</p>}
                <button type="button" className={primary} disabled={s.busy || !!reason} onClick={onPost}>{s.busy ? "Posting…" : "Post for 10 YES"}</button>
                <p className="fv-body text-[12px]">One app a day. Your app goes live when ten other people say YES.</p>
              </>
            )}
          </>
        )}
        {s.error && <p role="alert" className="fv-body">{s.error}</p>}
      </div>
    </div>
  );
}

async function send(path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, body: await r.json().catch(() => null) };
  } catch {
    return { ok: false, body: null };
  }
}

const signIn = (b: Record<string, unknown> | null, fallback: string) =>
  b?.code === "reauth_required" || b?.code === "wallet_required"
    ? `${b.error} Open FAVOUR in World App and sign in first.`
    : typeof b?.error === "string" ? b.error : fallback;

export function PostApp() {
  const [s, set] = useState<PostState>(EMPTY_POST);
  const patch = (p: Partial<PostState>) => set((cur) => ({ ...cur, ...p, error: "error" in p ? p.error ?? null : null }));

  const onRead = async () => {
    patch({ busy: true });
    const r = await send("/api/post-app/read", { url: s.url.trim() });
    const p = r.body?.proposal as { url?: string; name?: string | null; line?: string | null; image?: string | null; screenshots?: string[] } | undefined;
    if (!r.ok || !p) return patch({ busy: false, error: signIn(r.body, "FAVOUR could not read that page. Check the link and try again.") });
    patch({ busy: false, step: "details", url: p.url ?? s.url.trim(), name: p.name ?? "", line: p.line ?? null, pageImage: p.image ?? null, screenshots: Array.isArray(p.screenshots) ? p.screenshots.filter((u) => typeof u === "string" && u.startsWith("https://")).slice(0, 3) : [] });
  };

  const onPost = async () => {
    patch({ busy: true });
    const r = await send("/api/post-app", { productUrl: s.url, productName: s.name, ask: s.ask, makerImage: s.makerImage || undefined, pay: s.payOn ? { perReviewUsd: s.payUsd } : undefined });
    const app = r.body?.app as { id: string; yes: number; of: number } | undefined;
    if (!r.ok || !app) return patch({ busy: false, error: signIn(r.body, "Your app was not posted. Try again.") });
    patch({ busy: false, step: "done", posted: app });
  };

  return <PostAppForm state={s} onChange={patch} onRead={onRead} onPost={onPost} />;
}
