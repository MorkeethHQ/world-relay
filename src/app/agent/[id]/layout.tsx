import { AGENT_REGISTRY } from "@/lib/agents";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = AGENT_REGISTRY[id];
  return {
    title: agent ? `${agent.name} | RELAY FAVOURS` : "Agent Not Found",
    description: agent?.personality || "AI agent on RELAY FAVOURS",
  };
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
