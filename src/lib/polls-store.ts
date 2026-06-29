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

const POLL_PREFIX = "poll:";
const POLL_LIST_KEY = "poll_ids";

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
  const votes: Record<string, number> = {};
  for (const opt of input.options) {
    votes[opt] = 0;
  }

  const poll: Poll = {
    id,
    question: input.question,
    options: input.options,
    votes,
    voters: {},
    creator: input.creator,
    category: input.category || "general",
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + (input.durationHours || 72) * 3600_000).toISOString(),
    totalVotes: 0,
  };

  await redis.set(`${POLL_PREFIX}${id}`, JSON.stringify(poll));
  await redis.sadd(POLL_LIST_KEY, id);
  return poll;
}

export async function getPoll(id: string): Promise<Poll | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${POLL_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as Poll);
}

export async function listPolls(): Promise<Poll[]> {
  const redis = getRedis();
  if (!redis) return [];

  const ids = await redis.smembers(POLL_LIST_KEY);
  if (ids.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.get(`${POLL_PREFIX}${id}`);
  }
  const results = await pipeline.exec();

  const polls: Poll[] = [];
  for (const raw of results) {
    if (!raw) continue;
    const poll: Poll = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as Poll);
    polls.push(poll);
  }

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

  if (poll.voters[userId]) {
    return { poll, error: "Already voted" };
  }

  if (!poll.options.includes(option)) {
    return { poll, error: "Invalid option" };
  }

  poll.votes[option] = (poll.votes[option] || 0) + 1;
  poll.voters[userId] = option;
  poll.totalVotes += 1;

  await redis.set(`${POLL_PREFIX}${pollId}`, JSON.stringify(poll));
  return { poll };
}
