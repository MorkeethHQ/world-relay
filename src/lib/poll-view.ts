// WHAT THE POLLS PAGE LEADS WITH (2026-10-05). Pure, client-safe.
//
// Read off production on 5 Oct 2026 (public GET /api/polls): 30 polls, 3 open
// and 27 closed. The page printed every one of them as a full card, so it read
// as a long list of locked polls. The open ones lead now, a question you have
// not answered first, and the closed ones are history behind one control.
// Nothing here invents a poll, a vote or a voter: it only orders what the store
// returned.
export type PollLike = { id: string; endsAt: string; createdAt: string; totalVotes: number; youVoted?: boolean };

export function splitPolls<T extends PollLike>(polls: T[], now: number = Date.now()): { open: T[]; closed: T[] } {
  const isOpen = (p: T) => new Date(p.endsAt).getTime() > now;
  const open = polls
    .filter(isOpen)
    .sort((a, b) =>
      Number(!!a.youVoted) - Number(!!b.youVoted) ||
      b.totalVotes - a.totalVotes ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const closed = polls
    .filter((p) => !isOpen(p))
    .sort((a, b) => new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime());
  return { open, closed };
}

// The line under the page title. Counts only, all real.
export function pollSummary(open: PollLike[], closed: PollLike[]): string {
  const toAnswer = open.filter((p) => !p.youVoted).length;
  if (open.length === 0) return closed.length > 0 ? `No open poll right now. ${closed.length} closed.` : "No polls yet.";
  if (toAnswer === 0) return `You have answered all ${open.length} open ${open.length === 1 ? "poll" : "polls"}.`;
  return `${toAnswer} open ${toAnswer === 1 ? "question" : "questions"} for you.`;
}
