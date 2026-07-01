import type { ReactNode } from "react";
import { Typography } from "@worldcoin/mini-apps-ui-kit-react";

// A titled block. Keeps section headers visually consistent (kit Typography,
// uppercase eyebrow) instead of every screen inventing its own label styles.
export function Section({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  // Optional small uppercase label rendered above/instead of the title.
  eyebrow?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      {(title || eyebrow || action) && (
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            {eyebrow && (
              <Typography
                variant="body"
                level={4}
                className="uppercase tracking-[0.12em] text-gray-400"
              >
                {eyebrow}
              </Typography>
            )}
            {title && (
              <Typography variant="subtitle" level={2} className="text-gray-900">
                {title}
              </Typography>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
