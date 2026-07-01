"use client";

import { useState, useEffect, ReactNode } from "react";
import {
  Button,
  Typography,
  LiveFeedback,
} from "@worldcoin/mini-apps-ui-kit-react";

/*
 * Onboarding
 *
 * One action per screen, tap to advance, micro-animated transitions.
 * Shown only to brand-new users (gated in page.tsx on the relay_onboarded
 * localStorage flag). The World ID step calls the existing MiniKit sign-in
 * passed down as onVerify. It does not replace auth, it wraps it.
 *
 * Flow:
 *   0. Welcome
 *   1. What RELAY is (do favours / vote polls, earn points + USDC, verified humans)
 *   2. Accept terms (clear "I agree" action)
 *   3. Verify with World ID (existing MiniKit sign-in)
 *   4. Land in the app (discover favours + polls)
 */

interface OnboardingProps {
  isInWorldApp: boolean;
  isVerifying: boolean;
  authed: boolean;
  onVerify: () => void;
  onComplete: () => void;
}

// Simple inline stroke icons. No emoji, currentColor so they inherit text tone.
function IconHandshake() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
      <path d="m21 3 1 11h-2" />
      <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
      <path d="M3 4h8" />
    </svg>
  );
}

function IconPoll() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" x2="18" y1="20" y2="10" />
      <line x1="12" x2="12" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="14" />
    </svg>
  );
}

function IconCoin() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5" />
      <path d="M12 6.5v11" />
    </svg>
  );
}

function IconHumans() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 21a6 6 0 0 0-12 0" />
      <circle cx="12" cy="8" r="4" />
      <path d="m20 8-2 2 3 1" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      <path d="M2 12h20" />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// A soft circular badge that houses an icon at the top of each screen.
function IconBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" }) {
  const toneClass =
    tone === "success"
      ? "bg-success-100 text-success-600 border-success-200"
      : "bg-gray-50 text-gray-900 border-gray-200";
  return (
    <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center ${toneClass}`}>
      {children}
    </div>
  );
}

const TOTAL_STEPS = 5;

export function Onboarding({
  isInWorldApp,
  isVerifying,
  authed,
  onVerify,
  onComplete,
}: OnboardingProps) {
  const [step, setStep] = useState(0);

  // When the existing MiniKit sign-in succeeds, the parent flips authed=true.
  // Advance from the verify screen to the final "you're in" screen.
  useEffect(() => {
    if (authed && step === 3) setStep(4);
  }, [authed, step]);

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col max-w-lg mx-auto w-full">
      {/* Progress dots. Hidden on the terminal success screen. */}
      {step < 4 && (
        <div className="flex items-center justify-center gap-2 pt-8 pb-2 animate-[fadeIn_0.4s_ease-out]">
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              aria-label={`Step ${i + 1} of 4`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-gray-900" : "w-1.5 bg-gray-200"
              }`}
            />
          ))}
        </div>
      )}

      {/* Content. Re-keyed on step so the entrance animation replays each screen. */}
      <div key={step} className="flex-1 flex flex-col justify-center px-7 animate-[fadeSlideIn_0.4s_ease-out]">
        {step === 0 && (
          <div className="flex flex-col items-center text-center gap-5">
            <h1 className="text-[64px] font-bold tracking-tight text-gray-900 leading-none animate-[countUp_0.6s_ease-out]">
              RELAY
            </h1>
            <Typography variant="body" level={2} className="text-gray-500 max-w-[260px]">
              Real tasks. Real people. Verified on-chain.
            </Typography>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[11px] text-gray-300 uppercase tracking-widest">Favours</span>
              <span className="w-1 h-1 rounded-full bg-gray-200" />
              <span className="text-[11px] text-gray-300 uppercase tracking-widest">Polls</span>
              <span className="w-1 h-1 rounded-full bg-gray-200" />
              <span className="text-[11px] text-gray-300 uppercase tracking-widest">USDC</span>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Typography variant="heading" level={2} className="text-gray-900">
                What you can do here
              </Typography>
              <Typography variant="body" level={3} className="text-gray-500">
                RELAY connects people who need small favours with people ready to help.
              </Typography>
            </div>
            <div className="flex flex-col gap-3">
              {[
                { icon: <IconHandshake />, title: "Do favours", body: "Complete quick tasks people post nearby." },
                { icon: <IconPoll />, title: "Vote on polls", body: "Share your opinion and shape decisions." },
                { icon: <IconCoin />, title: "Earn points and USDC", body: "Get rewarded the moment your work is verified." },
                { icon: <IconHumans />, title: "All verified humans", body: "Every user is a real person. No bots." },
              ].map((row, i) => (
                <div
                  key={row.title}
                  className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 animate-[staggerIn_0.4s_ease-out_both]"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div className="text-gray-900 shrink-0 mt-0.5">{row.icon}</div>
                  <div className="flex flex-col">
                    <Typography variant="body" level={2} className="text-gray-900">{row.title}</Typography>
                    <Typography variant="body" level={4} className="text-gray-500">{row.body}</Typography>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col items-center text-center gap-5">
            <IconBadge><IconDoc /></IconBadge>
            <div className="flex flex-col gap-2">
              <Typography variant="heading" level={2} className="text-gray-900">
                A few ground rules
              </Typography>
              <Typography variant="body" level={3} className="text-gray-500 max-w-[300px]">
                By continuing you agree to complete favours honestly, treat other people with respect, and follow the community guidelines. Rewards depend on genuine, verified work.
              </Typography>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center text-center gap-5">
            <IconBadge><IconGlobe /></IconBadge>
            <div className="flex flex-col gap-2">
              <Typography variant="heading" level={2} className="text-gray-900">
                Verify you are human
              </Typography>
              <Typography variant="body" level={3} className="text-gray-500 max-w-[300px]">
                {isInWorldApp
                  ? "Sign in with World ID to prove you are a unique human. This keeps RELAY bot-free and unlocks rewards."
                  : "Continue to set up your account. Full World ID verification is available inside World App."}
              </Typography>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center text-center gap-5">
            <div className="animate-[checkPop_0.5s_ease-out]">
              <IconBadge tone="success"><IconCheck /></IconBadge>
            </div>
            <div className="flex flex-col gap-2">
              <Typography variant="heading" level={2} className="text-gray-900">
                You are all set
              </Typography>
              <Typography variant="body" level={3} className="text-gray-500 max-w-[300px]">
                Your identity is verified. Discover favours to complete and polls to vote on.
              </Typography>
            </div>
          </div>
        )}
      </div>

      {/* Action. One primary action per screen. */}
      <div className="px-7 pb-10 pt-4">
        {step === 3 ? (
          <div aria-live="polite">
            <LiveFeedback state={isVerifying ? "pending" : undefined}>
              <Button
                onClick={onVerify}
                disabled={isVerifying}
                fullWidth
                variant="primary"
                size="lg"
              >
                {isInWorldApp ? "Verify with World ID" : "Continue"}
              </Button>
            </LiveFeedback>
            {!isInWorldApp && (
              <p className="text-[12px] text-gray-300 text-center mt-3">
                Full features available in World App
              </p>
            )}
          </div>
        ) : step === 4 ? (
          <Button onClick={onComplete} fullWidth variant="primary" size="lg">
            Discover favours
          </Button>
        ) : (
          <Button onClick={next} fullWidth variant="primary" size="lg">
            {step === 2 ? "I agree" : step === 0 ? "Get started" : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}
