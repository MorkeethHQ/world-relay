// THE LOCAL TEST DATA FIXTURE (2026-10-05). Everything in this file is for a
// review on a developer machine against the in-memory fake store
// (scripts/fake-store.mjs). None of it can be on in production.
import type { VerificationResult } from "./types";

// On only when BOTH hold: the switch is set, and this is not a production build.
// Vercel production always runs NODE_ENV "production", so setting the variable
// there by mistake still leaves this false.
export function isTestFixture(env: Record<string, string | undefined> = process.env): boolean {
  return env.FAVOUR_TEST_FIXTURE === "1" && env.NODE_ENV !== "production";
}

// The fake store's own address, for the sign-in helper page. Loopback only: any
// other host is refused, so the rewrite in next.config.ts cannot point anywhere
// but this machine.
export function fixtureStoreOrigin(env: Record<string, string | undefined> = process.env): string | null {
  if (!isTestFixture(env)) return null;
  const url = env.KV_REST_API_URL ?? "";
  return /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(url) ? url : null;
}

export class FixtureCheckDown extends Error {}

// A STAND-IN FOR THE DEV-ONLY RANDOM STUB, so a reviewer gets the outcome they
// ask for instead of a dice roll. It is reached only where verifyProofStub was
// already reached: no model key, not production, not a funded favour. The words
// are typed into the proof note:
//   TEST FLAG  -> flagged, waits for a human review
//   TEST FAIL  -> not accepted
//   TEST DOWN  -> the check "did not run" (throws), to rehearse a service failure
//   anything else -> accepted
export function fixtureVerdict(proofNote: string | null | undefined): VerificationResult {
  const note = String(proofNote ?? "").toUpperCase();
  if (note.includes("TEST DOWN")) throw new FixtureCheckDown("TEST DATA: the check was told not to run");
  if (note.includes("TEST FLAG")) {
    return { verdict: "flag", reasoning: "TEST DATA stand-in check: flagged on request (the note says TEST FLAG). No model was called.", confidence: 0.5 };
  }
  if (note.includes("TEST FAIL")) {
    return { verdict: "fail", reasoning: "TEST DATA stand-in check: not accepted on request (the note says TEST FAIL). No model was called.", confidence: 0.9, tip: "TEST DATA: this was rejected because the note says TEST FAIL." };
  }
  return { verdict: "pass", reasoning: "TEST DATA stand-in check: accepted. No model was called.", confidence: 0.9 };
}
