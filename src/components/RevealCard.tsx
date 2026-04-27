"use client";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { ReactNode } from "react";

type RevealVariant = "fade-up" | "fade-in" | "slide-left" | "slide-right" | "scale";

export function RevealCard({
  children,
  variant = "fade-up",
  delay = 0,
  className = ""
}: {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  className?: string;
}) {
  const { ref, isVisible } = useScrollReveal({ delay, threshold: 0.05 });

  const baseStyle = "transition-all duration-500 ease-out";

  const hiddenStyles: Record<RevealVariant, string> = {
    "fade-up": "opacity-0 translate-y-6",
    "fade-in": "opacity-0",
    "slide-left": "opacity-0 -translate-x-6",
    "slide-right": "opacity-0 translate-x-6",
    "scale": "opacity-0 scale-95",
  };

  const visibleStyle = "opacity-100 translate-y-0 translate-x-0 scale-100";

  return (
    <div
      ref={ref}
      className={`${baseStyle} ${isVisible ? visibleStyle : hiddenStyles[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
