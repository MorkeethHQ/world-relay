import { getRedis } from "@/lib/redis";

export type Poll = {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  voters: Record<string, string>;
  creator: string;
  category: string;
  createdAt: string;
  endsAt: string;
  totalVotes: number;
};

// A poll's immutable metadata, stored as a JSON blob. Vote tallies and the voter
// roster live in dedicated Redis structures (a hash + a set) so voting is atomic
// and free of the read-modify-write race a single JSON blob would suffer.
type PollMeta = Omit<Poll, "votes" | "voters" | "totalVotes">;

const POLL_PREFIX = "poll:";
const POLL_LIST_KEY = "poll_ids";

// Per-option tally: { [option]: count }, mutated with HINCRBY.
const votesKey = (id: string) => `${POLL_PREFIX}${id}:votes`;
// Authoritative already-voted guard: a SET of userIds. SADD is the atomic dedup.
const votersKey = (id: string) => `${POLL_PREFIX}${id}:voters`;
// Which option each userId chose, so the UI can restore `yourVote`.
const choicesKey = (id: string) => `${POLL_PREFIX}${id}:choices`;

export async function createPoll(input: {
  question: string;
  options: string[];
  creator: string;
  category?: string;
  durationHours?: number;
}): Promise<Poll> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis unavailable");

  const id = crypto.randomUUID();

  const meta: PollMeta = {
    id,
    question: input.question,
    options: input.options,
    creator: input.creator,
    category: input.category || "general",
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + (input.durationHours || 72) * 3600_000).toISOString(),
  };

  // Seed every option at zero so getPoll reports all options even before any vote.
  const initialVotes: Record<string, number> = {};
  for (const opt of input.options) initialVotes[opt] = 0;

  await redis.set(`${POLL_PREFIX}${id}`, JSON.stringify(meta));
  await redis.sadd(POLL_LIST_KEY, id);
  await redis.hset(votesKey(id), initialVotes);

  return { ...meta, votes: initialVotes, voters: {}, totalVotes: 0 };
}

export async function getPoll(id: string): Promise<Poll | null> {
  const redis = getRedis();
  if (!redis) return null;

  const raw = await redis.get(`${POLL_PREFIX}${id}`);
  if (!raw) return null;
  const base = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<Poll> & PollMeta;

  const [votesHash, choicesHash, voterCount] = await Promise.all([
    redis.hgetall(votesKey(id)) as Promise<Record<string, unknown> | null>,
    redis.hgetall(choicesKey(id)) as Promise<Record<string, string> | null>,
    redis.scard(votersKey(id)),
  ]);

  const hasNewData =
    (voterCount ?? 0) > 0 || (votesHash != null && Object.keys(votesHash).length > 0);

  // Back-compat: polls created before tallies moved to the hash/set stored
  // votes/voters inline. If the new structures are empty, fall back to the blob
  // so historical polls keep rendering their counts.
  if (!hasNewData && base.votes) {
    return {
      ...(base as PollMeta),
      votes: base.votes,
      voters: base.voters || {},
      totalVotes: base.totalVotes ?? Object.keys(base.voters || {}).length,
    };
  }

  const votes: Record<string, number> = {};
  for (const opt of base.options) {
    votes[opt] = votesHash && votesHash[opt] != null ? Number(votesHash[opt]) : 0;
  }

  return {
    ...(base as PollMeta),
    votes,
    voters: (choicesHash as Record<string, string>) || {},
    totalVotes: voterCount ?? 0,
  };
}

export async function listPolls(): Promise<Poll[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids = await redis.smembers(POLL_LIST_KEY);
  if (ids.length === 0) return [];

  const polls = (await Promise.all(ids.map((id) => getPoll(id)))).filter(Boolean) as Poll[];

  return polls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function vote(
  pollId: string,
  userId: string,
  option: string
): Promise<{ poll: Poll; error?: string }> {
  const redis = getRedis();
  if (!redis) return { poll: null as any, error: "Redis unavailable" };

  const poll = await getPoll(pollId);
  if (!poll) return { poll: null as any, error: "Poll not found" };

  if (new Date(poll.endsAt).getTime() < Date.now()) {
    return { poll, error: "Poll has ended" };
  }

  if (!poll.options.includes(option)) {
    return { poll, error: "Invalid option" };
  }

  // One-time migration for legacy polls (tallies stored inline, new structures
  // empty): seed the hash/set from the blob before the new vote so nothing is lost.
  const seeded = await redis.scard(votersKey(pollId));
  if (seeded === 0 && poll.totalVotes > 0) {
    if (Object.keys(poll.votes).length) await redis.hset(votesKey(pollId), poll.votes);
    const voterIds = Object.keys(poll.voters);
    if (voterIds.length) {
      await redis.sadd(votersKey(pollId), voterIds[0], ...voterIds.slice(1));
      await redis.hset(choicesKey(pollId), poll.voters);
    }
  }

  // Atomic dedup guard: SADD returns 1 only if userId was NOT already present.
  // A concurrent or replayed request gets 0 and is rejected, so a client rotating
  // its userId cannot double-vote and there is no read-modify-write TOCTOU.
  const added = await redis.sadd(votersKey(pollId), userId);
  if (added === 0) {
    return { poll, error: "Already voted" };
  }

  await Promise.all([
    redis.hincrby(votesKey(pollId), option, 1),
    redis.hset(choicesKey(pollId), { [userId]: option }),
  ]);

  const updated = await getPoll(pollId);
  return { poll: updated || poll };
}
