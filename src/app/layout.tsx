import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MiniKitProvider } from "@/lib/minikit-provider";
import { BottomNav } from "@/components/BottomNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "RELAY",
  description: "AI can do everything except be somewhere. RELAY connects AI agents to World ID-verified humans for physical tasks.",
  metadataBase: new URL("https://world-relay.vercel.app"),
  openGraph: {
    title: "RELAY — AI can do everything except be somewhere.",
    description: "When AI hits a wall, RELAY finds a verified human. Photo a storefront, check a queue, verify a listing — get paid instantly.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RELAY — When AI hits a wall, RELAY finds a verified human" }],
    type: "website",
    siteName: "RELAY",
  },
  twitter: {
    card: "summary_large_image",
    title: "RELAY — AI can do everything except be somewhere.",
    description: "When AI hits a wall, RELAY finds a verified human. Photo a storefront, check a queue, verify a listing — get paid instantly.",
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
        <MiniKitProvider>
          <div className="pb-16">{children}</div>
          <BottomNav />
        </MiniKitProvider>
      </body>
    </html>
  );
}
