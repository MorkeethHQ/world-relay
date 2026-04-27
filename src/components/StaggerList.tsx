"use client";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { ReactNode, Children } from "react";

export function StaggerList({
  children,
  staggerMs = 80,
  className = ""
}: {
  children: ReactNode;
  staggerMs?: number;
  className?: string;
}) {
  const items = Children.toArray(children);

  return (
    <div className={className}>
      {items.map((child, i) => (
        <StaggerItem key={i} delay={i * staggerMs}>
          {child}
        </StaggerItem>
      ))}
    </div>
  );
}

function StaggerItem({ children, delay }: { children: ReactNode; delay: number }) {
  const { ref, isVisible } = useScrollReveal({ delay, threshold: 0.05 });

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      {children}
    </div>
  );
}
