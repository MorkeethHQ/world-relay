"use client";

import { WorldAppHandoff } from "@/components/WorldAppHandoff";

// THE ONE SIGN-IN SCREEN (19 Oct 2026, brief: simplify the first verification
// screen). The old flow put five screens before anything was seen. This sheet
// opens at the first action that needs a wallet: YES, feedback, or posting. It
// records the same terms acceptance the old step 2 recorded, on the same key,
// so nothing downstream changes. Sign-in is World wallet auth: it proves wallet
// control, not Orb-level uniqueness, and the copy says sign in, never verify.

export const TERMS_VERSION = "1.0";

export function recordTermsAccepted(now = new Date()) {
  try {
    localStorage.setItem("relay_terms_accepted", JSON.stringify({ version: TERMS_VERSION, acceptedAt: now.toISOString() }));
    localStorage.setItem("relay_onboarded", "true");
  } catch {}
}

export function SignInSheet({ why, isInWorldApp, busy, error, onSignIn, onClose }: {
  why: string;
  isInWorldApp: boolean;
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <button type="button" className="fv-scrim" aria-label="Close" onClick={onClose} />
      <div className="fv-sheet flex flex-col gap-4" role="dialog" aria-modal="true" aria-label="Sign in">
        <p className="fv-label">Sign in</p>
        <p className="fv-title">{why}</p>
        <p className="fv-body">
          {isInWorldApp
            ? "One tap with your World wallet. FAVOUR never holds your money."
            : "In a browser you get a preview account. Points favours work. Open FAVOUR in World App for the full app."}
        </p>
        <button type="button" className="fv-btn fv-btn-ink" disabled={busy} onClick={() => { recordTermsAccepted(); onSignIn(); }}>
          {busy ? "Signing in…" : isInWorldApp ? "Sign in with World wallet" : "Continue in the browser"}
        </button>
        {error && <p role="alert" className="fv-body">{error}</p>}
        <p className="fv-body text-[12px]">
          By continuing you agree to the <a href="/terms" className="underline underline-offset-2">terms</a> and the <a href="/privacy" className="underline underline-offset-2">privacy policy</a>. Honest feedback only. No AI or stock images as proof.
        </p>
        {!isInWorldApp && <WorldAppHandoff />}
      </div>
    </>
  );
}
