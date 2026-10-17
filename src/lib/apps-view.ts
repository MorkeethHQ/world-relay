// WHAT THE POSTED-APP SCREENS SAY (components/PostApp.tsx, components/AppsToCheck.tsx).
// Pure, so the words and the pips are tested without a browser.

export function pipsFor(yes: number, of: number): boolean[] {
  const filled = Math.max(0, Math.min(yes, of));
  return Array.from({ length: of }, (_, i) => i < filled);
}

export function progressLabel(yes: number, of: number): string {
  return `${Math.min(yes, of)} of ${of} YES`;
}

export function askWords(ask: string): number {
  return ask.trim() ? ask.trim().split(/\s+/).length : 0;
}

export function askLine(ask: string, min: number): string {
  const n = askWords(ask);
  return n >= min ? `${n} words` : `${n} of ${min} words`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type VoteReply =
  | { ok: true; yes: number; of: number; status: "pending" | "published"; first: boolean }
  | { error?: string; code?: string }
  | null;

/** One line under the card after a tap. The server's words win when it has them. */
export function voteNote(r: VoteReply): string {
  if (r && "ok" in r && r.ok) {
    if (r.status === "published") return "That was the 10th YES. This app is live now.";
    return `${r.first ? "Your YES is in." : "You already said YES."} ${Math.min(r.yes, r.of)} of ${r.of}.`;
  }
  const e = r && "error" in r ? r : null;
  if (e?.code === "reauth_required") return `${e.error ?? "Sign in to vote."} Open FAVOUR in World App and sign in first.`;
  return e?.error ?? "Your vote was not saved. Try again.";
}
