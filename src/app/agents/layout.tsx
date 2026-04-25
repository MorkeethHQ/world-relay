import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RELAY — Agent Marketplace",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
