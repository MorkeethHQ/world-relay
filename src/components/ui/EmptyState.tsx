import type { ReactNode } from "react";
import { Typography } from "@worldcoin/mini-apps-ui-kit-react";

// Consistent empty / zero-state block. Pass an inline SVG icon (no emoji).
export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-50 border border-gray-200 py-10 px-6 text-center ${className}`}
    >
      {icon && <div className="text-gray-400">{icon}</div>}
      <Typography variant="subtitle" level={2} className="text-gray-900">
        {title}
      </Typography>
      {description && (
        <Typography variant="body" level={4} className="text-gray-400 max-w-[40ch]">
          {description}
        </Typography>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
