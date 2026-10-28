import type { Task } from "./types";

// Shared by browser cards and server serializers. This module has no server imports.
export function isHiddenTask(t: Pick<Task, "hiddenAt"> & { welcomeFor?: string }): boolean {
  if (typeof t.welcomeFor === "string" && t.welcomeFor.length > 0) return true;
  return typeof t.hiddenAt === "string" && t.hiddenAt.length > 0;
}
