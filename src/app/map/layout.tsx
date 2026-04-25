import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RELAY — Task Map",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
