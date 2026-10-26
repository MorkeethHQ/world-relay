import { notFound, permanentRedirect } from "next/navigation";

export default async function ProjectFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.startsWith("draft_")) permanentRedirect(`/?campaign=${encodeURIComponent(id)}`);
  notFound();
}
