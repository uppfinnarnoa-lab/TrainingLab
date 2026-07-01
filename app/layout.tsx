import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";
import { ColorSchemeProvider } from "@/components/color-scheme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "TrainingLab",
  description: "AI-powered personal training platform",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen bg-background text-primary antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <ColorSchemeProvider>
            {children}
          </ColorSchemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
