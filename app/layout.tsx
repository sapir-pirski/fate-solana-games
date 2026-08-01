import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "FATE — Provably Fair Solana Games",
  description: "Jackpot, coinflip, and daily rewards. Provably fair and verified on Solana.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "FATE — Provably Yours", description: "Provably fair games, built on Solana.", images: [{ url: "/og-spatial.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: "FATE — Provably Yours", description: "Provably fair games, built on Solana.", images: ["/og-spatial.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>{children}</body></html>;
}
