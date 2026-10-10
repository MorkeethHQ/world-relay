import { notFound } from "next/navigation";
import { TryWithAgents } from "@/components/TryWithAgents";
import { simPreviewOn } from "@/lib/sim-standin";

// /p/<id>/try: "Try it with agents", a LOCAL PREVIEW with stand-in traces
// (lib/sim-standin.ts). The flag is set only in the review fixture's env file,
// so this route answers 404 everywhere else, production included.
export default async function TryPage({ params }: { params: Promise<{ id: string }> }) {
  if (!simPreviewOn()) notFound();
  const { id } = await params;
  return <TryWithAgents id={id} />;
}
