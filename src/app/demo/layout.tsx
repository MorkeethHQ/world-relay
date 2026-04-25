import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RELAY — How It Works",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
