import type { Task } from "@/lib/types";
import { rewardAmountLabel, isPointsReward } from "@/lib/reward";

// The one canonical way to display a task reward. Points = purple, money = green.
// Use this everywhere a reward amount is shown so the points/money distinction
// is visually consistent and can never drift.
export function RewardBadge({
  task,
  size = "md",
}: {
  task: Pick<Task, "rewardType" | "bountyUsdc" | "escrowTxHash">;
  size?: "sm" | "md";
}) {
  const points = isPointsReward(task);
  const amountText = size === "sm" ? rewardAmountLabel(task).replace(" USDC", "") : rewardAmountLabel(task);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`font-bold ${size === "sm" ? "text-sm" : "text-[15px]"} text-gray-900`}>{amountText}</span>
      <span className={`text-[10px] font-medium ${points ? "text-purple-600" : "text-success-600"}`}>
        {points ? "points" : "USDC"}
      </span>
    </span>
  );
}
