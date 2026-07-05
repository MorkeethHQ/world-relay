import type { Task } from "@/lib/types";
import { rewardAmountLabel, isPointsReward } from "@/lib/reward";

// The one canonical way to display a task reward. Points = amber, money = green
// (points were purple until Oscar's Jul 5 review called it off-brand).
// Use this everywhere a reward amount is shown so the points/money distinction
// is visually consistent and can never drift.
//
// Two modes:
//   1. Single reward (default): pass `task`.
//   2. Combo: pass `combo={{ points, usdc }}` to show "10 pts" + "$5" side by
//      side, so screens stop hand-building the dual points+USDC display.
export function RewardBadge({
  task,
  size = "md",
  combo,
}: {
  task?: Pick<Task, "rewardType" | "bountyUsdc" | "escrowTxHash">;
  size?: "sm" | "md";
  combo?: { points: number; usdc: number };
}) {
  if (combo) {
    const amountClass = size === "sm" ? "text-sm" : "text-[15px]";
    return (
      <span className="inline-flex items-center gap-1.5 leading-tight">
        {combo.points > 0 && (
          <span className={`font-bold ${amountClass} text-amber-600`}>
            {Math.round(combo.points)} pts
          </span>
        )}
        {combo.points > 0 && combo.usdc > 0 && (
          <span className="text-[10px] font-medium text-gray-400">+</span>
        )}
        {combo.usdc > 0 && (
          <span className={`font-bold ${amountClass} text-success-600`}>
            ${combo.usdc}
          </span>
        )}
      </span>
    );
  }

  if (!task) return null;

  const points = isPointsReward(task);
  const amountText = size === "sm" ? rewardAmountLabel(task).replace(" USDC", "") : rewardAmountLabel(task);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`font-bold ${size === "sm" ? "text-sm" : "text-[15px]"} text-gray-900`}>{amountText}</span>
      <span className={`text-[10px] font-medium ${points ? "text-amber-600" : "text-success-600"}`}>
        {points ? "points" : "USDC"}
      </span>
    </span>
  );
}
