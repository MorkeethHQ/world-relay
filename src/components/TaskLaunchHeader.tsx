import type { Task } from "@/lib/types";
import { CategoryIcon } from "@/components/CategoryIcon";
import { authorLabel } from "@/lib/authorship";
import { taskMarketState } from "@/lib/task-market-state";

const CATEGORY_STYLE: Record<string, { background: string; foreground: string; accent: string }> = {
  photo: { background: "#ff5c35", foreground: "#190700", accent: "#ffd2c5" },
  delivery: { background: "#2878ff", foreground: "#06152e", accent: "#cbdcff" },
  "check-in": { background: "#a477ff", foreground: "#180c2d", accent: "#dfd0ff" },
  feedback: { background: "#ffca38", foreground: "#241800", accent: "#fff0b7" },
  review: { background: "#ff4fa3", foreground: "#260617", accent: "#ffc7e2" },
  social: { background: "#31d5e8", foreground: "#032329", accent: "#c5f7fb" },
  errand: { background: "#49d67d", foreground: "#062414", accent: "#c9f4d8" },
  custom: { background: "#c8ff42", foreground: "#142000", accent: "#eaffb5" },
};

export function TaskLaunchHeader({ task, now }: { task: Task; now: number }) {
  const market = taskMarketState(task, now);
  const style = CATEGORY_STYLE[task.category] ?? CATEGORY_STYLE.custom;
  const liveLabel = market.isEndingSoon ? market.deadlineLabel : market.isJustOpened ? "Just opened" : market.statusLabel;

  return (
    <div
      className="relative min-h-[132px] overflow-hidden px-4 py-4"
      style={{ backgroundColor: style.background, color: style.foreground }}
    >
      <div
        className="absolute -right-7 -bottom-9 flex h-36 w-36 items-center justify-center rounded-full opacity-45"
        style={{ backgroundColor: style.accent }}
        aria-hidden
      >
        <CategoryIcon category={task.category} size={64} />
      </div>
      <div className="relative z-[1] flex h-full flex-col justify-between gap-8">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.18em]">{task.category}</span>
          <span className="rounded-full border border-current/30 bg-white/40 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide">
            {liveLabel}
          </span>
        </div>
        <div>
          <p className="max-w-[78%] break-words text-[12px] font-semibold opacity-70">{authorLabel(task) ?? "Community favour"}</p>
          <p className="mt-1 text-[24px] font-black leading-none tracking-[-0.04em]">{market.fundingLabel}</p>
        </div>
      </div>
    </div>
  );
}
