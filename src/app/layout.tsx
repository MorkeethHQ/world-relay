import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MiniKitProvider } from "@/lib/minikit-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RELAY",
  description: "When AI hits a wall, RELAY finds a verified human. Post tasks, prove completion, get paid in USDC.",
  metadataBase: new URL("https://world-relay.vercel.app"),
  openGraph: {
    title: "RELAY — Real errands. Real humans. Real pay.",
    description: "The first errand network where both sides are provably human. World ID verified. USDC settled on World Chain.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RELAY — When AI hits a wall, RELAY finds a verified human" }],
    type: "website",
    siteName: "RELAY",
  },
  twitter: {
    card: "summary_large_image",
    title: "RELAY — Real errands. Real humans. Real pay.",
    description: "The first errand network where both sides are provably human.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white overflow-x-hidden">
        <MiniKitProvider>{children}</MiniKitProvider>
      </body>
    </html>
  );
}
