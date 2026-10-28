import { notFound, permanentRedirect } from "next/navigation";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Published company campaigns keep their old deep links. Obsolete app
  // profiles have no campaign to open and must never appear as live projects.
  if (id.startsWith("draft_")) permanentRedirect(`/?campaign=${encodeURIComponent(id)}`);
  notFound();
}
