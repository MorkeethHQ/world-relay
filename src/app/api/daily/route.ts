import { NextRequest, NextResponse } from "next/server";
import {
  getPrompt,
  getResults,
  getSubmission,
  getStreak,
  submitDaily,
  publicPrompt,
  utcDate,
} from "@/lib/daily";
import { getAuthedAddress, addressMatches } from "@/lib/session";
import { trackEvent } from "@/lib/track";

// THE TOP FAVOUR — the daily gate.
//
// GET  /api/daily?address=  -> today's prompt, whether you've done it, and the
//                              reveal ONLY if you have.
// POST /api/daily           -> { address, answer, guess } submit once per day.
//
// The lock lives in lib/daily.getResults (it returns null without a submission),
// so this route cannot leak the reveal even if it forgets to check.

export async function GET(req: NextRequest) {
  const address = (new URL(req.url).searchParams.get("address") || "").toLowerCase();
  const date = utcDate(Date.now());
  const prompt = await getPrompt(date);

  if (!address) {
    // Browsing is never gated — a cold visitor sees the question, just not the
    // answers. Gate the ACTING, not the browsing.
    return NextResponse.json({ date, prompt: publicPrompt(prompt), submitted: false, results: null, streak: 0 });
  }

  const [submission, results, streak] = await Promise.all([
    getSubmission(date, address),
    getResults(date, address),
    getStreak(address),
  ]);

  // Reveal views are the loop's second funnel beat. High-frequency (fires per
  // app-open once submitted), so track.ts keeps it out of the capped log —
  // counters only.
  if (results) trackEvent("daily_reveal_viewed", { date }).catch(() => {});

  // The fun fact is the reveal's payoff, so it only ships to someone who has
  // already contributed. Anyone else gets the prompt with it stripped.
  return NextResponse.json({
    date,
    prompt: submission ? prompt : publicPrompt(prompt),
    submitted: submission !== null,
    yourAnswer: submission?.answer ?? null,
    results,
    streak,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  // HARD session requirement — deliberately stricter than ownershipError().
  //
  // ownershipError() honours the SESSION_ENFORCE kill switch, which ships OFF so
  // that deploying the session layer could not lock out returning users on the
  // EXISTING routes. This route is new: it has never had a caller, so it carries
  // no legacy burden and must not inherit that permissiveness. Without this,
  // anyone can POST any address and both poison the index and farm points —
  // verified by probing the running app, which is the only reason it was caught.
  const authed = getAuthedAddress(req, Date.now());
  if (!authed || !addressMatches(authed, body.address)) {
    return NextResponse.json(
      { error: "Sign in to do today's favour" },
      { status: 403 },
    );
  }

  // One human, one answer. A malformed or `dev_` address must never reach the
  // index — the whole value of the data is that every row is a verified human.
  if (!/^0x[0-9a-fA-F]{40}$/.test(authed)) {
    return NextResponse.json({ error: "A wallet account is required" }, { status: 403 });
  }

  const result = await submitDaily({
    date: utcDate(Date.now()),
    address: String(body.address).toLowerCase(),
    answer: String(body.answer ?? ""),
    guess: String(body.guess ?? ""),
  });

  if (!result.ok) {
    // "Already done today" is a conflict, not a bad request — the client uses
    // it to jump straight to the reveal.
    const status = result.error === "You have already done today's favour" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  // At most once per human per day by construction (the hsetnx above), so the
  // funnel can trust this count.
  trackEvent("daily_submitted", {
    date: utcDate(Date.now()),
    streak: result.streak,
    points: result.pointsAwarded,
    guessWasClose: result.results?.guessWasClose ?? false,
  }).catch(() => {});

  // They have now contributed, so the fact is theirs — return the FULL prompt
  // so the reveal can pay it out without a second round trip.
  return NextResponse.json({ ...result, prompt: await getPrompt(utcDate(Date.now())) });
}
