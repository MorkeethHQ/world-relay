import type { Task } from "./types";
import { isFunded, isPointsReward, rewardAmountLabel } from "./reward";

type MarketTask = Pick<
  Task,
  | "bountyUsdc"
  | "completionCount"
  | "createdAt"
  | "deadline"
  | "escrowTxHash"
  | "maxCompletions"
  | "onChainId"
  | "rewardType"
  | "status"
>;

export type TaskMarketState = {
  ageLabel: string;
  deadlineLabel: string;
  fundingLabel: string;
  isEndingSoon: boolean;
  isJustOpened: boolean;
  remainingSlots: number;
  slotsLabel: string;
  statusLabel: string;
};

const STATUS_LABEL: Record<Task["status"], string> = {
  open: "Open now",
  claimed: "Claimed",
  completed: "Proof landed",
  failed: "Proof failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function taskMarketState(task: MarketTask, now = Date.now()): TaskMarketState {
  const createdAt = new Date(task.createdAt).getTime();
  const deadline = new Date(task.deadline).getTime();
  const ageMs = Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : Number.POSITIVE_INFINITY;
  const deadlineMs = Number.isFinite(deadline) ? deadline - now : Number.NaN;
  const maxCompletions = Math.max(1, Math.floor(task.maxCompletions || 1));
  const completionCount = Math.max(0, Math.floor(task.completionCount || 0));
  const remainingSlots = Math.max(0, maxCompletions - completionCount);
  const open = task.status === "open";

  return {
    ageLabel: formatAge(ageMs),
    deadlineLabel: open ? formatDeadline(deadlineMs) : STATUS_LABEL[task.status],
    fundingLabel: fundingLabel(task),
    isEndingSoon: open && deadlineMs > 0 && deadlineMs <= 4 * 60 * 60_000,
    isJustOpened: open && ageMs <= 2 * 60 * 60_000,
    remainingSlots,
    slotsLabel:
      remainingSlots === 0
        ? "No spots left"
        : maxCompletions === 1
          ? "1 spot open"
          : `${remainingSlots} of ${maxCompletions} spots left`,
    statusLabel: STATUS_LABEL[task.status],
  };
}

function fundingLabel(task: MarketTask): string {
  if (isPointsReward(task)) return `${rewardAmountLabel(task)} reward`;
  if (isFunded(task)) return `${rewardAmountLabel(task)} funded`;
  return task.rewardType === "usdc-v2" ? `${rewardAmountLabel(task)} · funds on accept` : `${rewardAmountLabel(task)} · not funded`;
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return "Opening time unknown";
  if (ms < 60_000) return "Just opened";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `Opened ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Opened ${hours}h ago`;
  return `Opened ${Math.floor(hours / 24)}d ago`;
}

function formatDeadline(ms: number): string {
  if (!Number.isFinite(ms)) return "No expiry connected";
  if (ms <= 0) return "Expired";
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m left` : `${hours}h left`;
  return `${Math.ceil(hours / 24)}d left`;
}
