import type { ReactNode } from "react";
import { Typography } from "@worldcoin/mini-apps-ui-kit-react";

// A single labelled metric tile. Points/counts use tabular numerals so grids
// of stats stay aligned. No emoji, gray surface by default.
export function Stat({
  label,
  value,
  suffix,
  surfaceClassName = "bg-gray-100 border border-gray-200",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  suffix?: ReactNode;
  // Override the default gray surface (e.g. for themed cards).
  surfaceClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-2.5 px-2 ${surfaceClassName} ${className}`}
    >
      <Typography variant="number" level={3} className="text-gray-900 tabular-nums">
        {value}
        {suffix && (
          <span className="text-xs font-semibold text-gray-400">{suffix}</span>
        )}
      </Typography>
      <Typography
        variant="body"
        level={4}
        className="text-gray-400 text-center leading-tight"
      >
        {label}
      </Typography>
    </div>
  );
}
