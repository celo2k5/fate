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

export const metadata: Metadata = {
  title: "FATE — every coin has a destiny",
  description: "Launch a Solana token with an autonomous economic system. Trading fees fuel its destiny. The rules are chosen once and enforced by the protocol.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preview = await getPreview();
  const s = getSettings();
  const network = preview ? `${s.network || "mainnet"} preview` : "simnet";
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&family=Instrument+Serif:ital@1&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
          <Footer network={preview ? network : "simnet"} />
          <WalletModal />
          <Reveal />
        </WalletProvider>
      </body>
    </html>
  );
}
