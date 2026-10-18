"use client";

import { useState } from "react";
import Link from "next/link";
import { MIN_BRIEF_WORDS } from "@/lib/campaign-draft-shape";
import { campaignPicture } from "@/lib/campaign-picture";
import { ASK_MAX, postReason } from "@/lib/post-app";
import { askLine, pipsFor, progressLabel } from "@/lib/apps-view";

// /post: A MAKER POSTS THEIR APP (pivot "Product Hunt for World", 17 Oct 2026).
// Step 1: paste the link; the server reads the page (api/post-app/read).
// Step 2: confirm the name, write the ask, add a picture link only if the page
// has none. Post. The app is then PENDING until ten outside wallets say YES
// (api/post-app, lib/posted-apps.ts). The rules shown here are the server's
// rules (postReason); the server checks them again.

export type PostState = {
  step: "link" | "details" | "done";
  url: string; name: string; line: string | null; pageImage: string | null;
  makerImage: string; ask: string;
  busy: boolean; error: string | null;
  posted: { id: string; yes: number; of: number } | null;
};

export const EMPTY_POST: PostState = {
  step: "link", url: "", name: "", line: null, pageImage: null, makerImage: "", ask: "",
  busy: false, error: null, posted: null,
};

const field = "w-full min-h-[48px] rounded-xl border border-gray-200 bg-white px-4 text-[15px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400";
const primary = "w-full min-h-[52px] rounded-xl bg-gray-900 text-[16px] font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-transform";

export function PostAppForm({ state: s, onChange, onRead, onPost }: {
  state: PostState;
  onChange: (patch: Partial<PostState>) => void;
  onRead: () => void;
  onPost: () => void;
}) {
  const picture = campaignPicture({ productName: s.name, productUrl: s.url, makerImage: s.makerImage, shareImage: s.pageImage });
  const reason = s.step === "details" ? postReason({ productUrl: s.url, productName: s.name, ask: s.ask, makerImage: s.makerImage }, picture) : null;

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-3">
        <Link href="/apps" aria-label="Back" className="min-h-[44px] min-w-[44px] -ml-3 flex items-center justify-center text-gray-900">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <h1 className="text-[18px] font-bold tracking-tight text-gray-900">Post your app</h1>
      </div>

      <div className="px-6 py-4 pb-28 flex flex-col gap-4">
        {s.step === "done" && s.posted ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col gap-3">
            <p className="text-[15px] font-semibold text-gray-900">{s.name} is waiting for 10 YES</p>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${s.posted.of}, minmax(0, 1fr))` }} aria-hidden>
              {pipsFor(s.posted.yes, s.posted.of).map((on, i) => <span key={i} className={`h-2.5 rounded-full ${on ? "bg-gray-900" : "bg-gray-200"}`} />)}
            </div>
            <p className="text-[13px] font-semibold text-gray-900 tabular-nums">{progressLabel(s.posted.yes, s.posted.of)}</p>
            <p className="text-[14px] text-gray-600">Ask people to open FAVOUR and try it. Your own YES does not count.</p>
            <Link href="/apps" className="w-full min-h-[48px] flex items-center justify-center rounded-xl border border-gray-200 bg-white text-[15px] font-semibold text-gray-900">See apps to check</Link>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-semibold text-gray-900">Link to your app</span>
              <input type="url" inputMode="url" placeholder="https://" value={s.url} className={field}
                onChange={(e) => onChange({ url: e.target.value, step: "link" })} />
            </label>

            {s.step === "link" && (
              <button type="button" className={primary} disabled={s.busy || !s.url.trim()} onClick={onRead}>{s.busy ? "Reading…" : "Read my page"}</button>
            )}

            {s.step === "details" && (
              <>
                {picture.url && (
                  <figure className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={picture.url} alt="" className="block w-full aspect-[1.91/1] object-cover bg-gray-100" />
                    <figcaption className="px-4 py-2 text-[12px] text-gray-400">{picture.credit}</figcaption>
                  </figure>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="text-[14px] font-semibold text-gray-900">Name</span>
                  <input type="text" value={s.name} className={field} onChange={(e) => onChange({ name: e.target.value })} />
                  {s.line && <span className="text-[12px] text-gray-400">{s.line}</span>}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[14px] font-semibold text-gray-900">What should people try, and tell you?</span>
                  <textarea rows={4} maxLength={ASK_MAX} value={s.ask} className={`${field} py-3`}
                    placeholder="Open the app, do one real thing, and tell me the first step that was unclear."
                    onChange={(e) => onChange({ ask: e.target.value })} />
                  <span className="text-[12px] text-gray-400 tabular-nums">{askLine(s.ask, MIN_BRIEF_WORDS)}</span>
                </label>
                {!s.pageImage && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[14px] font-semibold text-gray-900">Link to a picture</span>
                    <input type="url" inputMode="url" placeholder="https://" value={s.makerImage} className={field} onChange={(e) => onChange({ makerImage: e.target.value })} />
                    <span className="text-[12px] text-gray-400">Your page has no share picture. Every app needs one.</span>
                  </label>
                )}
                {reason && <p className="text-[13px] text-gray-600">{reason}</p>}
                <button type="button" className={primary} disabled={s.busy || !!reason} onClick={onPost}>{s.busy ? "Posting…" : "Post for 10 YES"}</button>
                <p className="text-[12px] text-gray-400">One app a day. Your app goes live when ten other people say YES.</p>
              </>
            )}
          </>
        )}
        {s.error && <p role="alert" className="text-[14px] text-red-600">{s.error}</p>}
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
    const p = r.body?.proposal as { url?: string; name?: string | null; line?: string | null; image?: string | null } | undefined;
    if (!r.ok || !p) return patch({ busy: false, error: signIn(r.body, "FAVOUR could not read that page. Check the link and try again.") });
    patch({ busy: false, step: "details", url: p.url ?? s.url.trim(), name: p.name ?? "", line: p.line ?? null, pageImage: p.image ?? null });
  };

  const onPost = async () => {
    patch({ busy: true });
    const r = await send("/api/post-app", { productUrl: s.url, productName: s.name, ask: s.ask, makerImage: s.makerImage || undefined });
    const app = r.body?.app as { id: string; yes: number; of: number } | undefined;
    if (!r.ok || !app) return patch({ busy: false, error: signIn(r.body, "Your app was not posted. Try again.") });
    patch({ busy: false, step: "done", posted: app });
  };

  return <PostAppForm state={s} onChange={patch} onRead={onRead} onPost={onPost} />;
}
