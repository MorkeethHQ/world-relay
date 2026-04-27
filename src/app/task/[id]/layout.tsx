import type { Metadata } from "next";
import { getTask } from "@/lib/store";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return {
      title: "RELAY FAVOURS — Task Not Found",
      description: "This task doesn't exist or has expired.",
    };
  }

  const status = task.status === "completed" ? "Verified" : task.status === "claimed" ? "In Progress" : "Open";
  const bounty = task.escrowTxHash ? `$${task.bountyUsdc} USDC` : `${task.bountyUsdc * 10} pts`;
  const title = `${status}: ${task.description.slice(0, 60)}${task.description.length > 60 ? "..." : ""}`;
  const description = `${bounty} bounty on RELAY FAVOURS — ${task.location}. ${
    task.status === "completed"
      ? "Verified by 3-model AI consensus."
      : task.status === "open"
      ? "Claim this task and earn."
      : "A runner is working on this."
  }`;

  return {
    title: `RELAY FAVOURS — ${title}`,
    description,
    openGraph: {
      title: `RELAY FAVOURS — ${title}`,
      description,
      type: "website",
      siteName: "RELAY FAVOURS",
    },
    twitter: {
      card: "summary",
      title: `RELAY FAVOURS — ${title}`,
      description,
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
