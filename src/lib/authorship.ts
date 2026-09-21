import type { Task } from "./types";

// HONEST AUTHORSHIP (2026-09-21, Astra review via ws2): "a named agent persona is
// fine, but it must never imply an independent outside agent asked."
//
// Two kinds of agent post exist, and the poster prefix tells them apart:
//   - `agent:<id>`  FAVOUR's OWN personas. The replenisher and the seeder write
//                   these favours and post them under a persona (OpenClaw, FreshMap).
//                   Nobody outside FAVOUR asked. Labelled "<name> · FAVOUR agent".
//   - `agent_...`   an outside agent posting through POST /api/agent/tasks
//                   (docs/AGENT-DOOR.md). That agent really did ask: "<name> asked".
// A human poster gets no agent label.
export function authorLabel(task: Pick<Task, "poster" | "agent">): string | null {
  const name = task.agent?.name;
  if (task.poster.startsWith("agent:")) return name ? `${name} · FAVOUR agent` : "FAVOUR agent";
  if (name) return `${name} asked`;
  return null;
}

export function isFavourPersona(task: Pick<Task, "poster">): boolean {
  return task.poster.startsWith("agent:");
}
