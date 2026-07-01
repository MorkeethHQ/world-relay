import type { ReactNode } from "react";

// Minimal RELAY surface: 2xl radius, gray surface, hairline border, no emoji.
// Thin wrapper so screens stop hand-rolling the same rounded-2xl bg-gray-50 block.
export function Card({
  children,
  className = "",
  padded = true,
  surfaceClassName = "bg-gray-50 border border-gray-200",
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  // Override the default gray surface (e.g. for themed / status cards).
  surfaceClassName?: string;
}) {
  return (
    <div className={`rounded-2xl ${surfaceClassName} ${padded ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}
