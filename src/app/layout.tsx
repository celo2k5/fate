import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Nav } from "@/components/Nav";
import { WalletModal } from "@/components/WalletModal";
import { Reveal } from "@/components/Reveal";
import { Preloader } from "@/components/Preloader";
import { RouteProgress } from "@/components/RouteProgress";
import { Footer } from "@/components/Footer";
import { getSettings } from "@/lib/settings";
import { getPreview } from "@/lib/preview";

const SITE = process.env.SITE_URL ?? "https://fate-launchpad.onrender.com";
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Fate — every coin has a destiny", template: "%s · Fate" },
  description: "A Solana launchpad where trading fees fund one permanent, protocol-enforced destiny: buyback & burn, locked liquidity, holder rewards, or an autonomous treasury.",
  applicationName: "Fate",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/brand/icon-32.png", sizes: "32x32" }, { url: "/brand/icon-192.png", sizes: "192x192" }], apple: "/brand/icon-180.png", shortcut: "/favicon.ico" },
  openGraph: { type: "website", siteName: "Fate", title: "Fate — every coin has a destiny", description: "Chosen once. Enforced forever. Trading fees fund one permanent destiny.", images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Fate — every coin has a destiny" }] },
  twitter: { card: "summary_large_image", title: "Fate — every coin has a destiny", description: "Chosen once. Enforced forever.", images: ["/brand/og.png"] },
  manifest: "/manifest.webmanifest",
};
export const viewport = { themeColor: "#0b0516" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preview = await getPreview();
  const s = getSettings();
  const chain = process.env.FATE_CHAIN ?? "simnet";
  const live = chain === "mainnet" ? "mainnet" : chain === "devnet" ? "devnet" : "simnet";
  const network = preview ? `${s.network || "mainnet"} preview` : live;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Permanent+Marker&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen flex flex-col">
        <WalletProvider>
          <Preloader />
          <RouteProgress />
          {preview && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] glass rounded-full px-4 py-2 text-sm flex items-center gap-3" data-testid="preview-banner">
              <span className="chip">Preview</span><span className="text-dim">Showing mainnet configuration from the admin console.</span>
              <a href="/api/admin/preview?off=1" className="link">Exit</a>
            </div>
          )}
          <Nav network={network} />
          <main className="flex-1">{children}</main>
          <Footer network={preview ? network : live} />
          <WalletModal />
          <Reveal />
        </WalletProvider>
      </body>
    </html>
  );
}
