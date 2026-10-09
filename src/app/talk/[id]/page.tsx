import { TalkRoom } from "@/components/TalkRoom";

// /talk/<id>: one room. DESIGN-SYSTEM.md, Flow 4, steps 2 to 5.
export default async function TalkRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TalkRoom id={id} />;
}
