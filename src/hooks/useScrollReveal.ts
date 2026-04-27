"use client";
import { useEffect, useRef, useState } from "react";

export function useScrollReveal(options?: { threshold?: number; delay?: number; once?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (options?.delay) {
            setTimeout(() => setIsVisible(true), options.delay);
          } else {
            setIsVisible(true);
          }
          if (options?.once !== false) observer.unobserve(el);
        } else if (options?.once === false) {
          setIsVisible(false);
        }
      },
      { threshold: options?.threshold ?? 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [options?.threshold, options?.delay, options?.once]);

  return { ref, isVisible };
}
