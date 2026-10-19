// THE PROJECT PICKER (FAVOUR revamp, 19 Oct 2026, Oscar: "lets push the new vibe
// coding narrative and fresh design over"). One list for the home screen: the
// apps still waiting for ten YES (lib/posted-apps.ts) and the campaigns already
// live (lib/campaign-drafts.ts), in one shape. Pure functions here, storage in
// listProjects at the bottom. Nothing here moves money or changes custody.

import type { PieceKind } from "@/lib/campaign-draft-shape";

export type ProjectStatus = "pending" | "published";

export type ProjectCard = {
  id: string;
  name: string;
  url: string;
  host: string;
  ask: string;
  image: string | null;
  yes: number;
  of: number;
  status: ProjectStatus;
  // The builder did not post this one: a FAVOUR wallet posted it on their behalf.
  // The screen shows the orange FOUND ELSEWHERE banner and frames the title.
  fromOtherSource: boolean;
  pieces: Array<{ kind: PieceKind; count: number; taskId: string | null }>;
  points: number;
  publishedAt: string | null;
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Whether a project was posted on a builder's behalf: its maker is one of ours. */
export function isFromOtherSource(maker: string | null | undefined, exclude: Set<string>): boolean {
  return !!maker && exclude.has(String(maker).toLowerCase());
}

export type ProjectFilter = "all" | "waiting" | "live";

export function filterProjects(list: ProjectCard[], f: ProjectFilter): ProjectCard[] {
  if (f === "waiting") return list.filter((p) => p.status === "pending");
  if (f === "live") return list.filter((p) => p.status === "published");
  return list;
}

/** Live first (newest first), then the ones waiting, most YES first. */
export function sortProjects(list: ProjectCard[]): ProjectCard[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "published" ? -1 : 1;
    if (a.status === "published") return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    return b.yes - a.yes || a.id.localeCompare(b.id);
  });
}

export function countLine(p: Pick<ProjectCard, "yes" | "of" | "status">): string {
  return p.status === "published" ? "Live" : `${p.yes} of ${p.of}`;
}

