import { createTask, listTasks } from "./store";
import { isPublicTask } from "./task-serializer";
import { isBoardVisible } from "./board-rank";
import { getRedis } from "./redis";
import { trackEvent } from "./track";
import type { Task, TaskCategory } from "./types";

/**
 * BOARD SUPPLY ENGINE (Lane A)
 *
 * Measured 2026-07-28 (prod GET /api/tasks): 12k+ feed loads meet ~2 open tasks.
 * DailyFavour is a quiz gate, not board inventory. Manual seed + evergreen reopen
 * do not keep the board full. This module is the replenisher.
 *
 * Constraints (non-negotiable):
 * - Points only (CUSTODY_RETIRED — never escrow / USDC deposits)
 * - Completions require real photo proofs (AI-verified) — we do not invent
 *   settlements or fake USDC. Agent-minted *inventory* is an explicit product
 *   exception to "organic-only board" so the board is never empty; it is not
 *   a license for fake money or simulated pass verdicts (CLAUDE.md money path).
 * - Location "Anywhere" — doable without travel, shops, or research
 * - Prefer photo/check-in/review over feedback (BOARD-RULES R1)
 * - Same human cannot earn the same template twice (Redis; fail-closed if Redis down)
 */

export const BOARD_SUPPLY_PREFIX = "supply:";
export const BOARD_SUPPLY_TARGET = 8;
/** Cold start must reach target in one tick — do not strand the board at 5 for an hour. */
export const BOARD_SUPPLY_MAX_CREATE_PER_TICK = BOARD_SUPPLY_TARGET;
export const BOARD_SUPPLY_AGENT_ID = "favoursupply";
const SUPPLY_LOCK_KEY = "lock:board-supply";
const SUPPLY_LOCK_TTL_SEC = 55;
export type SupplyTemplate = {
  id: string;
  description: string;
  category: TaskCategory;
  bountyPoints: number;
  deadlineHours: number;
  maxCompletions: number;
};

/** Curated pool — proof spec is inside the description so AI verify has a target. */
export const SUPPLY_TEMPLATES: SupplyTemplate[] = [
  {
    id: "sky-edge",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph the sky directly above you. Include a bit of roof, tree, or building edge so the photo is clearly taken outdoors or at a window — not a stock sky wallpaper. Proof note: where you are standing (room/street is enough).",
  },
  {
    id: "sole-wear",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph the sole of one shoe you are wearing today. Wear pattern or tread must be visible and in focus. Proof note: left or right shoe.",
  },
  {
    id: "window-view",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph the view out your nearest window. Include the window frame or sill in the shot so it is clearly a real window, not a downloaded landscape. Proof note: what you see in one short sentence.",
  },
  {
    id: "plant-leaf",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a real plant (indoor or outdoor) with at least one leaf clearly in focus. Reject plastic/fake plants if obvious. Proof note: plant type if you know it, or 'unknown'.",
  },
  {
    id: "readable-text",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a page of printed text you have nearby (book, magazine, newspaper, or packaged food label). At least two lines of text must be readable in the photo. Proof note: quote 3–5 words you can read.",
  },
  {
    id: "light-switch",
    category: "photo",
    bountyPoints: 4,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a light switch on a wall. The switch position (on or off) must be visible. Proof note: say whether it is on or off.",
  },
  {
    id: "cup-level",
    category: "photo",
    bountyPoints: 4,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a cup, mug, or bottle with liquid in it. The liquid level must be visible. Proof note: water / coffee / other.",
  },
  {
    id: "door-handle",
    category: "photo",
    bountyPoints: 4,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a door handle or doorknob close enough to see material and shape. Include a bit of the door surface. Proof note: interior or exterior door.",
  },
  {
    id: "keys-count",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph your keyring (or say you have none and photograph an empty palm). If you have keys, they must be countable in the photo. Proof note: number of keys visible.",
  },
  {
    id: "power-outlet",
    category: "photo",
    bountyPoints: 4,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph a wall power outlet near you. The socket shape must be clear. Do not insert anything. Proof note: how many sockets on the plate.",
  },
  {
    id: "hand-today",
    category: "photo",
    bountyPoints: 5,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph your hand holding a phone or paper that shows today's date (calendar app, lock screen date, or handwritten). The date must be readable. Proof note: the date as shown.",
  },
  {
    id: "utensil-counter",
    category: "photo",
    bountyPoints: 4,
    deadlineHours: 168,
    maxCompletions: 500,
    description:
      "Photograph one kitchen utensil (spoon, fork, spatula, etc.) resting on a counter or table. The utensil and surface must both be visible. Proof note: which utensil.",
  },
];

export function supplyCampaignId(templateId: string): string {
  return `${BOARD_SUPPLY_PREFIX}${templateId}`;
}

export function isSupplyTask(task: Pick<Task, "campaignId">): boolean {
  return typeof task.campaignId === "string" && task.campaignId.startsWith(BOARD_SUPPLY_PREFIX);
}

export function supplyTemplateId(task: Pick<Task, "campaignId">): string | null {
  if (!isSupplyTask(task) || !task.campaignId) return null;
  return task.campaignId.slice(BOARD_SUPPLY_PREFIX.length) || null;
}

export function countLiveBoardTasks(tasks: Task[], now = Date.now()): number {
  return tasks.filter((t) => isPublicTask(t) && isBoardVisible(t, null, now)).length;
}

/** Open supply tasks that still accept completions. */
export function openSupplyTemplateIds(tasks: Task[], now = Date.now()): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!isSupplyTask(t)) continue;
    if (t.status !== "open") continue;
    if (new Date(t.deadline).getTime() < now) continue;
    if ((t.completionCount || 0) >= (t.maxCompletions || 1)) continue;
    const id = supplyTemplateId(t);
    if (id) ids.add(id);
  }
  return ids;
}

function doneKey(address: string): string {
  return `supply:done:${address.toLowerCase()}`;
}

export async function hasCompletedSupplyTemplate(
  address: string,
  templateId: string,
): Promise<boolean> {
  const redis = getRedis();
  // Fail CLOSED: if we cannot know, treat as already done so a Redis outage
  // cannot mint unlimited repeats on supply tasks.
  if (!redis) return true;
  try {
    return (await redis.sismember(doneKey(address), templateId)) === 1;
  } catch {
    return true;
  }
}

export async function markSupplyTemplateDone(
  address: string,
  templateId: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("supply anti-repeat requires Redis");
  }
  await redis.sadd(doneKey(address), templateId);
  // Keep history long enough that "never repeat" is meaningful across seasons.
  await redis.expire(doneKey(address), 60 * 60 * 24 * 400);
}

export async function listDoneSupplyTemplates(address: string): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const members = await redis.smembers(doneKey(address));
    return Array.isArray(members) ? members.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

/** Drop supply tasks this wallet already completed (board personalization). */
export function filterCompletedSupplyTasks<T extends Pick<Task, "campaignId">>(
  tasks: T[],
  doneTemplateIds: string[],
): T[] {
  if (!doneTemplateIds.length) return tasks;
  const done = new Set(doneTemplateIds);
  return tasks.filter((t) => {
    const id = supplyTemplateId(t);
    if (!id) return true;
    return !done.has(id);
  });
}

export type EnsureSupplyResult = {
  openBefore: number;
  openAfter: number;
  target: number;
  created: Array<{ id: string; templateId: string; description: string }>;
  skipped: string[];
};

/**
 * Bring live board inventory up toward `target` by creating points supply tasks.
 * Idempotent per tick: will not duplicate a template that already has an open row.
 * Expired/completed historical rows do NOT block recreation (adversarial finding:
 * keying off all-time description prefixes sterilized the pool after one lifecycle).
 */
export async function ensureBoardSupply(opts?: {
  target?: number;
  maxCreate?: number;
  now?: number;
}): Promise<EnsureSupplyResult> {
  const target = opts?.target ?? BOARD_SUPPLY_TARGET;
  const maxCreate = opts?.maxCreate ?? BOARD_SUPPLY_MAX_CREATE_PER_TICK;
  const now = opts?.now ?? Date.now();

  const redis = getRedis();
  if (redis) {
    // Best-effort lock against overlapping cron workers double-creating.
    const got = await redis.set(SUPPLY_LOCK_KEY, String(now), { nx: true, ex: SUPPLY_LOCK_TTL_SEC }).catch(() => null);
    if (got !== "OK") {
      return {
        openBefore: -1,
        openAfter: -1,
        target,
        created: [],
        skipped: ["lock_held"],
      };
    }
  }

  const tasks = await listTasks();
  const openBefore = countLiveBoardTasks(tasks, now);
  const created: EnsureSupplyResult["created"] = [];
  const skipped: string[] = [];

  if (openBefore >= target) {
    return { openBefore, openAfter: openBefore, target, created, skipped: ["already_at_target"] };
  }

  const liveTemplates = openSupplyTemplateIds(tasks, now);
  const need = Math.min(maxCreate, target - openBefore);
  // Only OPEN, still-live descriptions block — never expired/completed history.
  const openLiveDescs = new Set(
    tasks
      .filter(
        (t) =>
          t.status === "open" &&
          new Date(t.deadline).getTime() >= now &&
          (t.completionCount || 0) < (t.maxCompletions || 1),
      )
      .map((t) => t.description.slice(0, 80)),
  );

  // Rotate: pick templates not currently live, stable order by id hash + day.
  const day = new Date(now).toISOString().slice(0, 10);
  const ranked = [...SUPPLY_TEMPLATES].sort((a, b) => {
    const ha = hashStr(`${day}:${a.id}`);
    const hb = hashStr(`${day}:${b.id}`);
    return ha - hb;
  });

  for (const tmpl of ranked) {
    if (created.length >= need) break;
    if (liveTemplates.has(tmpl.id)) {
      skipped.push(`live:${tmpl.id}`);
      continue;
    }
    if (openLiveDescs.has(tmpl.description.slice(0, 80))) {
      skipped.push(`desc:${tmpl.id}`);
      continue;
    }

    const task = await createTask({
      poster: `agent:${BOARD_SUPPLY_AGENT_ID}`,
      category: tmpl.category,
      description: tmpl.description,
      location: "Anywhere",
      bountyUsdc: tmpl.bountyPoints,
      deadlineHours: tmpl.deadlineHours,
      agentId: BOARD_SUPPLY_AGENT_ID,
      rewardType: "points",
      maxCompletions: tmpl.maxCompletions,
      campaignId: supplyCampaignId(tmpl.id),
      onChainId: null,
      escrowTxHash: null,
    });

    // Hard assert — points-only. Never trust a future refactor to keep this.
    if (
      task.rewardType !== "points" ||
      task.onChainId != null ||
      task.escrowTxHash != null ||
      task.bountyUsdc <= 0
    ) {
      throw new Error(
        `board-supply refused non-points task ${task.id} (rewardType=${task.rewardType})`,
      );
    }

    created.push({
      id: task.id,
      templateId: tmpl.id,
      description: task.description.slice(0, 60),
    });
    liveTemplates.add(tmpl.id);
    openLiveDescs.add(tmpl.description.slice(0, 80));
    trackEvent("board_supply_created", { templateId: tmpl.id, taskId: task.id }).catch(() => {});
  }

  const openAfter = countLiveBoardTasks(await listTasks(), now);
  return { openBefore, openAfter, target, created, skipped };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h;
}
